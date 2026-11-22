"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/supabase";
import { notifyClient } from "@/lib/push";
import { createRescueTask, loadFunnel, recordGoogleClick, savePrivateFeedback, stopReminders } from "@/lib/review-funnel";
import { queueReferral } from "@/lib/referral";

/**
 * Star rating from the review page. 4 or 5 stars go straight on to Google;
 * 1 to 3 stars are asked what went wrong so the owner can put it right (Google stays one tap away).
 */
export async function rate(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const rating = Number(formData.get("rating"));
  const data = await loadFunnel(token);
  if (!data || !(rating >= 1 && rating <= 5)) redirect(`/v/${token}`);
  const { job, c, customerName } = data;

  await db().from("jobs").update({ rating, rated_at: new Date().toISOString() }).eq("id", job.id);
  await stopReminders(job.id);

  if (rating >= 4) {
    if (rating === 5) after(() => queueReferral(c, job.id));
    if (c.google_review_url) {
      await recordGoogleClick(data, rating);
      redirect(c.google_review_url);
    }
    redirect(`/v/${token}?step=thanks`);
  }

  // A low rating: tell the owner straight away so they can ring the customer, and put it on their task list.
  after(() => createRescueTask(c.id, job.contact_id, customerName, rating, undefined, job.id));
  after(() =>
    notifyClient(job.client_id, {
      title: `${customerName ?? "A customer"} rated you ${rating}/5`,
      body: "They're telling you what went wrong. Worth a call.",
      url: `/m/${c.dashboard_token}/c/${job.contact_id}`,
      tag: `review-${job.id}`,
    }),
  );
  redirect(`/v/${token}?step=feedback`);
}

export async function sendFeedback(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  const data = await loadFunnel(token);
  if (!data) redirect(`/v/${token}`);
  if (!message) redirect(`/v/${token}?step=feedback&err=1`);
  await savePrivateFeedback(data, message);
  redirect(`/v/${token}?step=thanks`);
}
