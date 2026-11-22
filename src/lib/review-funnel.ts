import "server-only";
import { db, type Client } from "@/lib/supabase";
import { notifyClient } from "@/lib/push";
import { bumpConversation, type Job } from "@/lib/sms";

export type FunnelData = { job: Job & { rating: number | null; rated_at: string | null; feedback: string | null; feedback_at: string | null }; c: Client; customerName: string | null };

/** The job behind a review link, its business, and the customer's name. */
export async function loadFunnel(token: string): Promise<FunnelData | null> {
  if (!/^[0-9a-f]{12}$/.test(token)) return null;
  const { data: job } = await db().from("jobs").select("*").eq("review_token", token).maybeSingle<FunnelData["job"]>();
  if (!job) return null;
  const [{ data: c }, { data: contact }] = await Promise.all([
    db().from("clients").select("*").eq("id", job.client_id).single<Client>(),
    db().from("contacts").select("name").eq("id", job.contact_id).maybeSingle<{ name: string | null }>(),
  ]);
  return c ? { job, c, customerName: contact?.name ?? null } : null;
}

/** Stops the remaining review reminders for this job (they've responded). */
export async function stopReminders(jobId: string) {
  await db().from("review_messages").update({ cancelled_at: new Date().toISOString() }).eq("job_id", jobId).is("sent_at", null).is("cancelled_at", null);
}

/** Records that they went on to Google (first time only) and tells the owner. */
export async function recordGoogleClick({ job, c, customerName }: FunnelData, rating?: number) {
  if (job.review_clicked_at) return;
  await db().from("jobs").update({ review_clicked_at: new Date().toISOString() }).eq("id", job.id).is("review_clicked_at", null);
  await stopReminders(job.id);
  await notifyClient(job.client_id, {
    title: rating ? `${"⭐".repeat(rating)} from ${customerName ?? "a customer"}` : "Review link opened ⭐",
    body: rating ? "They've gone to Google to post their review." : `${customerName ?? "A customer"} just opened your Google review link.`,
    url: `/m/${c.dashboard_token}/c/${job.contact_id}`,
    tag: `review-${job.id}`,
  });
}

/** Saves private feedback where the owner will see it: the customer's conversation, plus a notification. */
export async function savePrivateFeedback({ job, c, customerName }: FunnelData, message: string) {
  const body = message.trim().slice(0, 2000);
  const now = new Date().toISOString();
  await db().from("jobs").update({ feedback: body, feedback_at: now }).eq("id", job.id);
  const stars = job.rating ? `${job.rating}/5 stars` : "no rating";
  await db().from("contact_notes").insert({ client_id: c.id, contact_id: job.contact_id, body: `Private feedback from the review page (${stars}):\n${body}` });
  await bumpConversation(job.contact_id, `Feedback (${stars}): ${body}`, "inbound", true);
  await notifyClient(job.client_id, {
    title: `Feedback from ${customerName ?? "a customer"} (${stars})`,
    body: body.slice(0, 140),
    url: `/m/${c.dashboard_token}/c/${job.contact_id}`,
    tag: `review-${job.id}`,
  });
}

/** The business behind a shareable review page (/r/<slug>). */
export async function loadClientBySlug(slug: string): Promise<Client | null> {
  if (!/^[0-9a-f]{10}$/.test(slug)) return null;
  const { data } = await db().from("clients").select("*").eq("review_slug", slug).maybeSingle<Client>();
  return data;
}
