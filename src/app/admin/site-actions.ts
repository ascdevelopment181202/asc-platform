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

/** Has Claude write unique copy for every SEO page on the client's site. */
export async function writeSeoPagesAction(formData: FormData) {
  const { allPaths, pageForPath } = await import("@/lib/seo-pages");
  const { writeSeoCopy, seoAiEnabled } = await import("@/lib/seo-ai");
  if (!seoAiEnabled()) throw new Error("Add ANTHROPIC_API_KEY in Vercel to write SEO pages.");

  const clientId = String(formData.get("clientId"));
  const onlyMissing = formData.get("onlyMissing") === "true";
  const { data: site } = await db().from("sites").select("*").eq("client_id", clientId).single<import("@/lib/sites").Site>();
  if (!site) throw new Error("Generate the site first.");
  const c = site.content;

  const pages = allPaths(c)
    .filter((p) => p !== "/")
    .map((p) => pageForPath(c, p))
    .filter((p): p is NonNullable<typeof p> => !!p);

  let todo = pages;
  if (onlyMissing) {
    const { data: done } = await db().from("seo_pages").select("path").eq("site_id", site.id).returns<{ path: string }[]>();
    const have = new Set((done ?? []).map((d) => d.path));
    todo = pages.filter((p) => !have.has(p.path));
  }
  const siblings = pages.map((p) => p.h1);

  // A few at a time keeps within the API rate limits and the function time limit.
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (page) => {
        const copy = await writeSeoCopy(c, page, siblings.filter((s) => s !== page.h1));
        if (!copy) return;
        await db()
          .from("seo_pages")
          .upsert({ site_id: site.id, path: page.path, content: copy, generated_at: new Date().toISOString() }, { onConflict: "site_id,path" });
      }),
    );
  }
  revalidatePath(`/admin/clients/${clientId}`);
}
