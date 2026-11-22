import "server-only";
import { db, type Client } from "@/lib/supabase";
import { clientTime, createJob, firstNameOf, type Contact, type Job } from "@/lib/sms";
import { notifyClient } from "@/lib/push";
import type { Appointment } from "@/lib/crm";

const HOUR = 3600_000;

/**
 * Stops a review request that hasn't gone out yet. If nothing was sent, the customer can be
 * asked again later (the 6-month rule only counts requests that actually happened).
 */
export async function cancelJob(jobId: string, reason: string) {
  const now = new Date().toISOString();
  const { data: job } = await db().from("jobs").select("*").eq("id", jobId).maybeSingle<Job>();
  if (!job || job.cancelled_at) return job;
  await db().from("jobs").update({ cancelled_at: now, cancelled_reason: reason }).eq("id", jobId);
  await db().from("review_messages").update({ cancelled_at: now }).eq("job_id", jobId).is("sent_at", null).is("cancelled_at", null);
  const { count } = await db().from("review_messages").select("id", { count: "exact", head: true }).eq("job_id", jobId).not("sent_at", "is", null);
  if (!count) await db().from("contacts").update({ last_review_request_at: null }).eq("id", job.contact_id);
  return job;
}

/** A booking was cancelled: drop any review request the autopilot queued for it. */
export async function cancelBookingReview(appointmentId: string) {
  const { data: jobs } = await db().from("jobs").select("id").eq("appointment_id", appointmentId).is("cancelled_at", null).returns<{ id: string }[]>();
  for (const j of jobs ?? []) await cancelJob(j.id, "booking_cancelled");
}

/**
 * Bookings that have just ended: queue the review request (bookingDelayMin after the end) and tell the owner,
 * so they only have to act if the job isn't actually finished.
 */
export async function queueEndedBookings(getClient: (id: string) => Promise<Client | null>, now = new Date()) {
  const done: string[] = [];
  const { data: ended } = await db()
    .from("appointments")
    .select("*, contacts(*)")
    .eq("status", "booked")
    .is("review_queued_at", null)
    .not("contact_id", "is", null)
    .lte("ends_at", now.toISOString())
    .gte("ends_at", new Date(now.getTime() - 24 * HOUR).toISOString())
    .limit(50)
    .returns<(Appointment & { contacts: Contact | null })[]>();

  for (const a of ended ?? []) {
    const { data: claimed } = await db().from("appointments").update({ review_queued_at: now.toISOString() }).eq("id", a.id).is("review_queued_at", null).select("id");
    if (!claimed?.length) continue;
    const c = await getClient(a.client_id);
    const contact = a.contacts;
    if (!c || !c.auto_review_after_booking || !contact || contact.opted_out_at) continue;

    const result = await createJob(c, { phone: contact.phone, name: contact.name, source: "booking", label: a.title, appointmentId: a.id });
    if (!result.ok) continue; // Asked recently, no review link yet, or not a mobile: nothing to tell them.
    const who = firstNameOf(contact.name) ?? "your customer";
    await notifyClient(c.id, {
      title: `We'll ask ${who} for a review at ${clientTime(c, result.firstSendAt)}`,
      body: "Their booking has finished. Job not done yet? Tap to stop it.",
      url: `/m/${c.dashboard_token}/reviews/job/${result.job.id}`,
      tag: `review-${result.job.id}`,
    });
    done.push(`auto review queued: ${c.business_name ?? c.id} / ${who}`);
  }
  return done;
}
