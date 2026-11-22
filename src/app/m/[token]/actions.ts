"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, type Client } from "@/lib/supabase";
import { isTextable, normalizePhone } from "@/lib/phone";
import { BULK_PER_DAY, countryOf, createJob, parseCustomerList, sendSms, upsertContact, type Contact } from "@/lib/sms";

// These run from the client's private app link. The token is the only key, same as /r/[token].

async function clientFor(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!/^[0-9a-f]{32}$/.test(token)) throw new Error("Invalid link");
  const { data } = await db().from("clients").select("*").eq("dashboard_token", token).maybeSingle<Client>();
  if (!data) throw new Error("Invalid link");
  return data;
}

async function contactFor(c: Client, formData: FormData) {
  const id = String(formData.get("contactId") ?? "");
  const { data } = await db().from("contacts").select("*").eq("id", id).eq("client_id", c.id).maybeSingle<Contact>();
  if (!data) throw new Error("Conversation not found");
  return data;
}

const back = (path: string, type: "ok" | "err", msg: string): never => redirect(`${path}?${type}=${encodeURIComponent(msg)}`);

// ---------- Inbox ----------

/** Reply typed in the app. Sent from the client's business number. */
export async function sendMessage(formData: FormData) {
  const c = await clientFor(formData);
  const contact = await contactFor(c, formData);
  const thread = `/m/${c.dashboard_token}/c/${contact.id}`;
  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(thread);
  if (contact.opted_out_at) back(thread, "err", "This customer replied STOP, so texts to them are blocked.");
  const result = await sendSms({ client: c, to: contact.phone, body: body.slice(0, 1000), kind: "manual", contactId: contact.id });
  await db().from("contacts").update({ unread_count: 0 }).eq("id", contact.id);
  if (!result.ok) back(thread, "err", "Message didn't send. Check the number, or ask ASC if it keeps happening.");
  revalidatePath(thread);
  redirect(thread);
}

export async function toggleStar(formData: FormData) {
  const c = await clientFor(formData);
  const contact = await contactFor(c, formData);
  await db().from("contacts").update({ starred: !contact.starred }).eq("id", contact.id);
  revalidatePath(`/m/${c.dashboard_token}/c/${contact.id}`);
}

export async function markUnread(formData: FormData) {
  const c = await clientFor(formData);
  const contact = await contactFor(c, formData);
  await db().from("contacts").update({ unread_count: Math.max(1, contact.unread_count) }).eq("id", contact.id);
  redirect(`/m/${c.dashboard_token}`);
}

/** The + button: text a customer who isn't in the inbox yet. */
export async function startConversation(formData: FormData) {
  const c = await clientFor(formData);
  const page = `/m/${c.dashboard_token}/new`;
  const country = countryOf(c);
  const phone = normalizePhone(String(formData.get("phone") ?? ""), country);
  const body = String(formData.get("body") ?? "").trim();
  if (!isTextable(phone, country)) return back(page, "err", country === "US" ? "That doesn't look like a US cell number." : "That doesn't look like a UK mobile number (07...).");
  if (!body) back(page, "err", "Write a message first.");
  const contact = await upsertContact(c.id, phone, String(formData.get("name") ?? "").trim() || null);
  if (contact.opted_out_at) back(page, "err", "This customer replied STOP, so texts to them are blocked.");
  const result = await sendSms({ client: c, to: phone, body: body.slice(0, 1000), kind: "manual", contactId: contact.id });
  if (!result.ok) back(`/m/${c.dashboard_token}/c/${contact.id}`, "err", "Message didn't send. Check the number, or ask ASC if it keeps happening.");
  redirect(`/m/${c.dashboard_token}/c/${contact.id}`);
}

// ---------- Reviews ----------

export async function jobDone(formData: FormData) {
  const c = await clientFor(formData);
  const b = String(formData.get("back") ?? "");
  const page = b.startsWith(`/m/${c.dashboard_token}`) ? b : `/m/${c.dashboard_token}/reviews`;
  const result = await createJob(c, {
    phone: String(formData.get("phone") ?? ""),
    name: String(formData.get("name") ?? "").trim() || null,
    source: "dashboard",
    label: String(formData.get("job") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
  });
  if (!result.ok) back(page, "err", result.error);
  else back(page, "ok", `Done. ${result.contact.name ?? "Your customer"} will get a review request in about 2 hours.`);
}

/** One review text per past customer, spread over a few days so it doesn't land as a burst. */
export async function bulkUpload(formData: FormData) {
  const c = await clientFor(formData);
  const page = `/m/${c.dashboard_token}/reviews`;
  let text = String(formData.get("list") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) back(page, "err", "That file is too big. Keep it under 2MB.");
    text += `\n${await file.text()}`;
  }
  const rows = parseCustomerList(text, countryOf(c));
  if (!rows.length) back(page, "err", "Couldn't find any mobile numbers in that list.");
  if (rows.length > 500) back(page, "err", "That's over 500 numbers. Send ASC the list and we'll load it for you.");

  let added = 0;
  const reasons = new Map<string, number>();
  const start = Date.now() + 10 * 60_000;
  for (const row of rows) {
    const startAt = new Date(start + Math.floor(added / BULK_PER_DAY) * 86400_000);
    const result = await createJob(c, { phone: row.phone, name: row.name, source: "bulk", startAt });
    if (result.ok) added++;
    else reasons.set(result.error, (reasons.get(result.error) ?? 0) + 1);
  }
  const days = Math.max(1, Math.ceil(added / BULK_PER_DAY));
  const skippedNote = [...reasons.entries()].map(([why, n]) => `${n} skipped (${why.replace(/\.$/, "").toLowerCase()})`).join(", ");
  if (!added) back(page, "err", `Nothing added. ${skippedNote}.`);
  back(
    page,
    "ok",
    `Added ${added} customer${added === 1 ? "" : "s"}. They'll each get one review request${days > 1 ? ` over the next ${days} days` : " today"}, between 9am and 7pm.${skippedNote ? ` ${skippedNote}.` : ""}`,
  );
}
