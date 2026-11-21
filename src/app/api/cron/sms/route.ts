import { env } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { clientLabel, once } from "@/lib/clients";
import { notifyAdmin } from "@/lib/email";
import { inSendingWindow, reviewText, sendSms, type Contact, type Job } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Due = { id: string; job_id: string; client_id: string; step: number; send_at: string };

const DAY = 86400_000;
const QUIET_DAYS = 7;

/**
 * Runs every 5 minutes (see vercel.json).
 * 1. Sends review texts that are due, inside 9am to 7pm local time.
 * 2. Warns you when a client's forwarding seems to have stopped (no forwarded calls for a week).
 */
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const sent: string[] = [];
  const skipped: string[] = [];

  const { data: due } = await db()
    .from("review_messages")
    .select("id, job_id, client_id, step, send_at")
    .is("sent_at", null)
    .is("cancelled_at", null)
    .lte("send_at", now.toISOString())
    .order("send_at")
    .limit(100)
    .returns<Due[]>();

  const clients = new Map<string, Client | null>();
  const getClient = async (id: string) => {
    if (!clients.has(id)) {
      const { data } = await db().from("clients").select("*").eq("id", id).maybeSingle<Client>();
      clients.set(id, data);
    }
    return clients.get(id)!;
  };

  for (const m of due ?? []) {
    const c = await getClient(m.client_id);
    if (!c || !c.sms_enabled || !c.google_review_url || !c.twilio_number) {
      skipped.push(`${m.id}: client not set up`);
      continue; // Leave it queued; it goes out once the client is switched on.
    }
    if (!inSendingWindow(c, now)) continue; // Waits for the morning.

    const { data: job } = await db().from("jobs").select("*").eq("id", m.job_id).maybeSingle<Job>();
    const { data: contact } = job
      ? await db().from("contacts").select("*").eq("id", job.contact_id).maybeSingle<Contact>()
      : { data: null };
    if (!job || !contact || job.cancelled_at || job.review_clicked_at || contact.opted_out_at) {
      await db().from("review_messages").update({ cancelled_at: now.toISOString() }).eq("id", m.id);
      skipped.push(`${m.id}: stopped`);
      continue;
    }

    // Claim the row first so an overlapping run can't send it twice.
    const { data: claimed } = await db()
      .from("review_messages")
      .update({ sent_at: now.toISOString() })
      .eq("id", m.id)
      .is("sent_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const result = await sendSms({ client: c, to: contact.phone, body: reviewText(c, contact, job, m.step), kind: "review", contactId: contact.id });
    if (result.logId) await db().from("review_messages").update({ sms_log_id: result.logId }).eq("id", m.id);
    (result.ok ? sent : skipped).push(`${clientLabel(c)} step ${m.step}${result.ok ? "" : `: ${result.error}`}`);
  }

  // Forwarding health check, once a day per client at most.
  const { data: active } = await db()
    .from("clients")
    .select("*")
    .eq("sms_enabled", true)
    .not("twilio_number", "is", null)
    .returns<Client[]>();
  const day = Math.floor(now.getTime() / DAY);
  for (const c of active ?? []) {
    // Switching texts on in admin sets this as a starting point, so a new client gets a week's grace.
    const last = c.last_forwarded_call_at ? Date.parse(c.last_forwarded_call_at) : Date.parse(c.created_at);
    if (now.getTime() - last < QUIET_DAYS * DAY) continue;
    // One warning per client per week.
    await once(c.id, `forwarding_quiet_${Math.floor(day / QUIET_DAYS)}`, () =>
      notifyAdmin(`Check call forwarding: ${clientLabel(c)}`, [
        `${clientLabel(c)} hasn't had a missed call forwarded to ${c.twilio_number} in ${QUIET_DAYS}+ days.`,
        `Their forwarding may have been switched off (new phone, network change). Ask them to make a test call, or call their number yourself and don't let them answer.`,
        `${env.appUrl}/admin/clients/${c.id}`,
      ]),
    ).catch((err) => skipped.push(`forwarding check ${clientLabel(c)}: ${err instanceof Error ? err.message : err}`));
  }

  return Response.json({ ok: true, sent, skipped });
}
