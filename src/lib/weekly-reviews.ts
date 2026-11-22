import "server-only";
import { db, type Client } from "@/lib/supabase";
import { notifyClient } from "@/lib/push";

const DAY = 86400_000;

/** Refreshes the competitor's rating from Google Places, when a key and place are set. */
async function refreshCompetitor(c: Client) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !c.competitor_place_id) return c;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(c.competitor_place_id)}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "displayName,rating,userRatingCount" },
      cache: "no-store",
    });
    if (!res.ok) return c;
    const p = (await res.json()) as { displayName?: { text?: string }; rating?: number; userRatingCount?: number };
    const patch = { competitor_rating: p.rating ?? c.competitor_rating, competitor_review_count: p.userRatingCount ?? c.competitor_review_count, competitor_name: c.competitor_name || p.displayName?.text || null };
    await db().from("clients").update(patch).eq("id", c.id);
    return { ...c, ...patch };
  } catch {
    return c;
  }
}

/** Finds a competitor on Google by name and town (needs GOOGLE_PLACES_API_KEY). */
export async function findCompetitor(query: string) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount,places.formattedAddress" },
    body: JSON.stringify({ textQuery: query, pageSize: 1 }),
  });
  if (!res.ok) return null;
  const p = ((await res.json()) as { places?: { id: string; displayName?: { text?: string }; rating?: number; userRatingCount?: number }[] }).places?.[0];
  return p ? { id: p.id, name: p.displayName?.text ?? query, rating: p.rating ?? null, count: p.userRatingCount ?? null } : null;
}

/**
 * Monday morning: how their reviews went last week, where they stand, and how close they are to
 * the competitor they want to beat. Keeps owners pressing the button.
 */
export async function weeklyReviewDigest(c0: Client) {
  const c = await refreshCompetitor(c0);
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const [{ count: newReviews }, { count: asked }] = await Promise.all([
    db().from("google_reviews").select("id", { count: "exact", head: true }).eq("client_id", c.id).gte("created_at", since),
    db().from("jobs").select("id", { count: "exact", head: true }).eq("client_id", c.id).gte("created_at", since).is("cancelled_at", null),
  ]);
  const n = newReviews ?? 0;
  const rating = c.google_rating ? Number(c.google_rating).toFixed(1) : null;
  const total = c.google_review_count ?? 0;

  const lines: string[] = [];
  if (rating) lines.push(`You're ${rating}★ from ${total} review${total === 1 ? "" : "s"}.`);
  if (c.competitor_name && c.competitor_review_count != null) {
    const gap = c.competitor_review_count - total + 1;
    if (gap > 0) lines.push(`${gap} more to pass ${c.competitor_name} (${c.competitor_review_count}).`);
    else lines.push(`You're ahead of ${c.competitor_name} (${c.competitor_review_count}). Keep it going!`);
  }
  if (!n) lines.push(asked ? `${asked} asked last week, reviews usually follow within a few days.` : "Ask a few customers today, it only takes a tap.");

  const title = n ? `⭐ ${n} new Google review${n === 1 ? "" : "s"} last week` : asked ? "Your reviews this week" : "No review requests last week";
  await notifyClient(c.id, { title, body: lines.join(" "), url: n ? `/m/${c.dashboard_token}/reviews` : `/m/${c.dashboard_token}/today` });
  return `${title} (${c.business_name ?? c.id})`;
}
