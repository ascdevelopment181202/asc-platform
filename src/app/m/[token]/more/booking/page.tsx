import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { bookingUrl } from "@/lib/crm";
import { DAYS } from "@/lib/onboarding-fields";
import { loadClient } from "../../data";
import { field, Flash, primaryBtn, SubHeader } from "../../ui";
import { saveBookingSettings } from "../../settings-actions";

export const dynamic = "force-dynamic";

export default async function BookingSettings({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { token } = await params;
  const { ok } = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const hours = c.business_hours ?? { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] };
  const url = bookingUrl(c, env.appUrl);
  return (
    <>
      <SubHeader back={`/m/${token}/more`} title="Booking link and hours" />
      <Flash ok={ok} />
      <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="font-semibold">Your booking link</p>
          <a href={url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-[#2a78d6]">
            {url}
          </a>
        </div>
        <form action={saveBookingSettings} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <input type="hidden" name="token" value={token} />
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="enabled" defaultChecked={c.booking_enabled} className="size-4" /> Let customers book online
          </label>
          <div>
            <p className="text-sm font-medium">Working days and hours</p>
            <p className="text-xs text-neutral-500">Also decides when missed callers get the &ldquo;we&apos;re closed&rdquo; text.</p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1.5">
                  <input type="checkbox" name="days" value={i + 1} defaultChecked={hours.days.includes(i + 1)} /> {d}
                </label>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input name="start" type="time" defaultValue={hours.start} className={field} />
              <input name="end" type="time" defaultValue={hours.end} className={field} />
            </div>
          </div>
          <label className="block text-sm font-medium">
            Length of each booking
            <select name="slot" defaultValue={String(c.booking_slot_minutes)} className={`${field} mt-1`}>
              {[30, 60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Minimum notice (hours)
            <input name="notice" type="number" min={0} max={168} defaultValue={c.booking_notice_hours} className={`${field} mt-1`} />
          </label>
          <label className="block text-sm font-medium">
            How many days ahead customers can book
            <input name="ahead" type="number" min={1} max={30} defaultValue={c.booking_days_ahead} className={`${field} mt-1`} />
          </label>
          <button className={primaryBtn}>Save</button>
        </form>
      </main>
    </>
  );
}
