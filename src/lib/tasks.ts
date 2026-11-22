import "server-only";
import { db } from "@/lib/supabase";
import { zonedParts, zonedToUtc } from "@/lib/crm";

export type ContactTask = {
  id: string;
  client_id: string;
  contact_id: string | null;
  title: string;
  due_at: string;
  done_at: string | null;
  notified_at: string | null;
  created_at: string;
  contacts?: { name: string | null; phone: string } | null;
};

export const WHEN_PRESETS = [
  { key: "1h", label: "In an hour" },
  { key: "today", label: "Today, 5pm" },
  { key: "tomorrow", label: "Tomorrow, 9am" },
  { key: "3d", label: "In 3 days, 9am" },
  { key: "week", label: "Next week, 9am" },
  { key: "month", label: "In a month, 9am" },
] as const;

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** A preset ("tomorrow") or a picked date and time, in the business's time zone. */
export function dueFrom(preset: string, date: string, time: string, tz: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return zonedToUtc(date, /^\d{2}:\d{2}$/.test(time) ? time : "09:00", tz);
  const now = new Date();
  const today = zonedParts(now, tz).ymd;
  switch (preset) {
    case "1h":
      return new Date(now.getTime() + 60 * 60_000);
    case "today": {
      const five = zonedToUtc(today, "17:00", tz);
      return five > now ? five : new Date(now.getTime() + 60 * 60_000);
    }
    case "3d":
      return zonedToUtc(addDays(today, 3), "09:00", tz);
    case "week":
      return zonedToUtc(addDays(today, 7), "09:00", tz);
    case "month":
      return zonedToUtc(addDays(today, 30), "09:00", tz);
    default:
      return zonedToUtc(addDays(today, 1), "09:00", tz);
  }
}

export async function openTasks(clientId: string, opts: { contactId?: string; dueBy?: Date; limit?: number } = {}) {
  let q = db().from("contact_tasks").select("*, contacts(name, phone)").eq("client_id", clientId).is("done_at", null);
  if (opts.contactId) q = q.eq("contact_id", opts.contactId);
  if (opts.dueBy) q = q.lte("due_at", opts.dueBy.toISOString());
  const { data } = await q.order("due_at", { ascending: true }).limit(opts.limit ?? 100).returns<ContactTask[]>();
  return data ?? [];
}

/** Open tasks due before the end of today in the business's time zone. */
export async function dueTodayCount(clientId: string, tz: string) {
  const end = zonedToUtc(addDays(zonedParts(new Date(), tz).ymd, 1), "00:00", tz);
  const { count } = await db().from("contact_tasks").select("id", { count: "exact", head: true }).eq("client_id", clientId).is("done_at", null).lt("due_at", end.toISOString());
  return count ?? 0;
}
