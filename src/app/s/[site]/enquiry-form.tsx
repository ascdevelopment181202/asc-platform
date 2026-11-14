"use client";

import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { submitEnquiry, type EnquiryState } from "./enquiry-action";

const field = "mt-1.5 block w-full rounded-lg border border-slate-300 px-3.5 py-3 text-base outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20";

export function EnquiryForm({ siteId, services, defaultService }: { siteId: string; services: string[]; defaultService?: string }) {
  const path = usePathname();
  const [state, action, pending] = useActionState<EnquiryState, FormData>(submitEnquiry.bind(null, siteId), { ok: false });

  if (state.ok) {
    return (
      <div className="rounded-2xl bg-green-50 p-8 text-green-900 ring-1 ring-green-200">
        <p className="text-xl font-semibold">Thanks, we&apos;ve got your message</p>
        <p className="mt-2">We&apos;ll be in touch shortly. If it&apos;s urgent, please give us a call.</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 sm:p-8">
      <input type="hidden" name="path" value={path} />
      <div className="hidden" aria-hidden>
        <label>Company <input name="company" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Your name<input name="name" required className={field} autoComplete="name" /></label>
        <label className="block text-sm font-medium">Phone<input name="phone" type="tel" className={field} autoComplete="tel" /></label>
        <label className="block text-sm font-medium">Email<input name="email" type="email" className={field} autoComplete="email" /></label>
        <label className="block text-sm font-medium">Postcode<input name="postcode" className={field} autoComplete="postal-code" /></label>
      </div>
      {services.length > 0 && (
        <label className="block text-sm font-medium">
          What do you need?
          <select name="service" defaultValue={defaultService ?? ""} className={field}>
            <option value="">Choose a service</option>
            {services.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="Something else">Something else</option>
          </select>
        </label>
      )}
      <label className="block text-sm font-medium">Tell us a bit about the job<textarea name="message" rows={4} className={field} /></label>
      {state.error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-full bg-[var(--brand)] px-6 py-4 text-base font-semibold text-white hover:opacity-90 disabled:opacity-60">
        {pending ? "Sending..." : "Get my free quote"}
      </button>
      <p className="text-center text-xs text-slate-500">We usually reply within a few hours.</p>
    </form>
  );
}
