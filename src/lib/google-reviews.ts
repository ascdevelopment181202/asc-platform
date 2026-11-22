import "server-only";
import { db, type Client } from "@/lib/supabase";
import { gapi } from "@/lib/google";
import { googleEnabled } from "@/lib/env";
import { notifyClient } from "@/lib/push";
import { clientLabel } from "@/lib/clients";

// Reviews still live on the v4 My Business API (the newer APIs don't cover them).
const V4 = "https://mybusiness.googleapis.com/v4";
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

type ApiReview = {
  reviewId: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

export type GoogleReview = {
  id: string;
  client_id: string;
  google_review_id: string;
  reviewer_name: string | null;
  rating: number | null;
  comment: string | null;
  created_at: string;
  updated_at: string | null;
  reply: string | null;
  replied_at: string | null;
  contact_id: string | null;
  job_id: string | null;
  seen_at: string | null;
};

/** Google adds "(Translated by Google)" blocks; keep the reviewer's own words. */
const cleanComment = (s?: string) => (s ? s.split("\n\n(Translated by Google)")[0].replace(/^\(Translated by Google\)\s*/, "").trim() : null);

/** The client's Business Profile location: their own setting, or the one picked for their website. */
export async function reviewLocation(c: Client): Promise<string | null> {
  if (c.gbp_location) return c.gbp_location;
  const { data: site } = await db().from("sites").select("gbp_location").eq("client_id", c.id).maybeSingle<{ gbp_location: string | null }>();
  return site?.gbp_location ?? null;
}

/** Finds which Google account the location sits under (needed for the v4 reviews path). */
async function resolvePath(location: string): Promise<string> {
  const accounts = await gapi<{ accounts?: { name: string }[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20");
  for (const a of accounts.accounts ?? []) {
    try {
      await gapi(`${V4}/${a.name}/${location}/reviews?pageSize=1`);
      return `${a.name}/${location}`;
    } catch {
      /* not this account */
    }
  }
  throw new Error("This Google account can't see that Business Profile's reviews. Check it's been added as a manager.");
}

/** Pulls the latest reviews into the app, alerts the client about new ones and matches them to customers. */
export async function syncReviews(c: Client): Promise<{ added: number }> {
  if (!googleEnabled()) return { added: 0 };
  const location = await reviewLocation(c);
  if (!location) {
    await db().from("clients").update({ reviews_synced_at: new Date().toISOString() }).eq("id", c.id);
    return { added: 0 };
  }
  let path = c.gbp_reviews_path;
  if (!path || !path.endsWith(location)) {
    path = await resolvePath(location);
    await db().from("clients").update({ gbp_reviews_path: path, gbp_location: location }).eq("id", c.id);
  }

  const r = await gapi<{ reviews?: ApiReview[]; averageRating?: number; totalReviewCount?: number }>(`${V4}/${path}/reviews?pageSize=50&orderBy=updateTime%20desc`);
  const { data: existing } = await db().from("google_reviews").select("google_review_id").eq("client_id", c.id).returns<{ google_review_id: string }[]>();
  const known = new Set((existing ?? []).map((e) => e.google_review_id));
  const firstSync = known.size === 0;

  const rows = (r.reviews ?? []).map((v) => ({
    client_id: c.id,
    google_review_id: v.reviewId,
    reviewer_name: v.reviewer?.isAnonymous ? null : (v.reviewer?.displayName ?? null),
    rating: v.starRating ? (STARS[v.starRating] ?? null) : null,
    comment: cleanComment(v.comment),
    created_at: v.createTime,
    updated_at: v.updateTime ?? null,
    reply: v.reviewReply?.comment ?? null,
    replied_at: v.reviewReply?.updateTime ?? null,
    // Reviews already there on the first sync don't count as new.
    ...(firstSync ? { seen_at: new Date().toISOString() } : {}),
  }));
  if (rows.length) await db().from("google_reviews").upsert(rows, { onConflict: "client_id,google_review_id" });

  const now = new Date();
  await db()
    .from("clients")
    .update({ google_rating: r.averageRating ?? null, google_review_count: r.totalReviewCount ?? rows.length, reviews_synced_at: now.toISOString() })
    .eq("id", c.id);
  await db().from("google_rating_history").upsert({ client_id: c.id, day: now.toISOString().slice(0, 10), rating: r.averageRating ?? null, review_count: r.totalReviewCount ?? rows.length });

  const fresh = rows.filter((x) => !known.has(x.google_review_id));
  if (firstSync) return { added: 0 };
  for (const rv of fresh) {
    const { data: saved } = await db().from("google_reviews").select("*").eq("client_id", c.id).eq("google_review_id", rv.google_review_id).single<GoogleReview>();
    if (saved) await matchToCustomer(c, saved);
    await notifyClient(c.id, {
      title: `${rv.rating ? "⭐".repeat(rv.rating) : "New review"} from ${rv.reviewer_name ?? "a customer"}`,
      body: rv.rating && rv.rating <= 3 ? "A lower rating on Google. Tap to read it and reply." : `${rv.comment ? `"${rv.comment.slice(0, 100)}"` : "New Google review."} Tap to reply.`,
      url: `/m/${c.dashboard_token}/reviews/g/${saved?.id ?? ""}`,
    });
  }
  return { added: fresh.length };
}

/**
 * Links a review to the customer who was asked for it: same first name as someone sent a review
 * request in the last 60 days. Marks their request as reviewed and stops any reminders.
 */
async function matchToCustomer(c: Client, rv: GoogleReview) {
  const first = rv.reviewer_name?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return;
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: jobs } = await db()
    .from("jobs")
    .select("id, contact_id, review_clicked_at, contacts(name)")
    .eq("client_id", c.id)
    .is("reviewed_at", null)
    .gte("created_at", since)
    .order("review_clicked_at", { ascending: false, nullsFirst: false })
    .returns<{ id: string; contact_id: string; review_clicked_at: string | null; contacts: { name: string | null } | null }[]>();
  const match = (jobs ?? []).find((j) => j.contacts?.name?.trim().split(/\s+/)[0]?.toLowerCase() === first);
  if (!match) return;
  const now = new Date().toISOString();
  await db().from("google_reviews").update({ contact_id: match.contact_id, job_id: match.id }).eq("id", rv.id);
  await db().from("jobs").update({ reviewed_at: now }).eq("id", match.id);
  await db().from("review_messages").update({ cancelled_at: now }).eq("job_id", match.id).is("sent_at", null).is("cancelled_at", null);
  await db()
    .from("contact_notes")
    .insert({ client_id: c.id, contact_id: match.contact_id, body: `Left a ${rv.rating ?? ""}★ Google review${rv.comment ? `: "${rv.comment.slice(0, 300)}"` : "."}` });
}

/** Posts (or updates) the business's public reply on Google. */
export async function replyToReview(c: Client, rv: GoogleReview, text: string) {
  const path = c.gbp_reviews_path ?? (await resolvePath((await reviewLocation(c))!));
  await gapi(`${V4}/${path}/reviews/${rv.google_review_id}/reply`, { method: "PUT", body: { comment: text } });
  await db().from("google_reviews").update({ reply: text, replied_at: new Date().toISOString(), seen_at: rv.seen_at ?? new Date().toISOString() }).eq("id", rv.id);
}

/** A ready-to-post reply in the business's voice. Uses Claude when configured, otherwise a sensible template. */
export async function suggestReply(c: Client, rv: GoogleReview): Promise<string> {
  const business = clientLabel(c);
  const first = rv.reviewer_name?.trim().split(/\s+/)[0] ?? "";
  const hi = first ? `Hi ${first}, ` : "";
  const fallback =
    (rv.rating ?? 5) >= 4
      ? `${hi}thank you so much for the kind review! It was a pleasure working with you, and we really appreciate you taking the time. ${business}`
      : `${hi}thank you for your feedback, and we're sorry we didn't get everything right. We'd like to put it right, so please give us a call and we'll sort it out. ${business}`;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 300,
        system:
          "You write short public replies to Google reviews for a small local trades business. 2 to 3 sentences, warm and plain, " +
          (c.country === "US" ? "American English" : "British English") +
          ". Thank them, mention one specific detail from their review if there is one, and sign off with the business name. For 1 to 3 stars: apologise without arguing, never reveal private details, and invite them to call to put it right. No emojis, no em dashes, no hashtags. Reply with the text only.",
        messages: [{ role: "user", content: `Business: ${business}\nReviewer: ${rv.reviewer_name ?? "Anonymous"}\nStars: ${rv.rating ?? "unknown"}\nReview: ${rv.comment ?? "(no text, rating only)"}` }],
      }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((b) => b.type === "text")?.text?.trim();
    return text ? text.replace(/\s*—\s*/g, ", ") : fallback;
  } catch {
    return fallback;
  }
}
