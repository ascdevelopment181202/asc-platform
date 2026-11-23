import "server-only";
import { seoEnv } from "@/lib/env";
import { db } from "@/lib/supabase";
import type { Competitor, CompetitorCheck, Finding, SeoConfig } from "./types";
import { kvGet, kvSet, todayLondon } from "./store";
import { valueOf } from "./value";

/** Text Search with ratings is free for the first 1,000 calls a month. We stop well short of that. */
const MONTHLY_CAP = 900;
const PER_CLIENT_WEEK = 4;

type Place = { id: string; displayName?: { text?: string }; rating?: number; userRatingCount?: number; primaryTypeDisplayName?: { text?: string }; websiteUri?: string; formattedAddress?: string };

async function budget(n: number): Promise<boolean> {
  const key = `places:${todayLondon().slice(0, 7)}`;
  const used = (await kvGet<number>(key)) ?? 0;
  if (used + n > MONTHLY_CAP) return false;
  await kvSet(key, used + n);
  return true;
}
export const placesUsed = async () => (await kvGet<number>(`places:${todayLondon().slice(0, 7)}`)) ?? 0;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const host = (u?: string) => {
  try {
    return new URL(u ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function mainSearches(cfg: SeoConfig): string[] {
  const services = (cfg.services ?? []).slice(0, 3);
  const towns = (cfg.towns ?? []).slice(0, 2);
  if (!services.length || !towns.length) return [];
  const out = services.map((s) => `${s} ${towns[0]}`);
  if (towns[1]) out.push(`${services[0]} ${towns[1]}`);
  return out.slice(0, PER_CLIENT_WEEK);
}

/** Where the client shows on Google Maps for their main searches, and who's above them. */
export async function checkCompetitors(clientId: string, cfg: SeoConfig): Promise<{ checks: CompetitorCheck[]; note?: string }> {
  const key = seoEnv.googleKey();
  if (!key) return { checks: [], note: "Add GOOGLE_API_KEY to turn on competitor checks." };
  const searches = mainSearches(cfg);
  if (!searches.length) return { checks: [], note: "Add services and towns in Settings first." };
  if (!(await budget(searches.length))) return { checks: [], note: "This month's free Google Places allowance is nearly used, so competitor checks are paused until next month. Nothing has been billed." };
  const today = todayLondon();
  const ignore = (cfg.ignoreCompetitors ?? []).map(norm);
  const name = norm(cfg.facts?.businessName ?? "");
  const checks: CompetitorCheck[] = [];
  for (const query of searches) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.websiteUri" },
      body: JSON.stringify({ textQuery: query, maxResultCount: 10, regionCode: cfg.country === "US" ? "US" : "GB", ...(cfg.lat && cfg.lng ? { locationBias: { circle: { center: { latitude: cfg.lat, longitude: cfg.lng }, radius: 15000 } } } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { checks, note: `Google Places said ${res.status}. Check the Places API (New) is enabled for the key.` };
    const places = ((await res.json()) as { places?: Place[] }).places ?? [];
    const top: Competitor[] = places.map((p) => {
      const n = p.displayName?.text ?? "";
      const isClient = (!!name && (norm(n).includes(name) || name.includes(norm(n)))) || (!!cfg.domain && host(p.websiteUri) === cfg.domain.replace(/^www\./, ""));
      return { placeId: p.id, name: n, rating: p.rating, reviews: p.userRatingCount, category: p.primaryTypeDisplayName?.text, website: p.websiteUri, isClient };
    }).filter((c) => c.isClient || !ignore.includes(norm(c.name)));
    const rank = top.findIndex((c) => c.isClient);
    const check: CompetitorCheck = { query, checkedOn: today, clientRank: rank >= 0 ? rank + 1 : null, top };
    checks.push(check);
    await db().from("seo_competitors").upsert({ client_id: clientId, checked_on: today, query, client_rank: check.clientRank, place_ids: top.map((t) => t.placeId), snapshot: top });
  }
  // Google's terms: names and ratings are kept only on the newest check. Older rows keep place IDs and our rank.
  await db().from("seo_competitors").update({ snapshot: null }).eq("client_id", clientId).lt("checked_on", today);
  return { checks };
}

export async function latestCompetitors(clientId: string): Promise<CompetitorCheck[]> {
  const { data } = await db().from("seo_competitors").select("query, checked_on, client_rank, snapshot").eq("client_id", clientId).not("snapshot", "is", null).order("checked_on", { ascending: false }).limit(12).returns<{ query: string; checked_on: string; client_rank: number | null; snapshot: Competitor[] }[]>();
  const seen = new Set<string>();
  return (data ?? []).filter((r) => (seen.has(r.query) ? false : (seen.add(r.query), true))).map((r) => ({ query: r.query, checkedOn: r.checked_on, clientRank: r.client_rank, top: r.snapshot }));
}

export async function rankHistory(clientId: string): Promise<{ query: string; checked_on: string; client_rank: number | null }[]> {
  const { data } = await db().from("seo_competitors").select("query, checked_on, client_rank").eq("client_id", clientId).order("checked_on", { ascending: true }).limit(400).returns<{ query: string; checked_on: string; client_rank: number | null }[]>();
  return data ?? [];
}

const SPAM_WORDS = /\b(best|cheap|cheapest|affordable|near me|24 hour|24\/7|emergency|top rated|no\.? ?1|number one|local)\b/i;

export function competitorFindings(cfg: SeoConfig, checks: CompetitorCheck[], monthlyCalls: number): Finding[] {
  const out: Finding[] = [];
  const calls = Math.max(monthlyCalls, 4);
  for (const c of checks) {
    if (c.clientRank !== null && c.clientRank <= 3) continue;
    const top3 = c.top.filter((t) => !t.isClient).slice(0, 3);
    if (!top3.length) continue;
    const v = valueOf({ calls: calls * 0.3 }, cfg, [{ label: "Top 3 on Maps takes most of the calls", value: "about 30% more calls", assumed: true }]);
    out.push({
      kind: "map_rank",
      type: "Profile",
      dedupe: `map_rank:${norm(c.query)}`,
      summary: c.clientRank ? `Maps: position ${c.clientRank} for "${c.query}". The top 3 get most of the calls.` : `Maps: not in the top 10 for "${c.query}".`,
      detail: {
        evidence: { why: `Checked on ${c.checkedOn}. Ahead: ${top3.map((t) => `${t.name} (${t.reviews ?? "?"} reviews, ${t.rating ?? "?"} stars${t.category ? `, ${t.category}` : ""})`).join("; ")}. The levers are categories, reviews, a complete profile and how close the business is to the searcher.`, query: c.query, competitor: top3.map((t) => `${t.name}: ${t.reviews ?? "?"} reviews, ${t.rating ?? "?"} stars`).join(" · "), numbers: c.top.slice(0, 6).map((t, i) => ({ label: `${i + 1}. ${t.name}${t.isClient ? " (client)" : ""}`, value: `${t.reviews ?? "?"} reviews, ${t.rating ?? "?"}★` })) },
        gain: { calls: calls * 0.3, gbp: Math.round(v.gbp) },
        chain: v.chain,
        confidence: "Low",
        effort: "5 min manual",
        risk: "Low",
        undoable: true,
        links: [{ label: "See the map results", url: `https://www.google.com/maps/search/${encodeURIComponent(c.query)}` }],
      },
      draft: { target: "manual", needsAi: true },
    });
  }
  // Listings that look like they break Google's naming rules. Only raised with evidence on the page.
  const flagged = new Set<string>();
  for (const c of checks) for (const t of c.top) {
    if (t.isClient || flagged.has(t.placeId) || !t.website) continue;
    const towns = (cfg.towns ?? []).filter((town) => t.name.toLowerCase().includes(town.toLowerCase()));
    const spammy = SPAM_WORDS.test(t.name);
    const domain = host(t.website).replace(/\.[a-z.]+$/, "");
    const nameWords = t.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const inDomain = nameWords.filter((w) => domain.includes(w)).length;
    if (!(spammy && towns.length && inDomain <= 1)) continue;
    flagged.add(t.placeId);
    out.push({
      kind: "spam_competitor",
      type: "Manual",
      dedupe: `spam:${t.placeId}`,
      summary: `"${t.name}" may be breaking Google's naming rules: check, then report it.`,
      detail: { evidence: { why: `The listing name contains a sales word and the town (${towns.join(", ")}), but its website (${host(t.website)}) doesn't use that name. Google requires the real-world business name. If the name on their site or signage is different, the listing can be corrected, which can lift everyone below it.`, competitor: `${t.name} · ${t.website}` }, gain: { calls: 1, gbp: Math.round(valueOf({ calls: 1 }, cfg).gbp) }, chain: valueOf({ calls: 1 }, cfg).chain, confidence: "Low", effort: "5 min manual", risk: "Low", undoable: false, links: [{ label: "Their listing", url: `https://www.google.com/maps/place/?q=place_id:${t.placeId}` }, { label: "Their website", url: t.website }] },
      draft: { target: "manual", minutes: 3, steps: [{ text: "Open their website and check the real business name in the logo, footer and contact page.", url: t.website }, { text: "If it differs from the listing name, open the listing and choose Suggest an edit, then Change name or other details.", url: `https://www.google.com/maps/place/?q=place_id:${t.placeId}` }, { text: "Enter the real name. In the notes, paste:", copy: `The listing name "${t.name}" includes keywords that are not part of the business's real-world name, as shown on its own website ${t.website}. Per the Business Profile guidelines, the name should match the real-world name.` }, { text: "If the edit is rejected and you're sure, use Google's Business Redressal Complaint Form with the same evidence.", url: "https://support.google.com/business/contact/business_redressal_form" }, { text: "If the name is genuine, press Dismiss instead." }] },
    });
  }
  return out;
}
