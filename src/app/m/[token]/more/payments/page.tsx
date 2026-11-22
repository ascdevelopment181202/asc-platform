import { notFound } from "next/navigation";
import { loadClient } from "../../data";
import { field, Flash, primaryBtn, SubHeader } from "../../ui";
import { savePaymentSettings } from "../../settings-actions";

export const dynamic = "force-dynamic";

export default async function PaymentSettings({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const d = c.invoice_details ?? {};
  const us = c.country === "US";
  return (
    <>
      <SubHeader back={`/m/${token}/more`} title="Business details and branding" />
      <Flash ok={sp.ok} err={sp.err} />
      <main className="mx-auto max-w-xl p-4 pb-16">
        <form action={savePaymentSettings} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">Your branding</h2>
            <p className="text-sm text-neutral-600">Shown on your quotes, invoices, PDFs and the review page your customers see.</p>
            {c.logo_url && (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.logo_url} alt="Your logo" className="h-14 max-w-[180px] rounded border border-neutral-200 bg-white object-contain p-1" />
                <label className="flex items-center gap-2 text-sm text-neutral-600">
                  <input type="checkbox" name="removeLogo" /> Remove
                </label>
              </div>
            )}
            <label className="block text-sm text-neutral-600">
              {c.logo_url ? "Replace logo" : "Logo"} (PNG or JPG)
              <input name="logo" type="file" accept="image/png,image/jpeg" className="mt-1 block w-full text-sm" />
            </label>
            <label className="flex items-center gap-3 text-sm text-neutral-600">
              Brand colour
              <input name="brandColor" type="color" defaultValue={c.brand_color ?? "#2a78d6"} className="h-10 w-16 rounded border border-neutral-200" />
            </label>
          </section>
          <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">On your quotes and invoices</h2>
            <input name="businessPhone" defaultValue={d.businessPhone} placeholder="Business phone" className={field} />
            <input name="businessEmail" type="email" defaultValue={d.businessEmail} placeholder="Business email" className={field} />
            <input name="website" defaultValue={d.website} placeholder="Website" className={field} />
            <textarea name="businessAddress" rows={3} defaultValue={d.businessAddress} placeholder="Business address" className={field} />
            <input name="companyNumber" defaultValue={d.companyNumber} placeholder={us ? "Business registration number (optional)" : "Company number (optional)"} className={field} />
            <input name="vatNumber" defaultValue={d.vatNumber} placeholder={us ? "Tax ID (optional)" : "VAT number (if VAT registered)"} className={field} />
            <label className="block text-sm text-neutral-600">
              Default {us ? "sales tax" : "VAT"} %
              <input name="defaultVatPercent" inputMode="decimal" defaultValue={d.defaultVatPercent ?? 0} className={`${field} mt-1`} />
            </label>
            <textarea name="paymentTerms" rows={2} defaultValue={d.paymentTerms} placeholder="Default invoice note (e.g. Payment due within 14 days. Thank you!)" className={field} />
          </section>
          <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">How customers pay you</h2>
            <p className="text-sm text-neutral-600">These show on your invoices. Add a card payment link, bank details, or both.</p>
            <input name="paymentLink" type="url" defaultValue={d.paymentLink} placeholder="Card payment link (Stripe, SumUp, PayPal...)" className={field} />
            <input name="accountName" defaultValue={d.accountName} placeholder="Account name" className={field} />
            <input name="bankName" defaultValue={d.bankName} placeholder="Bank" className={field} />
            {us ? (
              <input name="routingNumber" defaultValue={d.routingNumber} placeholder="Routing number" className={field} />
            ) : (
              <input name="sortCode" defaultValue={d.sortCode} placeholder="Sort code" className={field} />
            )}
            <input name="accountNumber" defaultValue={d.accountNumber} placeholder="Account number" className={field} />
          </section>
          <button className={primaryBtn}>Save</button>
        </form>
      </main>
    </>
  );
}
