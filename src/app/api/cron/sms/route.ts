import { env } from "@/lib/env";
import { firstThatFits } from "@/lib/sms-text";
import { db, type Client } from "@/lib/supabase";
import { clientLabel, once } from "@/lib/clients";
import { notifyAdmin } from "@/lib/email";
import { firstNameOf, inSendingWindow, reviewText, sendSms, type Contact, type Job } from "@/lib/sms";
import { whenLabel, zonedParts, type Appointment } from "@/lib/crm";
import { notifyClient } from "@/lib/push";
import { postDueAutoReplies, syncReviews } from "@/lib/google-reviews";
import { queueEndedBookings } from "@/lib/review-autopilot";
import { todaysCustomers } from "@/lib/today";
import { emailReviewRequest } from "@/lib/review-email";
import { a2pStatus } from "@/lib/twilio";
import { weeklyReviewDigest } from "@/lib/weekly-reviews";
import { googleEnabled } from "@/lib/env";
import { displayPhone } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Due = { id: string; job_id: string; client_id: string; step: number; send_at: string };

const DAY = 86400_000;
const QUIET_DAYS = 7;

/**
 * Runs every minute (see vercel.json), so review texts go out within 5 minutes of the trigger.
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

  // US numbers can't text until their A2P registration is approved: check once per client per run.
  const usReady = new Map<string, boolean>();
  const canText = async (c: Client) => {
    if (!c.sms_enabled || !c.twilio_number) return false;
    if (c.country !== "US") return true;
    if (!usReady.has(c.id)) usReady.set(c.id, c.messaging_service_sid ? (await a2pStatus(c.messaging_service_sid)).includes("verified") : false);
    return usReady.get(c.id)!;
  };

  for (const m of due ?? []) {
    const c = await getClient(m.client_id);
    if (!c || !c.google_review_url) {
      skipped.push(`${m.id}: client not set up`);
      continue; // Leave it queued; it goes out once the client is switched on.
    }
    if (!inSendingWindow(c, now)) continue; // Waits for the morning.

    const { data: job } = await db().from("jobs").select("*").eq("id", m.job_id).maybeSingle<Job>();
    const { data: contact } = job
      ? await db().from("contacts").select("*").eq("id", job.contact_id).maybeSingle<Contact>()
      : { data: null };
    // Stale: a request that's been stuck for 3 weeks (texts not switched on yet) would land out of the blue.
    const stale = now.getTime() - Date.parse(m.send_at) > 21 * DAY;
    if (!job || !contact || job.cancelled_at || job.review_clicked_at || contact.opted_out_at || stale) {
      await db().from("review_messages").update({ cancelled_at: now.toISOString() }).eq("id", m.id);
      skipped.push(`${m.id}: ${stale ? "stale" : "stopped"}`);
      continue;
    }

    const texting = await canText(c);
    if (!texting && !contact.email) {
      skipped.push(`${m.id}: waiting for texts to be switched on`);
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

    let ok = false;
    let error = "";
    if (texting) {
      const result = await sendSms({ client: c, to: contact.phone, body: reviewText(c, contact, job, m.step), kind: "review", contactId: contact.id });
      if (result.logId) await db().from("review_messages").update({ sms_log_id: result.logId }).eq("id", m.id);
      ok = result.ok;
      error = result.ok ? "" : result.error;
    }
    // Email when we can't text, or as a fallback when the text fails.
    if (!ok && contact.email) {
      try {
        await emailReviewRequest(c, contact, job, m.step);
        await db().from("review_messages").update({ channel: "email" }).eq("id", m.id);
        ok = true;
      } catch (err) {
        error = `${error ? `${error}; ` : ""}email: ${err instanceof Error ? err.message : err}`;
      }
    }
    (ok ? sent : skipped).push(`${clientLabel(c)} step ${m.step}${ok ? "" : `: ${error}`}`);
  }

  // One-off texts waiting for the sending window (referral thank-yous).
  const { data: outbox } = await db()
    .from("outbox")
    .select("*, contacts(phone, opted_out_at)")
    .is("sent_at", null)
    .is("cancelled_at", null)
    .lte("send_at", now.toISOString())
    .limit(50)
    .returns<{ id: string; client_id: string; contact_id: string; body: string; send_at: string; contacts: { phone: string; opted_out_at: string | null } | null }[]>();
  for (const o of outbox ?? []) {
    const c = await getClient(o.client_id);
    if (!c || !inSendingWindow(c, now)) continue;
    if (!o.contacts || o.contacts.opted_out_at || now.getTime() - Date.parse(o.send_at) > 3 * DAY || !(await canText(c))) {
      await db().from("outbox").update({ cancelled_at: now.toISOString() }).eq("id", o.id);
      continue;
    }
    const { data: claimed } = await db().from("outbox").update({ sent_at: now.toISOString() }).eq("id", o.id).is("sent_at", null).select("id");
    if (!claimed?.length) continue;
    const r = await sendSms({ client: c, to: o.contacts.phone, body: o.body, kind: "manual", contactId: o.contact_id });
    (r.ok ? sent : skipped).push(`outbox ${clientLabel(c)}${r.ok ? "" : `: ${r.error}`}`);
  }

  // Bookings that have just ended: queue a review request (the owner can stop it from the notification).
  sent.push(...(await queueEndedBookings(getClient, now).catch((err) => (skipped.push(`auto reviews: ${err instanceof Error ? err.message : err}`), []))));

  // Booking reminders: the day before (anything starting in the next 24 hours), inside 9am to 7pm.
  const { data: upcoming } = await db()
    .from("appointments")
    .select("*")
    .eq("status", "booked")
    .is("reminder_sent_at", null)
    .not("contact_id", "is", null)
    .gt("starts_at", new Date(now.getTime() + 2 * 3600_000).toISOString())
    .lte("starts_at", new Date(now.getTime() + 24 * 3600_000).toISOString())
    .limit(100)
    .returns<Appointment[]>();
  for (const a of upcoming ?? []) {
    const c = await getClient(a.client_id);
    if (!c || !c.sms_enabled || !c.twilio_number || !inSendingWindow(c, now)) continue;
    const { data: claimed } = await db().from("appointments").update({ reminder_sent_at: now.toISOString() }).eq("id", a.id).is("reminder_sent_at", null).select("id");
    if (!claimed?.length) continue;
    const { data: contact } = await db().from("contacts").select("*").eq("id", a.contact_id!).maybeSingle<Contact>();
    if (!contact || contact.opted_out_at) continue;
    const r = await sendSms({
      client: c,
      to: contact.phone,
      kind: "manual",
      contactId: contact.id,
      body: firstThatFits([
        `Reminder: ${clientLabel(c)} is booked to see you ${whenLabel(c, a.starts_at)}. Reply to this text if anything has changed.`,
        `Reminder: ${clientLabel(c)} is booked for ${whenLabel(c, a.starts_at)}. Reply if anything's changed.`,
      ]),
    });
    (r.ok ? sent : skipped).push(`reminder ${clientLabel(c)}${r.ok ? "" : `: ${r.error}`}`);
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

  // Follow-up tasks that have come due: one push each.
  const { data: dueTasks } = await db()
    .from("contact_tasks")
    .select("id, title, client_id, contact_id, contacts(name), clients(dashboard_token)")
    .is("done_at", null)
    .is("notified_at", null)
    .lte("due_at", now.toISOString())
    .limit(100)
    .returns<{ id: string; title: string; client_id: string; contact_id: string | null; contacts: { name: string | null } | null; clients: { dashboard_token: string } | null }[]>();
  for (const t of dueTasks ?? []) {
    await db().from("contact_tasks").update({ notified_at: now.toISOString() }).eq("id", t.id).is("notified_at", null);
    const who = t.contacts?.name ? ` · ${t.contacts.name}` : "";
    await notifyClient(t.client_id, {
      title: `✅ ${t.title}${who}`,
      body: "Due now. Tap to open, then tick it off when it's done.",
      url: t.contact_id ? `/m/${t.clients?.dashboard_token}/contacts/${t.contact_id}` : `/m/${t.clients?.dashboard_token}/tasks`,
    }).catch(() => {});
    sent.push(`task due: ${t.title}`);
  }

  // Google reviews: refresh a few clients each run, each at most every 30 minutes.
  if (googleEnabled()) {
    const { data: due } = await db()
      .from("clients")
      .select("*")
      .neq("status", "cancelled")
      .or(`reviews_synced_at.is.null,reviews_synced_at.lt.${new Date(now.getTime() - 30 * 60_000).toISOString()}`)
      .order("reviews_synced_at", { ascending: true, nullsFirst: true })
      .limit(5)
      .returns<Client[]>();
    const cutoff = new Date(now.getTime() - 30 * 60_000).toISOString();
    for (const c of due ?? []) {
      // Claim the client so an overlapping run (the cron runs every minute) doesn't sync it twice.
      const { data: claimed } = await db().from("clients").update({ reviews_synced_at: now.toISOString() }).eq("id", c.id).or(`reviews_synced_at.is.null,reviews_synced_at.lt.${cutoff}`).select("id");
      if (!claimed?.length) continue;
      try {
        const { added } = await syncReviews(c);
        if (added) sent.push(`${added} new Google review(s) for ${clientLabel(c)}`);
      } catch (err) {
        await db().from("clients").update({ reviews_synced_at: now.toISOString() }).eq("id", c.id);
        skipped.push(`reviews ${clientLabel(c)}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  if (googleEnabled()) sent.push(...(await postDueAutoReplies(getClient).catch((err) => [`auto replies: ${err instanceof Error ? err.message : err}`])));

  // Evening nudge at 6pm their time: "finished any jobs?", so review requests actually get sent.
  for (const c of active ?? []) {
    const tz = c.timezone || "Europe/London";
    const local = zonedParts(now, tz);
    if (local.hm < "18:00" || local.hm >= "18:10") continue;
    const workDays = c.business_hours?.days?.length ? c.business_hours.days : [1, 2, 3, 4, 5];
    if (!workDays.includes(local.weekday)) continue;
    await once(c.id, `review_nudge_${local.ymd}`, async () => {
      const rows = (await todaysCustomers(c)).filter((r) => !r.asked);
      const isFriday = local.weekday === 5;
      if (!rows.length && !isFriday) return;
      const app = `${env.appUrl}/m/${c.dashboard_token}`;
      const names = rows.map((r) => firstNameOf(r.contact.name) ?? displayPhone(r.contact.phone)).slice(0, 3);
      const msg = rows.length
        ? {
            title: "Finished today's jobs?",
            body: `One tap to ask ${names.join(", ")}${rows.length > 3 ? ` and ${rows.length - 3} more` : ""} for a Google review.`,
            url: `/m/${c.dashboard_token}/today`,
          }
        : { title: "Any jobs finished this week?", body: "Tap to ask your customers for a Google review. It takes seconds.", url: `/m/${c.dashboard_token}/today` };
      const { count } = await db().from("push_subscriptions").select("id", { count: "exact", head: true }).eq("client_id", c.id);
      if (count) await notifyClient(c.id, msg);
      else if (c.owner_mobile && c.country !== "US") {
        // No notifications on their phone: a text to the owner instead (US waits for texting registration).
        const link = `${app}${msg.url.replace(`/m/${c.dashboard_token}`, "")}`;
        await sendSms({ client: c, to: c.owner_mobile, kind: "owner_confirm", body: firstThatFits([`${msg.title} ${msg.body.replace("Tap", "Open your app")} ${link}`, `${msg.title} Ask them for reviews here: ${link}`, `Ask today's customers for reviews: ${link}`]) });
      }
    }).catch((err) => skipped.push(`review nudge ${clientLabel(c)}: ${err instanceof Error ? err.message : err}`));
  }

  // Monday 9am their time: last week's reviews and how close they are to their competitor.
  const { data: reviewClients } = await db().from("clients").select("*").neq("status", "cancelled").or("gbp_location.not.is.null,google_review_url.not.is.null").returns<Client[]>();
  for (const c of reviewClients ?? []) {
    const local = zonedParts(now, c.timezone || "Europe/London");
    if (local.weekday !== 1 || local.hm < "09:00" || local.hm >= "09:10") continue;
    await once(c.id, `weekly_reviews_${local.ymd}`, async () => {
      sent.push(await weeklyReviewDigest(c));
    }).catch((err) => skipped.push(`weekly reviews ${clientLabel(c)}: ${err instanceof Error ? err.message : err}`));
  }

  return Response.json({ ok: true, sent, skipped });
}
