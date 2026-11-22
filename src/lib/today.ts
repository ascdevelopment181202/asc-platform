import "server-only";
import { db, type Client } from "@/lib/supabase";
import { REVIEW_COOLDOWN_MS, type Contact } from "@/lib/sms";
import { zonedParts, zonedToUtc, type LineItem } from "@/lib/crm";

export type TodayRow = {
  contact: Contact;
  why: string; // "Booked: tap replacement"
  label: string | null; // what the job was, for the personal text
  appointmentId: string | null;
  strength: number; // 0 = almost certainly a finished job ... 3 = just a conversation
  asked: { jobId: string; at: string } | null; // already has a review request
};

/**
 * Everyone the business dealt with today, most likely finished jobs first:
 * bookings, then invoices, then customers moved to Booked or Job done, then anyone texted or called.
 */
export async function todaysCustomers(c: Client): Promise<TodayRow[]> {
  const tz = c.timezone || "Europe/London";
  const ymd = zonedParts(new Date(), tz).ymd;
  const start = zonedToUtc(ymd, "00:00", tz).toISOString();
  const end = new Date(Date.parse(start) + 86400_000).toISOString();

  const [{ data: appts }, { data: docs }, { data: staged }, { data: talked }] = await Promise.all([
    db().from("appointments").select("id, title, contact_id, status").eq("client_id", c.id).neq("status", "cancelled").gte("starts_at", start).lt("starts_at", end).not("contact_id", "is", null).returns<{ id: string; title: string; contact_id: string; status: string }[]>(),
    db().from("documents").select("contact_id, kind, items, sent_at, paid_at").eq("client_id", c.id).eq("kind", "invoice").not("contact_id", "is", null).or(`paid_at.gte.${start},sent_at.gte.${start}`).returns<{ contact_id: string; kind: string; items: LineItem[]; sent_at: string | null; paid_at: string | null }[]>(),
    db().from("contacts").select("*").eq("client_id", c.id).in("stage", ["booked", "done", "paid"]).gte("stage_changed_at", start).returns<Contact[]>(),
    db().from("contacts").select("*").eq("client_id", c.id).gte("last_message_at", start).limit(60).returns<Contact[]>(),
  ]);

  const picks = new Map<string, Omit<TodayRow, "contact" | "asked">>();
  const add = (id: string, row: Omit<TodayRow, "contact" | "asked">) => {
    const prev = picks.get(id);
    if (!prev || row.strength < prev.strength) picks.set(id, { ...row, label: row.label ?? prev?.label ?? null, appointmentId: row.appointmentId ?? prev?.appointmentId ?? null });
  };
  for (const a of appts ?? []) add(a.contact_id, { why: `Booked today: ${a.title}`, label: a.title, appointmentId: a.id, strength: 0 });
  for (const d of docs ?? []) add(d.contact_id, { why: d.paid_at && d.paid_at >= start ? "Paid an invoice today" : "Sent an invoice today", label: d.items?.[0]?.description ?? null, appointmentId: null, strength: 1 });
  for (const ct of staged ?? []) add(ct.id, { why: ct.stage === "booked" ? "Marked as booked" : "Marked as job done", label: null, appointmentId: null, strength: 2 });
  for (const ct of talked ?? []) add(ct.id, { why: ct.last_message_direction === "call" ? "Called today" : "Texted today", label: null, appointmentId: null, strength: 3 });
  if (!picks.size) return [];

  const ids = [...picks.keys()];
  const [{ data: contacts }, { data: jobs }] = await Promise.all([
    db().from("contacts").select("*").in("id", ids).returns<Contact[]>(),
    db().from("jobs").select("id, contact_id, created_at, cancelled_at").in("contact_id", ids).is("cancelled_at", null).gte("created_at", new Date(Date.now() - REVIEW_COOLDOWN_MS).toISOString()).order("created_at", { ascending: false }).returns<{ id: string; contact_id: string; created_at: string }[]>(),
  ]);
  const askedBy = new Map<string, { jobId: string; at: string }>();
  for (const j of jobs ?? []) if (!askedBy.has(j.contact_id)) askedBy.set(j.contact_id, { jobId: j.id, at: j.created_at });

  return (contacts ?? [])
    .filter((ct) => !ct.opted_out_at)
    .map((ct) => ({ contact: ct, asked: askedBy.get(ct.id) ?? null, ...picks.get(ct.id)! }))
    .sort((a, b) => Number(!!a.asked) - Number(!!b.asked) || a.strength - b.strength);
}
