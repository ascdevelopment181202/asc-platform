import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { localeFor } from "@/lib/phone";
import { addDays, dayLabel, freeSlots, timeLabel, todayYmd } from "@/lib/crm";
import { bookSlot } from "./actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ day?: string; time?: string; done?: string; when?: string; err?: string }> };

async function load(token: string) {
  if (!/^[0-9a-f]{16}$/.test(token)) return null;
  const { data } = await db().from("clients").select("*").eq("booking_token", token).maybeSingle<Client>();
  return data?.booking_enabled ? data : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await load((await params).token);
  return { title: c ? `Book with ${clientLabel(c)}` : "Booking", robots: { index: false, follow: false } };
}

/** Public booking page: pick a day, pick a time, leave your details. */
export default async function BookingPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await load(token);
  if (!c) notFound();
  const tz = c.timezone || "Europe/London";
  const locale = localeFor(c.country);
  const us = c.country === "US";
  const name = clientLabel(c);

  const shell = (children: React.ReactNode) => (
    <div className="min-h-dvh bg-[#f4f5f7] px-4 py-8 text-neutral-900">
      <div className="mx-auto max-w-md">
        <p className="text-sm font-medium text-neutral-500">Book with</p>
        <h1 className="text-2xl font-bold tracking-tight">{name}</h1>
        {sp.err && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900">{sp.err}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );

  if (sp.done) {
    return shell(
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="text-4xl">✅</p>
        <h2 className="mt-2 text-xl font-semibold">You&apos;re booked in</h2>
        {sp.when && <p className="mt-1 text-neutral-700">{sp.when}</p>}
        <p className="mt-3 text-sm text-neutral-500">We&apos;ve sent you a text to confirm. Reply to it if you need to change anything.</p>
      </div>,
    );
  }

  const today = todayYmd(tz);
  const days = Array.from({ length: Math.min(c.booking_days_ahead || 14, 30) }, (_, i) => addDays(today, i));
  const day = days.includes(sp.day ?? "") ? sp.day! : null;

  if (day && sp.time && /^\d{2}:\d{2}$/.test(sp.time)) {
    return shell(
      <form action={bookSlot} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
        <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm">
          <strong>{dayLabel(day, tz, locale, true)}</strong> at <strong>{timeLabel(sp.time, locale)}</strong>{" "}
          <Link href={`/b/${token}?day=${day}`} className="ml-1 text-[#2a78d6] underline">
            change
          </Link>
        </p>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="day" value={day} />
        <input type="hidden" name="time" value={sp.time} />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <input name="name" required placeholder="Your name" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
        <input name="phone" type="tel" inputMode="tel" required placeholder={us ? "Cell number" : "Mobile number"} className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
        <input name="email" type="email" autoComplete="email" placeholder="Email (for your confirmation)" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
        <input name="address" placeholder={us ? "Address and ZIP" : "Address and postcode"} className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
        <textarea name="what" rows={3} placeholder="What do you need help with?" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
        <button className="w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-base font-semibold text-white">Confirm booking</button>
        <p className="text-center text-xs text-neutral-500">You&apos;ll get a text confirmation. Reply STOP to opt out of texts.</p>
      </form>,
    );
  }

  const slots = day ? await freeSlots(c, day) : [];
  const openDays = day ? [] : (await Promise.all(days.map(async (d) => ((await freeSlots(c, d)).length ? d : null)))).filter(Boolean) as string[];

  if (day) {
    return shell(
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{dayLabel(day, tz, locale, true)}</h2>
          <Link href={`/b/${token}`} className="text-sm text-[#2a78d6]">
            Other days
          </Link>
        </div>
        {slots.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">No times left on this day.</p>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {slots.map((t) => (
              <Link key={t} href={`/b/${token}?day=${day}&time=${t}`} className="rounded-xl py-3 text-center font-medium ring-1 ring-[#2a78d6] text-[#2a78d6] active:bg-blue-50">
                {timeLabel(t, locale)}
              </Link>
            ))}
          </div>
        )}
      </div>,
    );
  }

  return shell(
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Pick a day</h2>
      {openDays.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">No times available online right now. Please call or text us.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {openDays.map((d) => (
            <Link key={d} href={`/b/${token}?day=${d}`} className="rounded-xl px-3 py-3 text-center font-medium ring-1 ring-neutral-300 active:bg-neutral-50">
              {d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : dayLabel(d, tz, locale)}
            </Link>
          ))}
        </div>
      )}
    </div>,
  );
}
