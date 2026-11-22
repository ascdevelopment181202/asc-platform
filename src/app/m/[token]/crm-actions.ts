"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { isTextable, normalizePhone } from "@/lib/phone";
import { BULK_PER_DAY, countryOf, createJob, upsertContact, type Contact, type Stage } from "@/lib/sms";
import { parseMoney, setStage, STAGES } from "@/lib/crm";
import { clientFromForm, loadContact } from "./data";
import { dueFrom } from "@/lib/tasks";

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
  // Moving someone to "Job done" asks them for a review (once per customer every 180 days).
  if (stage === "done" && contact.stage !== "done") {
    const result = await createJob(c, { phone: contact.phone, name: contact.name, source: "dashboard" });
    if (result.ok) back(to, "ok", "Moved to Job done. Review request goes out in about 2 hours.");
  }
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

/** Brings in customers from a CSV or vCard (parsed and previewed in the browser). Existing numbers are updated, not doubled. */
export async function importContacts(f: FormData) {
  const c = await clientFromForm(f);
  const page = `/m/${c.dashboard_token}/contacts/import`;
  const country = countryOf(c);
  let raw: { name?: string; phone?: string; email?: string; address?: string }[] = [];
  try {
    raw = JSON.parse(str(f, "rows"));
  } catch {
    return back(page, "err", "Couldn't read that list. Try the file again.");
  }
  const extraTags = tagsFrom(str(f, "tags"));
  const byPhone = new Map<string, { name: string | null; email: string | null; address: string | null }>();
  let bad = 0;
  for (const r of raw.slice(0, 2000)) {
    const phone = normalizePhone(String(r.phone ?? ""), country);
    if (!phone) {
      bad++;
      continue;
    }
    const prev = byPhone.get(phone);
    byPhone.set(phone, {
      name: String(r.name ?? "").trim().slice(0, 120) || prev?.name || null,
      email: String(r.email ?? "").trim().slice(0, 200) || prev?.email || null,
      address: String(r.address ?? "").trim().slice(0, 300) || prev?.address || null,
    });
  }
  if (!byPhone.size) return back(page, "err", "None of those numbers looked right.");

  const phones = [...byPhone.keys()];
  const existing = new Map<string, Contact>();
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await db().from("contacts").select("*").eq("client_id", c.id).in("phone", phones.slice(i, i + 200)).returns<Contact[]>();
    for (const x of data ?? []) existing.set(x.phone, x);
  }

  const fresh = phones
    .filter((p) => !existing.has(p))
    .map((p) => ({ client_id: c.id, phone: p, ...byPhone.get(p)!, tags: extraTags }));
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await db().from("contacts").insert(fresh.slice(i, i + 500));
    if (error) {
      console.error("import insert failed", error);
      return back(page, "err", "Something went wrong saving them. Nothing was lost, try again.");
    }
  }
  let updated = 0;
  for (const [phone, cur] of existing) {
    const inc = byPhone.get(phone)!;
    const patch: Record<string, unknown> = {};
    if (inc.name && !cur.name) patch.name = inc.name;
    if (inc.email && !cur.email) patch.email = inc.email;
    if (inc.address && !cur.address) patch.address = inc.address;
    const tags = [...new Set([...(cur.tags ?? []), ...extraTags])];
    if (tags.length !== (cur.tags ?? []).length) patch.tags = tags.slice(0, 10);
    if (Object.keys(patch).length) {
      await db().from("contacts").update(patch).eq("id", cur.id);
      updated++;
    }
  }

  let asked = 0;
  if (f.get("review") === "on") {
    const start = Date.now() + 10 * 60_000;
    for (const phone of phones.filter((p) => isTextable(p, country)).slice(0, 500)) {
      const startAt = new Date(start + Math.floor(asked / BULK_PER_DAY) * 86400_000);
      const r = await createJob(c, { phone, name: byPhone.get(phone)!.name, source: "bulk", startAt });
      if (r.ok) asked++;
    }
  }

  revalidatePath(`/m/${c.dashboard_token}/contacts`);
  const parts = [`Imported ${fresh.length} new customer${fresh.length === 1 ? "" : "s"}`];
  if (existing.size) parts.push(`${existing.size} already here${updated ? ` (${updated} updated)` : ""}`);
  if (bad) parts.push(`${bad} skipped with no valid number`);
  if (asked) parts.push(`${asked} will get a review request`);
  return back(`/m/${c.dashboard_token}/contacts`, "ok", `${parts.join(", ")}.`);
}

/** A follow-up for the owner, optionally tied to a customer. The cron sends a push when it's due. */
export async function addTask(f: FormData) {
  const c = await clientFromForm(f);
  const token = c.dashboard_token;
  const page = safeBack(f, token, `/m/${token}/tasks`);
  const title = str(f, "title").slice(0, 200);
  if (!title) return back(page, "err", "Say what needs doing.");
  let contactId: string | null = str(f, "contactId") || null;
  if (contactId && !(await loadContact(c.id, contactId))) contactId = null;
  const due = dueFrom(str(f, "when"), str(f, "date"), str(f, "time"), c.timezone || "Europe/London");
  await db().from("contact_tasks").insert({ client_id: c.id, contact_id: contactId, title, due_at: due.toISOString() });
  revalidatePath(`/m/${token}/tasks`);
  return back(page, "ok", "Task added. We'll remind you.");
}

export async function finishTask(f: FormData) {
  const c = await clientFromForm(f);
  const token = c.dashboard_token;
  const { data: task } = await db()
    .from("contact_tasks")
    .update({ done_at: new Date().toISOString() })
    .eq("client_id", c.id)
    .eq("id", str(f, "taskId"))
    .select("contact_id, title")
    .maybeSingle<{ contact_id: string | null; title: string }>();
  revalidatePath(`/m/${token}/tasks`);
  // Finished a "put things right" call: take them to the customer, where they can ask again.
  if (task?.contact_id && task.title.includes("put things right")) {
    return back(`/m/${token}/contacts/${task.contact_id}`, "ok", "Nice one. If it's sorted, you can ask them for a review again below.");
  }
  return back(safeBack(f, token, `/m/${token}/tasks`), "ok", "Done ✓");
}

/** One tap from the "Today's customers" list. */
export async function askFromToday(f: FormData) {
  const { c, contact } = await contactFromForm(f);
  const to = safeBack(f, c.dashboard_token, `/m/${c.dashboard_token}/today`);
  const result = await createJob(c, { phone: contact.phone, name: contact.name, source: "dashboard", label: str(f, "label") || null, appointmentId: str(f, "appointmentId") || null });
  if (!result.ok) return back(to, "err", result.error);
  if (str(f, "appointmentId")) await db().from("appointments").update({ review_queued_at: new Date().toISOString() }).eq("id", str(f, "appointmentId")).eq("client_id", c.id);
  return back(to, "ok", `${contact.name?.split(/\s+/)[0] ?? "They"} will get a review request in about 2 hours.`);
}

/** Second ask after putting things right: one friendly text, outside the 6-month rule. */
export async function reaskReview(f: FormData) {
  const { c, contact } = await contactFromForm(f);
  const to = safeBack(f, c.dashboard_token, `/m/${c.dashboard_token}/contacts/${contact.id}`);
  const result = await createJob(c, { phone: contact.phone, name: contact.name, source: "reask", startAt: new Date(Date.now() + 10 * 60_000) });
  if (!result.ok) return back(to, "err", result.error);
  return back(to, "ok", "Done. We'll send a short, friendly text asking again.");
}
