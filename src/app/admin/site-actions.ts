"use server";

import { revalidatePath } from "next/cache";
import { db, type Client } from "@/lib/supabase";
import { generateSite } from "@/lib/sites";

async function getClient(id: string) {
  const { data, error } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (error) throw error;
  return data;
}

export async function generateSiteAction(formData: FormData) {
  const client = await getClient(String(formData.get("clientId")));
  await generateSite(client);
  revalidatePath(`/admin/clients/${client.id}`);
}

export async function setPublished(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const published = formData.get("published") === "true";
  await db().from("sites").update({ published, updated_at: new Date().toISOString() }).eq("client_id", clientId);
  revalidatePath(`/admin/clients/${clientId}`);
}

export async function saveDomain(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const raw = String(formData.get("domain") ?? "").trim().toLowerCase();
  const domain = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || null;
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error("That doesn't look like a domain, e.g. smithplumbing.co.uk");
  await db().from("sites").update({ domain, updated_at: new Date().toISOString() }).eq("client_id", clientId);
  revalidatePath(`/admin/clients/${clientId}`);
}
