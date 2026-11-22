import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { displayPhone, localeFor } from "@/lib/phone";
import { DOC_STATUS, docLink, docTitle, money, type Doc } from "@/lib/crm";
import { fullWhen, loadClient, loadContact } from "../../data";
import { Card, Flash, primaryBtn, quietBtn, SubHeader } from "../../ui";
import { markPaid, quoteToInvoice, sendDocument, voidDocument } from "../../doc-actions";

export const dynamic = "force-dynamic";

/** One quote or invoice in the app: preview, send, mark paid, turn into an invoice. */
export default async function DocPage({ params, searchParams }: { params: Promise<{ token: string; id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token, id } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c || !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data: doc } = await db().from("documents").select("*").eq("id", id).eq("client_id", c.id).maybeSingle<Doc>();
  if (!doc) notFound();
  const contact = await loadContact(c.id, doc.contact_id);
  const tz = c.timezone || "Europe/London";
  const locale = localeFor(c.country);
  const st = DOC_STATUS[doc.status];
  const link = docLink(doc, env.appUrl);
  const hidden = (
    <>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="id" value={doc.id} />
    </>
  );
  const taxName = c.country === "US" ? "Tax" : "VAT";

  return (
    <>
      <SubHeader back={contact ? `/m/${token}/contacts/${contact.id}` : `/m/${token}/docs`} title={docTitle(doc)} />
      <Flash ok={sp.ok} err={sp.err} />
      <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
        <Card>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-neutral-500">{contact ? (contact.name ?? displayPhone(contact.phone)) : "Customer"}</p>
              <p className="text-3xl font-bold tracking-tight">{money(doc.total_pence, doc.currency)}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${st.tone}`}>{st.label}</span>
          </div>
          <ul className="mt-3 divide-y divide-neutral-100 text-sm">
            {doc.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-2 py-2">
                <span>
                  {it.description}
                  {it.quantity !== 1 && <span className="text-neutral-500"> × {it.quantity}</span>}
                </span>
                <span className="shrink-0">{money(Math.round(it.quantity * it.unitPence), doc.currency)}</span>
              </li>
            ))}
          </ul>
          {Number(doc.vat_percent) > 0 && (
            <p className="flex justify-between border-t border-neutral-100 pt-2 text-sm text-neutral-600">
              <span>
                {taxName} {Number(doc.vat_percent)}%
              </span>
              <span>{money(doc.total_pence - doc.subtotal_pence, doc.currency)}</span>
            </p>
          )}
          {doc.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-600">{doc.notes}</p>}
          <p className="mt-3 text-xs text-neutral-500">
            Created {fullWhen(doc.created_at, tz, locale)}
            {doc.sent_at && ` · sent ${fullWhen(doc.sent_at, tz, locale)}`}
            {doc.accepted_at && ` · accepted ${fullWhen(doc.accepted_at, tz, locale)}`}
            {doc.paid_at && ` · paid ${fullWhen(doc.paid_at, tz, locale)}`}
          </p>
        </Card>

        {doc.status !== "void" && doc.status !== "paid" && (
          <form action={sendDocument}>
            {hidden}
            <button className={primaryBtn}>{doc.status === "draft" ? `Send ${doc.kind} by text` : "Send again"}</button>
          </form>
        )}
        <div className="grid grid-cols-3 gap-2">
          <a href={link} target="_blank" rel="noreferrer" className={`${quietBtn} text-center`}>
            View as customer
          </a>
          <a href={`/m/${token}/docs/${doc.id}/pdf`} target="_blank" rel="noreferrer" className={`${quietBtn} text-center`}>
            PDF
          </a>
          {doc.status === "draft" ? (
            <Link href={`/m/${token}/docs/new?id=${doc.id}`} className={`${quietBtn} text-center`}>
              Edit
            </Link>
          ) : (
            <span className={`${quietBtn} cursor-default text-center text-neutral-400`}>Sent, can&apos;t edit</span>
          )}
        </div>
        {doc.kind === "invoice" && doc.status !== "paid" && doc.status !== "void" && (
          <form action={markPaid}>
            {hidden}
            <button className="w-full rounded-xl bg-green-600 px-4 py-3.5 text-base font-semibold text-white">Mark as paid</button>
            <label className="mt-2 flex items-center gap-2 text-sm text-neutral-600">
              <input type="checkbox" name="review" defaultChecked /> Also ask them for a Google review
            </label>
          </form>
        )}
        {doc.kind === "quote" && doc.status !== "void" && doc.status !== "draft" && (
          <form action={quoteToInvoice}>
            {hidden}
            <button className={quietBtn}>Turn into an invoice</button>
          </form>
        )}
        <p className="break-all rounded-xl bg-neutral-100 p-3 text-xs text-neutral-600">Customer link: {link}</p>
        {doc.status !== "void" && doc.status !== "paid" && (
          <form action={voidDocument}>
            {hidden}
            <button className="w-full py-2 text-sm text-red-600">Void this {doc.kind}</button>
          </form>
        )}
      </main>
    </>
  );
}
