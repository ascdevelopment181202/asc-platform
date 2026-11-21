import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { displayPhone, localeFor } from "@/lib/phone";
import { docTitle, money, type Doc } from "@/lib/crm";
import { acceptQuote } from "./actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ accepted?: string }> };

async function load(token: string) {
  if (!/^[0-9a-f]{24}$/.test(token)) return null;
  const { data: doc } = await db().from("documents").select("*").eq("public_token", token).maybeSingle<Doc>();
  if (!doc || doc.status === "draft") return null;
  const [{ data: c }, { data: contact }] = await Promise.all([
    db().from("clients").select("*").eq("id", doc.client_id).single<Client>(),
    db().from("contacts").select("name, phone, address, email").eq("id", doc.contact_id).maybeSingle<{ name: string | null; phone: string; address: string | null; email: string | null }>(),
  ]);
  return c ? { doc, c, contact } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).token);
  return { title: data ? `${docTitle(data.doc)} from ${clientLabel(data.c)}` : "Document", robots: { index: false, follow: false } };
}

/** What the customer sees: a clean quote or invoice they can accept, pay or print. */
export default async function PublicDoc({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const data = await load(token);
  if (!data) notFound();
  const { doc, c, contact } = data;
  const inv = c.invoice_details ?? {};
  const locale = localeFor(c.country);
  const us = c.country === "US";
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: c.timezone || "Europe/London" });

  return (
    <div className="min-h-dvh bg-[#f4f5f7] px-4 py-8 text-neutral-900 print:bg-white">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow-sm print:shadow-none sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xl font-bold">{clientLabel(c)}</p>
            {inv.businessAddress && <p className="whitespace-pre-line text-sm text-neutral-600">{inv.businessAddress}</p>}
            {c.twilio_number && <p className="text-sm text-neutral-600">{displayPhone(c.twilio_number)}</p>}
            {inv.vatNumber && <p className="text-sm text-neutral-600">{us ? "Tax ID" : "VAT no."} {inv.vatNumber}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold uppercase tracking-wide text-neutral-800">{doc.kind}</p>
            <p className="text-sm text-neutral-600">#{doc.number}</p>
            <p className="text-sm text-neutral-600">{date(doc.sent_at ?? doc.created_at)}</p>
            {doc.kind === "invoice" && doc.due_date && <p className="text-sm text-neutral-600">Due {date(`${doc.due_date}T12:00:00Z`)}</p>}
          </div>
        </div>

        <div className="mt-6 text-sm">
          <p className="font-semibold text-neutral-500">For</p>
          <p>{contact?.name ?? (contact ? displayPhone(contact.phone) : "")}</p>
          {contact?.address && <p className="text-neutral-600">{contact.address}</p>}
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Price</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((it, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="py-2 pr-2">{it.description}</td>
                <td className="py-2 text-right">{it.quantity}</td>
                <td className="py-2 text-right">{money(it.unitPence, doc.currency)}</td>
                <td className="py-2 text-right">{money(Math.round(it.quantity * it.unitPence), doc.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <p className="flex justify-between">
            <span>Subtotal</span>
            <span>{money(doc.subtotal_pence, doc.currency)}</span>
          </p>
          {Number(doc.vat_percent) > 0 && (
            <p className="flex justify-between">
              <span>
                {us ? "Tax" : "VAT"} ({Number(doc.vat_percent)}%)
              </span>
              <span>{money(doc.total_pence - doc.subtotal_pence, doc.currency)}</span>
            </p>
          )}
          <p className="flex justify-between border-t border-neutral-200 pt-2 text-lg font-bold">
            <span>Total</span>
            <span>{money(doc.total_pence, doc.currency)}</span>
          </p>
        </div>
        {doc.notes && <p className="mt-6 whitespace-pre-wrap text-sm text-neutral-700">{doc.notes}</p>}

        {doc.status === "void" && <p className="mt-6 rounded-xl bg-neutral-100 p-4 text-center font-medium text-neutral-600">This {doc.kind} has been cancelled.</p>}

        {doc.kind === "quote" && doc.status !== "void" && (
          <div className="mt-8 print:hidden">
            {doc.status === "accepted" || sp.accepted ? (
              <p className="rounded-xl bg-emerald-50 p-4 text-center font-medium text-emerald-800">✅ Quote accepted. {clientLabel(c)} will be in touch to book it in.</p>
            ) : (
              <form action={acceptQuote}>
                <input type="hidden" name="token" value={token} />
                <button className="w-full rounded-xl bg-emerald-600 px-4 py-4 text-lg font-semibold text-white">Accept quote</button>
                <p className="mt-2 text-center text-xs text-neutral-500">Questions? Reply to the text this came from.</p>
              </form>
            )}
          </div>
        )}

        {doc.kind === "invoice" && doc.status !== "void" && (
          <div className="mt-8">
            {doc.status === "paid" ? (
              <p className="rounded-xl bg-green-50 p-4 text-center font-medium text-green-800">✅ Paid. Thank you!</p>
            ) : (
              <div className="space-y-3">
                <h2 className="font-semibold">How to pay</h2>
                {inv.paymentLink && (
                  <a href={inv.paymentLink} target="_blank" rel="noreferrer" className="block w-full rounded-xl bg-[#2a78d6] px-4 py-4 text-center text-lg font-semibold text-white print:hidden">
                    Pay {money(doc.total_pence, doc.currency)} by card
                  </a>
                )}
                {(inv.accountNumber || inv.sortCode || inv.routingNumber) && (
                  <div className="rounded-xl bg-neutral-50 p-4 text-sm">
                    <p className="font-medium">Bank transfer</p>
                    {inv.accountName && <p>Name: {inv.accountName}</p>}
                    {inv.bankName && <p>Bank: {inv.bankName}</p>}
                    {inv.sortCode && <p>Sort code: {inv.sortCode}</p>}
                    {inv.routingNumber && <p>Routing number: {inv.routingNumber}</p>}
                    {inv.accountNumber && <p>Account number: {inv.accountNumber}</p>}
                    <p className="mt-1 text-neutral-500">Reference: {docTitle(doc).replace(" #", "-")}</p>
                  </div>
                )}
                {!inv.paymentLink && !inv.accountNumber && <p className="text-sm text-neutral-600">Reply to the text this came from to arrange payment.</p>}
              </div>
            )}
          </div>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-neutral-400 print:hidden">Sent with ASC Development</p>
    </div>
  );
}
