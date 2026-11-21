import "server-only";
import { db, type Client } from "./supabase";
import type { Contact, Stage } from "./sms";

// ---------- Jobs pipeline ----------

export const STAGES: { key: Stage; label: string; tone: string }[] = [
  { key: "new", label: "New lead", tone: "bg-sky-100 text-sky-800" },
  { key: "quoted", label: "Quoted", tone: "bg-violet-100 text-violet-800" },
  { key: "booked", label: "Booked", tone: "bg-amber-100 text-amber-800" },
  { key: "done", label: "Job done", tone: "bg-emerald-100 text-emerald-800" },
  { key: "paid", label: "Paid", tone: "bg-green-600 text-white" },
  { key: "lost", label: "Lost", tone: "bg-neutral-200 text-neutral-600" },
];
export const stageInfo = (s: Stage | null | undefined) => STAGES.find((x) => x.key === s) ?? null;
const ORDER: Stage[] = ["new", "quoted", "booked", "done", "paid"];

/**
 * Moves a customer along the pipeline. Automatic moves (a quote sent, a booking, a payment) only go
 * forward, so they never undo something the client set by hand. Manual moves can go anywhere.
 */
export async function setStage(contact: Pick<Contact, "id" | "stage">, stage: Stage, opts: { manual?: boolean } = {}) {
  if (!opts.manual && contact.stage) {
    if (contact.stage === "lost") return;
    if (ORDER.indexOf(stage) <= ORDER.indexOf(contact.stage)) return;
  }
  await db().from("contacts").update({ stage, stage_changed_at: new Date().toISOString() }).eq("id", contact.id);
}

// ---------- Money ----------

export const currencyFor = (c: Pick<Client, "country">) => (c.country === "US" ? "USD" : "GBP");

export function money(pence: number | null | undefined, currency = "GBP") {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-GB", { style: "currency", currency }).format((pence ?? 0) / 100);
}

/** "125.50" or "£125.50" -> 12550. */
export function parseMoney(raw: string): number | null {
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export type LineItem = { description: string; quantity: number; unitPence: number };

export function totals(items: LineItem[], vatPercent: number) {
  const subtotal = items.reduce((sum, i) => sum + Math.round(i.quantity * i.unitPence), 0);
  const vat = Math.round((subtotal * vatPercent) / 100);
  return { subtotal, vat, total: subtotal + vat };
}

// ---------- Time zones ----------

/** The calendar date ("2026-11-21") and parts of a moment in a time zone. */
export function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hm: `${get("hour")}:${get("minute")}`,
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1,
  };
}

/** "2026-11-21" + "14:30" in Europe/London (or America/Chicago...) -> the real moment, handling summer time. */
export function zonedToUtc(ymd: string, hm: string, timeZone: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (t: number) => {
    const p = zonedParts(new Date(t), timeZone);
    const [py, pm, pd] = p.ymd.split("-").map(Number);
    const [ph, pmin] = p.hm.split(":").map(Number);
    return Date.UTC(py, pm - 1, pd, ph, pmin) - t;
  };
  let t = asIfUtc - offset(asIfUtc);
  t = asIfUtc - offset(t); // second pass settles the hour when summer time starts or ends
  return new Date(t);
}

export function addDays(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// ---------- Booking slots ----------

const toMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const toHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Free start times for the public booking page: inside opening hours, after the minimum notice,
 * and not overlapping anything already in the calendar.
 */
export async function freeSlots(c: Client, ymd: string): Promise<string[]> {
  const tz = c.timezone || "Europe/London";
  const hours = c.business_hours ?? { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5, 6] };
  const dayStart = zonedToUtc(ymd, "00:00", tz);
  const weekday = zonedParts(new Date(dayStart.getTime() + 12 * 3600_000), tz).weekday;
  if (!hours.days.includes(weekday)) return [];

  const len = c.booking_slot_minutes || 60;
  const earliest = Date.now() + (c.booking_notice_hours ?? 4) * 3600_000;
  const { data: busy } = await db()
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("client_id", c.id)
    .neq("status", "cancelled")
    .lt("starts_at", zonedToUtc(addDays(ymd, 1), "00:00", tz).toISOString())
    .gt("ends_at", dayStart.toISOString())
    .returns<{ starts_at: string; ends_at: string }[]>();

  const slots: string[] = [];
  for (let m = toMin(hours.start); m + len <= toMin(hours.end); m += len) {
    const start = zonedToUtc(ymd, toHm(m), tz).getTime();
    const end = start + len * 60_000;
    if (start < earliest) continue;
    if ((busy ?? []).some((b) => Date.parse(b.starts_at) < end && Date.parse(b.ends_at) > start)) continue;
    slots.push(toHm(m));
  }
  return slots;
}

// ---------- Templates ----------

