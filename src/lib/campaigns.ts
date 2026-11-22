import "server-only";
import { db, type Client } from "@/lib/supabase";
import { isTextable } from "@/lib/phone";
import { businessName, countryOf, senderLine, type Contact } from "@/lib/sms";
import { fillCampaign } from "@/lib/campaign-presets";
import { a2pStatus } from "@/lib/twilio";

export type Audience = {
  who: "all" | "lapsed" | "past"; // everyone · not heard from in N months · had a job done or paid
  months: number; // for "lapsed"
  tag: string; // optional extra filter
};

export const PER_HOUR = 100;
export const MAX_RECIPIENTS = 1000;
const DAY = 86400_000;

export function audienceFrom(sp: Record<string, string | undefined>): Audience {
  const who = sp.who === "lapsed" || sp.who === "past" ? sp.who : "all";
  const months = [3, 6, 12, 24].includes(Number(sp.months)) ? Number(sp.months) : 6;
  return { who, months, tag: (sp.tag ?? "").trim().toLowerCase() };
}

export function describeAudience(a: Audience) {
  const base = a.who === "lapsed" ? `customers you haven't heard from in ${a.months} months` : a.who === "past" ? "customers you've done a job for" : "all your customers";
  return a.tag ? `${base}, tagged #${a.tag}` : base;
}

/**
 * Who a campaign would go to: textable, not opted out, and not sent another campaign in the last 30 days.
 * Returns the recipients plus how many were left out and why.
 */
export async function buildAudience(c: Client, a: Audience) {
  let q = db().from("contacts").select("*").eq("client_id", c.id).is("opted_out_at", null);
  if (a.who === "past") q = q.in("stage", ["done", "paid"]);
  if (a.who === "lapsed") q = q.or(`last_message_at.is.null,last_message_at.lt.${new Date(Date.now() - a.months * 30 * DAY).toISOString()}`);
  if (a.tag) q = q.contains("tags", [a.tag]);
  const { data } = await q.limit(5000).returns<Contact[]>();
  const country = countryOf(c);
  const textable = (data ?? []).filter((ct) => isTextable(ct.phone, country));

  const { data: recent } = await db()
    .from("outbox")
    .select("contact_id")
    .eq("client_id", c.id)
    .not("campaign_id", "is", null)
    .gte("created_at", new Date(Date.now() - 30 * DAY).toISOString())
    .returns<{ contact_id: string }[]>();
  const recentIds = new Set((recent ?? []).map((r) => r.contact_id));
  const recipients = textable.filter((ct) => !recentIds.has(ct.id));
  return { recipients, skippedRecent: textable.length - recipients.length, skippedNoMobile: (data ?? []).length - textable.length };
}

/** Can this client send campaign texts right now? (US numbers need their registration approved first.) */
export async function campaignBlocker(c: Client): Promise<string | null> {
  if (!c.twilio_number || !c.sms_enabled) return "Texts aren't switched on for you yet. ASC will let you know when they are.";
  if (c.country === "US") {
    const status = c.messaging_service_sid ? await a2pStatus(c.messaging_service_sid) : "not registered";
    if (!status.includes("verified")) return "Your texting registration is still being approved, so campaigns can't go out yet.";
  }
  return null;
}

/** Queues one text per recipient, about 100 an hour, inside 9am to 7pm (the cron sends them). */
export async function queueCampaign(c: Client, name: string, body: string, a: Audience, recipients: Contact[]) {
  const { data: campaign, error } = await db()
    .from("campaigns")
    .insert({ client_id: c.id, name, body, audience: a, recipients: recipients.length })
    .select("id")
    .single<{ id: string }>();
  if (error || !campaign) throw error ?? new Error("Couldn't save the campaign");
  const start = Date.now() + 2 * 60_000;
  const vars = { sender: senderLine(c), business: businessName(c) };
  const rows = recipients.map((ct, i) => ({
    client_id: c.id,
    contact_id: ct.id,
    campaign_id: campaign.id,
    body: fillCampaign(body, { ...vars, name: ct.name }),
    send_at: new Date(start + Math.floor((i * 3600_000) / PER_HOUR)).toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await db().from("outbox").insert(rows.slice(i, i + 500));
    if (e) throw e;
  }
  return campaign.id;
}

export type CampaignStats = { id: string; name: string; created_at: string; recipients: number; sent: number; queued: number; replies: number };

export async function campaignStats(clientId: string, limit = 20): Promise<CampaignStats[]> {
  const { data: camps } = await db().from("campaigns").select("id, name, created_at, recipients").eq("client_id", clientId).order("created_at", { ascending: false }).limit(limit).returns<{ id: string; name: string; created_at: string; recipients: number }[]>();
  if (!camps?.length) return [];
  const { data: rows } = await db()
    .from("outbox")
    .select("campaign_id, sent_at, cancelled_at, contacts(last_message_at, last_message_direction)")
    .in("campaign_id", camps.map((x) => x.id))
    .returns<{ campaign_id: string; sent_at: string | null; cancelled_at: string | null; contacts: { last_message_at: string | null; last_message_direction: string | null } | null }[]>();
  return camps.map((camp) => {
    const mine = (rows ?? []).filter((r) => r.campaign_id === camp.id);
    const sent = mine.filter((r) => r.sent_at);
    return {
      ...camp,
      sent: sent.length,
      queued: mine.filter((r) => !r.sent_at && !r.cancelled_at).length,
      // A reply = their latest message is from them, after our campaign text went out.
      replies: sent.filter((r) => r.contacts?.last_message_direction === "inbound" && (r.contacts.last_message_at ?? "") > r.sent_at!).length,
    };
  });
}
