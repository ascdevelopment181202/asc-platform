"use server";

import { firstThatFits } from "@/lib/sms-text";
import { redirect } from "next/navigation";
import { db } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { env } from "@/lib/env";
import { isTextable, normalizePhone } from "@/lib/phone";
import { countryOf, createJob, sendSms, upsertContact, type Contact, firstSendLabel } from "@/lib/sms";
import { currencyFor, docLink, docTitle, money, parseMoney, setStage, totals, type Doc, type LineItem } from "@/lib/crm";
import { clientFromForm, loadContact } from "./data";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, type: "ok" | "err", msg: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}${type}=${encodeURIComponent(msg)}`);

/** Creates or updates a draft quote/invoice from the line-item editor. */
export async function saveDocument(f: FormData) {
  const c = await clientFromForm(f);
  const kind = str(f, "kind") === "invoice" ? "invoice" : "quote";
  const editId = str(f, "id");
  const page = `/m/${c.dashboard_token}/docs/new?kind=${kind}${editId ? `&id=${editId}` : ""}`;

  let contact: Contact | null = str(f, "contactId") ? await loadContact(c.id, str(f, "contactId")) : null;
  if (!contact) {
    const country = countryOf(c);
    const phone = normalizePhone(str(f, "phone"), country);
    if (!phone || !isTextable(phone, country)) return back(page, "err", "Choose a customer or enter their mobile number.");
    contact = await upsertContact(c.id, phone, str(f, "name") || null);
  }

  const descriptions = f.getAll("description").map(String);
  const quantities = f.getAll("quantity").map(String);
  const prices = f.getAll("price").map(String);
  const items: LineItem[] = descriptions
    .map((d, i) => ({ description: d.trim(), quantity: Math.max(0, Number(quantities[i]) || 1), unitPence: parseMoney(prices[i] ?? "") ?? 0 }))
    .filter((i) => i.description && i.unitPence >= 0)
    .slice(0, 50);
  if (!items.length) return back(page, "err", "Add at least one line.");
  const vat = Math.min(Math.max(Number(str(f, "vat")) || 0, 0), 30);
  const t = totals(items, vat);
  const fields = {
    contact_id: contact.id,
    items,
    vat_percent: vat,
    subtotal_pence: t.subtotal,
    total_pence: t.total,
    currency: currencyFor(c),
    notes: str(f, "notes") || null,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(str(f, "due")) ? str(f, "due") : null,
  };

  if (editId) {
    const { data } = await db().from("documents").update(fields).eq("id", editId).eq("client_id", c.id).eq("status", "draft").select("id").maybeSingle<{ id: string }>();
    if (!data) return back(page, "err", "Only drafts can be edited.");
    redirect(`/m/${c.dashboard_token}/docs/${editId}`);
  }

  // Next number for this client and kind; retry once if two are saved at the same moment.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: last } = await db().from("documents").select("number").eq("client_id", c.id).eq("kind", kind).order("number", { ascending: false }).limit(1).maybeSingle<{ number: number }>();
    const { data, error } = await db().from("documents").insert({ client_id: c.id, kind, number: (last?.number ?? 0) + 1, ...fields }).select("id").single<{ id: string }>();
    if (data) redirect(`/m/${c.dashboard_token}/docs/${data.id}`);
    if (error?.code !== "23505") break;
  }
  back(page, "err", "Couldn't save. Try again.");
}

async function docFromForm(f: FormData) {
  const c = await clientFromForm(f);
  const { data: doc } = await db().from("documents").select("*").eq("id", str(f, "id")).eq("client_id", c.id).maybeSingle<Doc>();
  if (!doc) throw new Error("Not found");
  const contact = await loadContact(c.id, doc.contact_id);
  return { c, doc, contact, page: `/m/${c.dashboard_token}/docs/${doc.id}` };
}

/** Texts the customer a link to view (and accept or pay). */
export async function sendDocument(f: FormData) {
  const { c, doc, contact, page } = await docFromForm(f);
  if (!contact) back(page, "err", "This customer no longer exists.");
  if (contact!.opted_out_at) back(page, "err", "This customer replied STOP, so you can't text them. Copy the link and send it another way.");
  const first = contact!.name?.split(/\s+/)[0] || "there";
  const what = doc.kind === "quote" ? `your quote from ${clientLabel(c)} for ${money(doc.total_pence, doc.currency)}` : `your invoice from ${clientLabel(c)} for ${money(doc.total_pence, doc.currency)}`;
  const link = docLink(doc, env.appUrl);
  const short = `Your ${doc.kind} from ${clientLabel(c)} (${money(doc.total_pence, doc.currency)}): ${link}`;
  const r = await sendSms({ client: c, to: contact!.phone, kind: "manual", contactId: contact!.id, body: firstThatFits([`Hi ${first}, here's ${what}: ${link}`, short]) });
  if (!r.ok) back(page, "err", "The text didn't send. Copy the link below and send it another way.");
  if (doc.status === "draft") await db().from("documents").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", doc.id);
  if (doc.kind === "quote") await setStage(contact!, "quoted");
  back(page, "ok", `${docTitle(doc)} sent.`);
}

export async function markPaid(f: FormData) {
  const { c, doc, contact, page } = await docFromForm(f);
  await db().from("documents").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", doc.id);
  if (contact) await setStage(contact, "paid");
  // Getting paid means the job's finished: ask for a review unless they untick it.
  if (contact && f.get("review") === "on") {
    const result = await createJob(c, { phone: contact.phone, name: contact.name, source: "dashboard", label: doc.items?.[0]?.description });
    if (result.ok) back(page, "ok", `Marked as paid. Review request goes out ${firstSendLabel(c)}.`);
  }
  back(page, "ok", "Marked as paid.");
}

export async function voidDocument(f: FormData) {
  const { doc, page } = await docFromForm(f);
  await db().from("documents").update({ status: "void" }).eq("id", doc.id);
  back(page, "ok", `${docTitle(doc)} voided.`);
}

/** Turns a quote into a draft invoice with the same lines. */
export async function quoteToInvoice(f: FormData) {
  const { c, doc } = await docFromForm(f);
  const { data: last } = await db().from("documents").select("number").eq("client_id", c.id).eq("kind", "invoice").order("number", { ascending: false }).limit(1).maybeSingle<{ number: number }>();
  const { data } = await db()
    .from("documents")
    .insert({
      client_id: c.id,
      contact_id: doc.contact_id,
      kind: "invoice",
      number: (last?.number ?? 0) + 1,
      items: doc.items,
      vat_percent: doc.vat_percent,
      subtotal_pence: doc.subtotal_pence,
      total_pence: doc.total_pence,
      currency: doc.currency,
      notes: doc.notes,
    })
    .select("id")
    .single<{ id: string }>();
  redirect(`/m/${c.dashboard_token}/docs/${data!.id}`);
}
