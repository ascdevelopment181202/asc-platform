import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clientLabel } from "@/lib/clients";
import { displayPhone, localeFor } from "@/lib/phone";
import { docTitle, money } from "@/lib/crm";
import { acceptQuote } from "./actions";
import { loadPublicDoc } from "@/lib/doc-pdf";
import { brandOf } from "@/lib/brand";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ accepted?: string }> };

const load = loadPublicDoc;

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
  const brand = brandOf(c);
  const accent = { backgroundColor: brand.color, color: brand.onColor };
  const locale = localeFor(c.country);
  const us = c.country === "US";
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: c.timezone || "Europe/London" });

  return (
    <div className="min-h-dvh bg-[#f4f5f7] px-4 py-8 text-neutral-900 print:bg-white">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-sm print:shadow-none">
        <div className="h-2" style={{ backgroundColor: brand.color }} />
        <div className="p-6 sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {brand.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo} alt={brand.name} className="mb-3 max-h-16 max-w-[200px] object-contain" />
            ) : (
              <p className="text-xl font-bold">{brand.name}</p>
            )}
            {brand.logo && <p className="font-semibold">{brand.name}</p>}
            {brand.address && <p className="whitespace-pre-line text-sm text-neutral-600">{brand.address}</p>}
            {brand.phone && <p className="text-sm text-neutral-600">{brand.phone}</p>}
            {brand.email && <p className="text-sm text-neutral-600">{brand.email}</p>}
            {brand.companyNumber && <p className="text-sm text-neutral-600">Company no. {brand.companyNumber}</p>}
            {brand.vatNumber && <p className="text-sm text-neutral-600">{us ? "Tax ID" : "VAT no."} {brand.vatNumber}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold uppercase tracking-wide text-neutral-800">{doc.kind}</p>
            <p className="text-sm text-neutral-600">No. {doc.number}</p>
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
            <tr className="text-left" style={accent}>
              <th className="px-2 py-2 font-semibold">Description</th>
              <th className="px-2 py-2 text-right font-semibold">Qty</th>
              <th className="px-2 py-2 text-right font-semibold">Price</th>
              <th className="px-2 py-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((it, i) => (
              <tr key={i} className="border-b border-neutral-100">
                <td className="whitespace-pre-wrap px-2 py-2">{it.description}</td>
                <td className="px-2 py-2 text-right">{it.quantity}</td>
                <td className="px-2 py-2 text-right">{money(it.unitPence, doc.currency)}</td>
                <td className="px-2 py-2 text-right">{money(Math.round(it.quantity * it.unitPence), doc.currency)}</td>
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
          <p className="flex justify-between rounded-lg px-3 py-2 text-lg font-bold" style={accent}>
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
                <button className="w-full rounded-xl px-4 py-4 text-lg font-semibold" style={accent}>Accept quote</button>
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
                  <a href={inv.paymentLink} target="_blank" rel="noreferrer" className="block w-full rounded-xl px-4 py-4 text-center text-lg font-semibold print:hidden"
                    style={accent}>
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
        <a href={`/d/${token}/pdf?download=1`} className="mt-6 block w-full rounded-xl px-4 py-3 text-center font-medium text-neutral-700 ring-1 ring-neutral-300 print:hidden">
          Download PDF
        </a>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-neutral-400 print:hidden">Sent with ASC Development</p>
    </div>
  );
}
