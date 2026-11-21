import { notFound } from "next/navigation";
import { displayPhone } from "@/lib/phone";
import { todayYmd } from "@/lib/crm";
import { loadClient, loadContact } from "../../data";
import { field, primaryBtn, SubHeader } from "../../ui";
import { createAppointment } from "../../calendar-actions";

export const dynamic = "force-dynamic";

export default async function NewBooking({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ contact?: string; date?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const contact = sp.contact ? await loadContact(c.id, sp.contact) : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayYmd(c.timezone || "Europe/London");
  const back = contact ? `/m/${token}/contacts/${contact.id}` : `/m/${token}/calendar?day=${date}`;
  return (
    <>
      <SubHeader back={back} title="New booking" />
      <main className="mx-auto max-w-xl p-4">
        {sp.err && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">{sp.err}</p>}
        <form action={createAppointment} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <input type="hidden" name="token" value={token} />
          {contact ? (
            <>
              <input type="hidden" name="contactId" value={contact.id} />
              <p className="rounded-xl bg-neutral-100 px-4 py-3 text-sm">
                Customer: <strong>{contact.name ?? displayPhone(contact.phone)}</strong>
              </p>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input name="name" placeholder="Customer name" className={field} />
              <input name="phone" type="tel" inputMode="tel" placeholder="Mobile (optional)" className={field} />
            </div>
          )}
          <input name="title" placeholder="What's the job? (e.g. Boiler service)" className={field} />
          <div className="grid grid-cols-2 gap-2">
            <input name="date" type="date" defaultValue={date} required className={field} />
            <input name="time" type="time" defaultValue="09:00" step={900} required className={field} />
          </div>
          <select name="duration" defaultValue="60" className={field}>
            {[30, 60, 90, 120, 180, 240, 480].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 480 ? "All day (8 hours)" : `${m / 60} hour${m > 60 ? "s" : ""}`}
              </option>
            ))}
          </select>
          <input name="address" defaultValue={contact?.address ?? ""} placeholder="Address" className={field} />
          <textarea name="notes" rows={2} placeholder="Notes (only you see these)" className={field} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" defaultChecked className="size-4" /> Text the customer a confirmation (and a reminder the day before)
          </label>
          <button className={primaryBtn}>Save booking</button>
        </form>
      </main>
    </>
  );
}
