import { notFound } from "next/navigation";
import { STAGES } from "@/lib/crm";
import { loadClient } from "../../data";
import { field, primaryBtn, SubHeader } from "../../ui";
import { createContact } from "../../crm-actions";

export const dynamic = "force-dynamic";

export default async function NewContact({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string }> }) {
  const { token } = await params;
  const { err } = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const us = c.country === "US";
  return (
    <>
      <SubHeader back={`/m/${token}/contacts`} title="New contact" />
      <main className="mx-auto max-w-xl p-4">
        {err && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">{err}</p>}
        <form action={createContact} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <input type="hidden" name="token" value={token} />
          <input name="name" placeholder="Name" className={field} autoFocus />
          <input name="phone" type="tel" inputMode="tel" required placeholder={us ? "Cell number" : "Mobile (07...)"} className={field} />
          <input name="email" type="email" placeholder="Email (optional)" className={field} />
          <input name="address" placeholder={us ? "Address and ZIP (optional)" : "Address and postcode (optional)"} className={field} />
          <input name="tags" placeholder="Tags, comma separated (e.g. boiler, landlord)" className={field} />
          <select name="stage" defaultValue="new" className={field}>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <button className={primaryBtn}>Save contact</button>
        </form>
      </main>
    </>
  );
}
