"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { isTextable, normalizePhone } from "@/lib/phone";
import { countryOf, createJob, upsertContact, type Stage } from "@/lib/sms";
import { parseMoney, setStage, STAGES } from "@/lib/crm";
import { clientFromForm, loadContact } from "./data";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, type: "ok" | "err", msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${type}=${encodeURIComponent(msg)}`);
const tagsFrom = (raw: string) => [...new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
/** Only allow redirects back into this client's app. */
const safeBack = (f: FormData, token: string, fallback: string) => {
  const b = str(f, "back");
  return b.startsWith(`/m/${token}`) ? b : fallback;
};

async function contactFromForm(f: FormData) {
  const c = await clientFromForm(f);
  const contact = await loadContact(c.id, str(f, "contactId"));
  if (!contact) throw new Error("Customer not found");
  return { c, contact };
}

export async function createContact(f: FormData) {
  const c = await clientFromForm(f);
  const page = `/m/${c.dashboard_token}/contacts/new`;
  const country = countryOf(c);
  const phone = normalizePhone(str(f, "phone"), country);
  if (!phone || !isTextable(phone, country)) return back(page, "err", country === "US" ? "Enter a valid US cell number." : "Enter a valid UK mobile number (07...).");
  const contact = await upsertContact(c.id, phone, str(f, "name") || null);
  const stage = str(f, "stage") as Stage;
  await db()
    .from("contacts")
    .update({
      email: str(f, "email") || null,
      address: str(f, "address") || null,
      tags: tagsFrom(str(f, "tags")),
      ...(STAGES.some((s) => s.key === stage) ? { stage, stage_changed_at: new Date().toISOString() } : {}),
    })
    .eq("id", contact.id);
  redirect(`/m/${c.dashboard_token}/contacts/${contact.id}`);
}

export async function updateContact(f: FormData) {
  const { c, contact } = await contactFromForm(f);
  const value = str(f, "job_value");
  await db()
    .from("contacts")
    .update({
      name: str(f, "name") || null,
      email: str(f, "email") || null,
      address: str(f, "address") || null,
      tags: tagsFrom(str(f, "tags")),
      job_value_pence: value ? parseMoney(value) : null,
    })
    .eq("id", contact.id);
  back(`/m/${c.dashboard_token}/contacts/${contact.id}`, "ok", "Saved.");
}

export async function changeStage(f: FormData) {
  const { c, contact } = await contactFromForm(f);
  const stage = str(f, "stage") as Stage;
  if (!STAGES.some((s) => s.key === stage)) throw new Error("Unknown stage");
  await setStage(contact, stage, { manual: true });
  const to = safeBack(f, c.dashboard_token, `/m/${c.dashboard_token}/contacts/${contact.id}`);
  revalidatePath(to.split("?")[0]);
  redirect(to);
}

/** Internal note: shows in the conversation and on the customer, never sent to them. */
export async function addNote(f: FormData) {
  const { c, contact } = await contactFromForm(f);
  const body = str(f, "body");
  const to = safeBack(f, c.dashboard_token, `/m/${c.dashboard_token}/contacts/${contact.id}`);
  if (!body) redirect(to);
  await db().from("contact_notes").insert({ client_id: c.id, contact_id: contact.id, body: body.slice(0, 2000) });
  revalidatePath(to.split("?")[0]);
  redirect(to);
}

/** Review request from a conversation or customer page (same as "Job done"). */
export async function requestReview(f: FormData) {
  const { c, contact } = await contactFromForm(f);
  const to = safeBack(f, c.dashboard_token, `/m/${c.dashboard_token}/contacts/${contact.id}`);
  const result = await createJob(c, { phone: contact.phone, name: contact.name, source: "dashboard" });
  if (!result.ok) back(to, "err", result.error);
  back(to, "ok", "Review request scheduled. It goes out in about 2 hours.");
}

export async function addSnippet(f: FormData) {
  const c = await clientFromForm(f);
  const title = str(f, "title");
  const body = str(f, "body");
  if (title && body) await db().from("snippets").insert({ client_id: c.id, title: title.slice(0, 60), body: body.slice(0, 1000) });
  redirect(`/m/${c.dashboard_token}/more/templates`);
}

export async function deleteSnippet(f: FormData) {
  const c = await clientFromForm(f);
  await db().from("snippets").delete().eq("id", str(f, "id")).eq("client_id", c.id);
  redirect(`/m/${c.dashboard_token}/more/templates`);
}
