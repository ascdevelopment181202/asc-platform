"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { replyToReview, syncReviews, type GoogleReview } from "@/lib/google-reviews";
import { clientFromForm } from "../data";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function postReply(f: FormData) {
  const c = await clientFromForm(f);
  const page = `/m/${c.dashboard_token}/reviews/g/${str(f, "id")}`;
  const text = str(f, "reply").slice(0, 4000);
  if (!text) redirect(`${page}?err=${encodeURIComponent("Write a reply first.")}`);
  const { data: rv } = await db().from("google_reviews").select("*").eq("client_id", c.id).eq("id", str(f, "id")).single<GoogleReview>();
  if (!rv) redirect(`/m/${c.dashboard_token}/reviews`);
  let err = "";
  try {
    await replyToReview(c, rv, text);
  } catch (e) {
    console.error("google reply failed", e);
    err = "Google didn't accept the reply just now. Try again in a minute, or ask ASC.";
  }
  revalidatePath(`/m/${c.dashboard_token}/reviews`);
  redirect(err ? `${page}?err=${encodeURIComponent(err)}` : `${page}?ok=${encodeURIComponent("Reply posted on Google.")}`);
}

export async function refreshReviews(f: FormData) {
  const c = await clientFromForm(f);
  const page = `/m/${c.dashboard_token}/reviews`;
  let msg = "Up to date.";
  try {
    const { added } = await syncReviews(c);
    if (added) msg = `${added} new review${added === 1 ? "" : "s"}.`;
  } catch (e) {
    console.error("review sync failed", e);
    redirect(`${page}?err=${encodeURIComponent("Couldn't reach Google just now.")}`);
  }
  redirect(`${page}?ok=${encodeURIComponent(msg)}`);
}

/** "Job not done yet": stops a queued review request. */
export async function stopRequest(f: FormData) {
  const c = await clientFromForm(f);
  const { data: job } = await db().from("jobs").select("id, contact_id, client_id").eq("id", str(f, "jobId")).eq("client_id", c.id).maybeSingle<{ id: string; contact_id: string; client_id: string }>();
  if (job) {
    const { cancelJob } = await import("@/lib/review-autopilot");
    await cancelJob(job.id, "owner_stopped");
  }
  revalidatePath(`/m/${c.dashboard_token}/reviews`);
  const b = str(f, "back");
  const page = b.startsWith(`/m/${c.dashboard_token}`) ? b : `/m/${c.dashboard_token}/reviews`;
  redirect(`${page}${page.includes("?") ? "&" : "?"}ok=${encodeURIComponent("Stopped. Nothing will be sent.")}`);
}

export async function toggleAutoReview(f: FormData) {
  const c = await clientFromForm(f);
  await db().from("clients").update({ auto_review_after_booking: !c.auto_review_after_booking }).eq("id", c.id);
  revalidatePath(`/m/${c.dashboard_token}/reviews`);
  redirect(`/m/${c.dashboard_token}/reviews?ok=${encodeURIComponent(c.auto_review_after_booking ? "Automatic requests off." : "Automatic requests on.")}`);
}

export async function cancelAutoReply(f: FormData) {
  const c = await clientFromForm(f);
  await db().from("google_reviews").update({ auto_reply_at: null }).eq("client_id", c.id).eq("id", str(f, "id"));
  redirect(`/m/${c.dashboard_token}/reviews/g/${str(f, "id")}?ok=${encodeURIComponent("OK, it won't be posted automatically.")}`);
}
