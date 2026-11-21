import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import { dayLabel, timeLabel, zonedParts, type Appointment } from "@/lib/crm";
import { loadClient, loadContact } from "../../data";
import { Card, field, Flash, primaryBtn, quietBtn, SubHeader } from "../../ui";
import { cancelAppointment, markAppointmentDone, updateAppointment } from "../../calendar-actions";

export const dynamic = "force-dynamic";

/** One booking: who, when, where, and done / move / cancel. */
export default async function BookingPage({ params, searchParams }: { params: Promise<{ token: string; id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token, id } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c || !/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data: a } = await db().from("appointments").select("*").eq("id", id).eq("client_id", c.id).maybeSingle<Appointment>();
  if (!a) notFound();
  const contact = a.contact_id ? await loadContact(c.id, a.contact_id) : null;
  const tz = c.timezone || "Europe/London";
  const locale = localeFor(c.country);
  const start = zonedParts(new Date(a.starts_at), tz);
  const end = zonedParts(new Date(a.ends_at), tz);
  const minutes = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000);
  const hidden = (
    <>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="id" value={a.id} />
    </>
  );

  return (
    <>
      <SubHeader back={`/m/${token}/calendar?day=${start.ymd}`} title="Booking" />
      <Flash ok={sp.ok} err={sp.err} />
      <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
        <Card>
          <p className={`text-xl font-semibold ${a.status === "cancelled" ? "line-through opacity-60" : ""}`}>{a.title}</p>
          <p className="mt-1 text-neutral-700">
            {dayLabel(start.ymd, tz, locale, true)}, {timeLabel(start.hm, locale)} to {timeLabel(end.hm, locale)}
          </p>
          <p className="mt-1 text-sm capitalize text-neutral-500">
            {a.status}
            {a.source === "booking" ? " · booked online by the customer" : ""}
          </p>
          {a.address && (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(a.address)}`} className="mt-2 block text-sm font-medium text-[#2a78d6]">
              📍 {a.address}
            </a>
          )}
          {a.notes && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-amber-50 p-3 text-sm">{a.notes}</p>}
        </Card>

        {contact && (
          <Card title="Customer">
            <Link href={`/m/${token}/contacts/${contact.id}`} className="font-medium">
              {contact.name ?? displayPhone(contact.phone)}
            </Link>
            <p className="text-sm text-neutral-500">{displayPhone(contact.phone)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={`tel:${contact.phone}`} className={`${quietBtn} text-center`}>Call</a>
              <Link href={`/m/${token}/c/${contact.id}`} className={`${quietBtn} text-center`}>Message</Link>
            </div>
          </Card>
        )}

        {a.status === "booked" && (
          <>
            <form action={markAppointmentDone} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
              {hidden}
              {contact && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="review" defaultChecked className="size-4" /> Ask them for a Google review
                </label>
              )}
              <button className="w-full rounded-xl bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white">Mark job as done</button>
            </form>
            <details className="rounded-2xl bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-semibold">Change booking</summary>
              <form action={updateAppointment} className="mt-3 space-y-2">
                {hidden}
                <input name="title" defaultValue={a.title} className={field} />
                <div className="grid grid-cols-2 gap-2">
                  <input name="date" type="date" defaultValue={start.ymd} className={field} />
                  <input name="time" type="time" defaultValue={start.hm} step={900} className={field} />
                </div>
                <input name="duration" type="number" min={15} step={15} defaultValue={minutes} className={field} aria-label="Length in minutes" />
                <input name="address" defaultValue={a.address ?? ""} placeholder="Address" className={field} />
                <textarea name="notes" rows={2} defaultValue={a.notes ?? ""} placeholder="Notes" className={field} />
                {contact && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="notify" defaultChecked className="size-4" /> Text the customer if the time changes
                  </label>
                )}
                <button className={primaryBtn}>Save changes</button>
              </form>
            </details>
            <form action={cancelAppointment} className="space-y-2">
              {hidden}
              {contact && (
                <label className="flex items-center justify-center gap-2 text-sm">
                  <input type="checkbox" name="notify" defaultChecked className="size-4" /> Let the customer know
                </label>
              )}
              <button className="w-full rounded-xl px-4 py-3 text-base font-medium text-red-600 ring-1 ring-red-200">Cancel booking</button>
            </form>
          </>
        )}
      </main>
    </>
  );
}
