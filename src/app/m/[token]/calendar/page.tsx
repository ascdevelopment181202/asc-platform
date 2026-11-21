import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import { addDays, dayChip, dayLabel, timeLabel, todayYmd, zonedParts, zonedToUtc, type Appointment } from "@/lib/crm";
import { env } from "@/lib/env";
import { loadClient, unreadTotal } from "../data";
import { AppShell, PlusButton } from "../ui";

export const dynamic = "force-dynamic";

type Row = Appointment & { contacts: { name: string | null; phone: string } | null };

/** Day view with a two-week strip, like a phone calendar. */
export default async function Calendar({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ day?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const tz = c.timezone || "Europe/London";
  const locale = localeFor(c.country);
  const today = todayYmd(tz);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : today;
  const stripStart = day < today ? day : today;
  const strip = Array.from({ length: 14 }, (_, i) => addDays(stripStart, i));

  const [{ data: rows }, unread] = await Promise.all([
    db()
      .from("appointments")
      .select("*, contacts(name, phone)")
      .eq("client_id", c.id)
      .gte("starts_at", zonedToUtc(strip[0], "00:00", tz).toISOString())
      .lt("starts_at", zonedToUtc(addDays(strip[13], 1), "00:00", tz).toISOString())
      .order("starts_at")
      .returns<Row[]>(),
    unreadTotal(c.id),
  ]);
  const byDay = new Map<string, Row[]>();
  for (const r of rows ?? []) {
    const d = zonedParts(new Date(r.starts_at), tz).ymd;
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const list = byDay.get(day) ?? [];

  return (
    <AppShell token={token} active="calendar" unread={unread} title="Calendar" action={<PlusButton href={`/m/${token}/calendar/new?date=${day}`} label="New booking" />}>
      <div className="sticky top-[61px] z-10 flex gap-1.5 overflow-x-auto bg-[#f4f5f7] px-4 py-3">
        {strip.map((d) => {
          const active = d === day;
          const count = (byDay.get(d) ?? []).filter((a) => a.status !== "cancelled").length;
          const { wd, num } = dayChip(d, tz, locale);
          return (
            <Link key={d} href={`/m/${token}/calendar?day=${d}`} className={`flex w-12 shrink-0 flex-col items-center rounded-2xl py-2 ${active ? "bg-[#2a78d6] text-white" : "bg-white ring-1 ring-neutral-200"}`}>
              <span className="text-[11px] uppercase">{wd}</span>
              <span className="text-lg font-semibold leading-tight">{num}</span>
              <span className={`mt-0.5 size-1.5 rounded-full ${count ? (active ? "bg-white" : "bg-[#2a78d6]") : "bg-transparent"}`} />
            </Link>
          );
        })}
      </div>

      <div className="px-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-600">{d2(day, today, tz, locale)}</h2>
        {list.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
            Nothing booked.{" "}
            <Link href={`/m/${token}/calendar/new?date=${day}`} className="font-medium text-[#2a78d6]">
              Add a booking
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((a) => {
              const start = zonedParts(new Date(a.starts_at), tz).hm;
              const end = zonedParts(new Date(a.ends_at), tz).hm;
              return (
                <li key={a.id}>
                  <Link href={`/m/${token}/calendar/${a.id}`} className={`flex gap-3 rounded-2xl bg-white p-3 shadow-sm active:bg-neutral-50 ${a.status === "cancelled" ? "opacity-50" : ""}`}>
                    <div className={`w-1 shrink-0 rounded-full ${a.status === "done" ? "bg-emerald-500" : a.status === "cancelled" ? "bg-neutral-300" : "bg-[#2a78d6]"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {timeLabel(start, locale)} to {timeLabel(end, locale)}
                        {a.source === "booking" && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">Booked online</span>}
                      </p>
                      <p className={`truncate ${a.status === "cancelled" ? "line-through" : ""}`}>{a.title}</p>
                      <p className="truncate text-sm text-neutral-500">
                        {a.contacts ? (a.contacts.name ?? displayPhone(a.contacts.phone)) : "No customer"}
                        {a.address ? ` · ${a.address}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 self-center text-xs capitalize text-neutral-500">{a.status === "booked" ? "" : a.status}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {c.booking_enabled && (
          <p className="mt-4 text-center text-xs text-neutral-500">
            Customers can book themselves at <span className="break-all font-medium text-neutral-700">{env.appUrl.replace(/^https:\/\//, "")}/b/{c.booking_token}</span>
          </p>
        )}
      </div>
    </AppShell>
  );
}

function d2(day: string, today: string, tz: string, locale: string) {
  if (day === today) return `Today, ${dayLabel(day, tz, locale, true)}`;
  if (day === addDays(today, 1)) return `Tomorrow, ${dayLabel(day, tz, locale, true)}`;
  return dayLabel(day, tz, locale, true);
}
