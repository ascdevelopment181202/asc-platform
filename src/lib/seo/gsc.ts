import "server-only";
import { gapi } from "@/lib/google";
import type { Pair, QueryPage, Row, WeekPoint } from "./types";
import { mondayOf, shortDate, ymd } from "./store";

const DAY = 86_400_000;
/** Search Console data settles after about 3 days, so every period ends 3 days ago. */
export const LAG_DAYS = 3;

type ApiRow = { keys: string[]; clicks: number; impressions: number; position: number };
type Filter = { dimension: "page" | "query"; operator: "equals" | "contains"; expression: string };

async function rows(property: string, from: string, to: string, dimensions: string[], opts: { rowLimit?: number; filters?: Filter[] } = {}): Promise<ApiRow[]> {
  const r = await gapi<{ rows?: ApiRow[] }>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: "POST",
    body: { startDate: from, endDate: to, dimensions, rowLimit: opts.rowLimit ?? 500, ...(opts.filters?.length ? { dimensionFilterGroups: [{ filters: opts.filters }] } : {}) },
  });
  return r.rows ?? [];
}
const toRow = (r: ApiRow): Row => ({ key: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position });

export function periods(now = Date.now()) {
  const end = now - LAG_DAYS * DAY;
  const d = (n: number) => ymd(new Date(end - n * DAY));
  return { cur: [d(27), d(0)] as const, prev: [d(55), d(28)] as const, end: d(0), label: `the 28 days to ${shortDate(new Date(end))}` };
}

export type SearchSnapshot = { q28: Pair; p28: Pair; qp: QueryPage[]; period: string; end: string };

/** Everything the detectors need: 28 days against the 28 before, by search, by page, and by both. */
export async function searchSnapshot(property: string): Promise<SearchSnapshot> {
  const p = periods();
  const [qc, qv, pc, pv, both] = await Promise.all([
    rows(property, p.cur[0], p.cur[1], ["query"]),
    rows(property, p.prev[0], p.prev[1], ["query"]),
    rows(property, p.cur[0], p.cur[1], ["page"], { rowLimit: 300 }),
    rows(property, p.prev[0], p.prev[1], ["page"], { rowLimit: 300 }),
    rows(property, p.cur[0], p.cur[1], ["query", "page"], { rowLimit: 1000 }),
  ]);
  return {
    q28: { cur: qc.map(toRow), prev: qv.map(toRow) },
    p28: { cur: pc.map(toRow), prev: pv.map(toRow) },
    qp: both.map((r) => ({ query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, position: r.position })),
    period: p.label,
    end: p.end,
  };
}

function byWeek(daily: ApiRow[]): WeekPoint[] {
  const weeks = new Map<string, { clicks: number; impressions: number; posWeighted: number }>();
  for (const r of daily) {
    const w = mondayOf(r.keys[0]);
    const cur = weeks.get(w) ?? { clicks: 0, impressions: 0, posWeighted: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.posWeighted += r.position * r.impressions;
    weeks.set(w, cur);
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, clicks: v.clicks, impressions: v.impressions, position: v.impressions ? Math.round((v.posWeighted / v.impressions) * 10) / 10 : 0 }));
}

/** Whole-site totals per week. Search Console keeps 16 months, so a new connection starts with history. */
export async function weeklyTotals(property: string, weeks = 16): Promise<WeekPoint[]> {
  const end = Date.now() - LAG_DAYS * DAY;
  const daily = await rows(property, ymd(new Date(end - weeks * 7 * DAY)), ymd(new Date(end)), ["date"], { rowLimit: 1000 });
  return byWeek(daily).slice(-weeks);
}

/** One page's or one search's clicks per week, for the chart on an inbox card. */
export async function seriesFor(property: string, target: { page?: string; query?: string }, domain?: string, weeks = 16): Promise<{ week: string; value: number }[]> {
  const end = Date.now() - LAG_DAYS * DAY;
  const filters: Filter[] = [];
  if (target.page) filters.push(target.page === "/" && domain ? { dimension: "page", operator: "equals", expression: `https://${domain}/` } : { dimension: "page", operator: "contains", expression: target.page });
  else if (target.query) filters.push({ dimension: "query", operator: "equals", expression: target.query });
  const daily = await rows(property, ymd(new Date(end - weeks * 7 * DAY)), ymd(new Date(end)), ["date"], { rowLimit: 1000, filters });
  return byWeek(daily).slice(-weeks).map((w) => ({ week: w.week, value: w.clicks }));
}

export type Inspection = { verdict: string; coverage: string; lastCrawl?: string; canonical?: string };

/** Is this URL in Google's index? Quota is 2,000 a day per property; callers stay far below it. */
export async function inspectUrl(property: string, url: string): Promise<Inspection> {
  const r = await gapi<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string; googleCanonical?: string } } }>("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", body: { inspectionUrl: url, siteUrl: property } });
  const s = r.inspectionResult?.indexStatusResult ?? {};
  return { verdict: s.verdict ?? "UNKNOWN", coverage: s.coverageState ?? "Unknown", lastCrawl: s.lastCrawlTime, canonical: s.googleCanonical };
}

export async function sitemaps(property: string): Promise<{ path: string; errors: number; lastDownloaded?: string }[]> {
  const r = await gapi<{ sitemap?: { path: string; errors?: string; lastDownloaded?: string }[] }>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/sitemaps`);
  return (r.sitemap ?? []).map((s) => ({ path: s.path, errors: Number(s.errors ?? 0), lastDownloaded: s.lastDownloaded }));
}
