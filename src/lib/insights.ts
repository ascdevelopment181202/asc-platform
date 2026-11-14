import "server-only";
import { db } from "./supabase";
import { googleEnabled } from "./env";
import { businessMetrics, searchQueries, type GbpDaily, type SearchRow } from "./google";
import type { Site } from "./sites";
import type { Period } from "./reports";

const HOUR = 3600_000;
const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/** Reads a cached Google answer, or fetches and caches it. */
async function cached<T>(siteId: string, key: string, ttlHours: number, fetcher: () => Promise<T>): Promise<T> {
  const { data } = await db().from("google_cache").select("data, fetched_at").eq("site_id", siteId).eq("key", key).maybeSingle<{ data: T; fetched_at: string }>();
  if (data && Date.now() - Date.parse(data.fetched_at) < ttlHours * HOUR) return data.data;
  const fresh = await fetcher();
  await db().from("google_cache").upsert({ site_id: siteId, key, data: fresh, fetched_at: new Date().toISOString() }, { onConflict: "site_id,key" });
  return fresh;
}

export type Ranking = { query: string; position: number; previous: number | null; clicks: number; impressions: number };

export type SearchInsight = {
  clicks: number;
  impressions: number;
  topTen: number;
  previous: { clicks: number; impressions: number; topTen: number } | null;
  rankings: Ranking[];
};

export type GbpInsight = {
  calls: number;
  directions: number;
  websiteClicks: number;
  views: number;
  previous: { calls: number; directions: number; websiteClicks: number; views: number } | null;
  daily: GbpDaily[];
};

export type Insights = { search: SearchInsight | null; gbp: GbpInsight | null; errors: string[] };

const prevOf = (p: Period): Period => {
  const len = p.to.getTime() - p.from.getTime();
  return { from: new Date(p.from.getTime() - len), to: p.from };
};

// Search Console needs a day or two to settle, so the range ends at the day before `to`.
const lastDay = (p: Period) => new Date(p.to.getTime() - 24 * HOUR);

function words(site: Site) {
  const c = site.content;
  const brand = c.businessName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["plumbing", "heating", "electrical", "roofing", "services", "building"].includes(w));
  return { brand };
}

function summarise(rows: SearchRow[]) {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const topTen = rows.filter((r) => r.position <= 10 && r.impressions >= 2).length;
  return { clicks, impressions, topTen };
}

async function searchInsight(site: Site, p: Period): Promise<SearchInsight | null> {
  if (!site.gsc_property) return null;
  const prop = site.gsc_property;
  const prev = prevOf(p);
  const [now, before] = await Promise.all([
    cached(site.id, `gsc:${ymd(p.from)}:${ymd(p.to)}`, 12, () => searchQueries(prop, p.from, lastDay(p))),
    cached(site.id, `gsc:${ymd(prev.from)}:${ymd(prev.to)}`, 24 * 7, () => searchQueries(prop, prev.from, lastDay(prev))),
  ]);
  const { brand } = words(site);
  const isBrand = (q: string) => brand.some((w) => q.includes(w));
  const prevPos = new Map(before.map((r) => [r.query, r.position]));
  const rankings = now
    .filter((r) => !isBrand(r.query) && r.position <= 50 && r.impressions >= 3)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10)
    .map((r) => ({ query: r.query, position: Math.round(r.position * 10) / 10, previous: prevPos.has(r.query) ? Math.round(prevPos.get(r.query)! * 10) / 10 : null, clicks: r.clicks, impressions: r.impressions }))
    .sort((a, b) => a.position - b.position);
  return { ...summarise(now), previous: before.length ? summarise(before) : null, rankings };
}

const totals = (d: GbpDaily[]) =>
  d.reduce((t, r) => ({ calls: t.calls + r.calls, directions: t.directions + r.directions, websiteClicks: t.websiteClicks + r.websiteClicks, views: t.views + r.views }), { calls: 0, directions: 0, websiteClicks: 0, views: 0 });

async function gbpInsight(site: Site, p: Period): Promise<GbpInsight | null> {
  if (!site.gbp_location) return null;
  const loc = site.gbp_location;
  const prev = prevOf(p);
  const [now, before] = await Promise.all([
    cached(site.id, `gbp:${ymd(p.from)}:${ymd(p.to)}`, 12, () => businessMetrics(loc, p.from, lastDay(p))),
    cached(site.id, `gbp:${ymd(prev.from)}:${ymd(prev.to)}`, 24 * 7, () => businessMetrics(loc, prev.from, lastDay(prev))),
  ]);
  return { ...totals(now), previous: before.length ? totals(before) : null, daily: now };
}

/** Google rankings and Business Profile numbers for a period. Never throws: a missing piece just comes back null. */
export async function siteInsights(site: Site, p: Period): Promise<Insights> {
  const errors: string[] = [];
  if (!googleEnabled() || (!site.gsc_property && !site.gbp_location)) return { search: null, gbp: null, errors };
  const safe = async <T>(label: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };
  const [search, gbp] = await Promise.all([safe("Search Console", () => searchInsight(site, p)), safe("Business Profile", () => gbpInsight(site, p))]);
  if (errors.length) console.error("siteInsights", site.slug, errors);
  return { search, gbp, errors };
}