export const DEFAULT_SNIPPETS = [
  { title: "On my way", body: "Hi {name}, I'm on my way now, should be with you in about 20 minutes." },
  { title: "Running late", body: "Hi {name}, sorry, I'm running about 30 minutes behind. Still OK to come over?" },
  { title: "Send photos", body: "Hi {name}, could you send a couple of photos of the problem? It helps me bring the right parts." },
  { title: "Booking link", body: "Hi {name}, you can pick a time that suits you here: {booking}" },
  { title: "Thanks", body: "Thanks {name}, really appreciate your business. Any problems, just text me here." },
];

export type Snippet = { id: string; title: string; body: string };

/** The client's saved replies; a starter set is added the first time they're needed. */
export async function snippetsFor(clientId: string): Promise<Snippet[]> {
  const { data } = await db().from("snippets").select("id, title, body").eq("client_id", clientId).order("created_at").returns<Snippet[]>();
  if (data?.length) return data;
  const { count } = await db().from("client_messages").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("kind", "seeded_snippets");
  if (count) return [];
  await db().from("client_messages").insert({ client_id: clientId, kind: "seeded_snippets" });
  const { data: seeded } = await db()
    .from("snippets")
    .insert(DEFAULT_SNIPPETS.map((s) => ({ client_id: clientId, ...s })))
    .select("id, title, body")
    .returns<Snippet[]>();
  return seeded ?? [];
}

/** Fills {name}, {business} and {booking} in a saved reply. */
export function fillSnippet(body: string, vars: { name: string | null; business: string; booking: string }) {
  return body
    .replace(/\{name\}/g, vars.name?.split(/\s+/)[0] || "there")
    .replace(/\{business\}/g, vars.business)
    .replace(/\{booking\}/g, vars.booking);
}

export const bookingUrl = (c: Pick<Client, "booking_token">, appUrl: string) => `${appUrl}/b/${c.booking_token}`;

/** "Tue 25 Nov" for a calendar date, in the client's locale. */
export function dayLabel(ymd: string, timeZone: string, locale = "en-GB", long = false) {
  return zonedToUtc(ymd, "12:00", timeZone).toLocaleDateString(locale, { weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short", timeZone });
}

/** "10:00" or "10:00 AM" for a time of day. */
export function timeLabel(hm: string, locale = "en-GB") {
  const [h, m] = hm.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/** "Tue 25 Nov at 10:00" for an appointment start, in the client's time zone. */
export function whenLabel(c: Pick<Client, "timezone" | "country">, iso: string) {
  const tz = c.timezone || "Europe/London";
  const locale = c.country === "US" ? "en-US" : "en-GB";
  const p = zonedParts(new Date(iso), tz);
  return `${dayLabel(p.ymd, tz, locale)} at ${timeLabel(p.hm, locale)}`;
}

export type Appointment = {
  id: string;
  client_id: string;
  contact_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  address: string | null;
  notes: string | null;
  status: "booked" | "done" | "cancelled";
  source: "app" | "booking";
  reminder_sent_at: string | null;
};

export const todayYmd = (timeZone: string) => zonedParts(new Date(), timeZone).ymd;

export type Doc = {
  id: string;
  client_id: string;
  contact_id: string;
  kind: "quote" | "invoice";
  number: number;
  items: LineItem[];
  vat_percent: number;
  subtotal_pence: number;
  total_pence: number;
  currency: string;
  notes: string | null;
  due_date: string | null;
  status: "draft" | "sent" | "accepted" | "declined" | "paid" | "void";
  public_token: string;
  sent_at: string | null;
  accepted_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export const docTitle = (d: Pick<Doc, "kind" | "number">) => `${d.kind === "quote" ? "Quote" : "Invoice"} #${d.number}`;
export const docLink = (d: Pick<Doc, "public_token">, appUrl: string) => `${appUrl}/d/${d.public_token}`;

export const DOC_STATUS: Record<Doc["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-neutral-100 text-neutral-600" },
  sent: { label: "Sent", tone: "bg-blue-50 text-blue-800" },
  accepted: { label: "Accepted", tone: "bg-emerald-100 text-emerald-800" },
  declined: { label: "Declined", tone: "bg-red-50 text-red-700" },
  paid: { label: "Paid", tone: "bg-green-600 text-white" },
  void: { label: "Void", tone: "bg-neutral-100 text-neutral-400 line-through" },
};

/** Weekday and day-of-month for the calendar strip ("Sat", "21"). */
export function dayChip(ymd: string, timeZone: string, locale = "en-GB") {
  const d = zonedToUtc(ymd, "12:00", timeZone);
  return {
    wd: d.toLocaleDateString(locale, { weekday: "short", timeZone }),
    num: d.toLocaleDateString(locale, { day: "numeric", timeZone }),
  };
}
