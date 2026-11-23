import "server-only";
import { seoEnv } from "@/lib/env";

/** Tells Bing (and through it, ChatGPT search) and other engines that pages changed. Needs /<key>.txt on the site. */
export async function pingIndexNow(domain: string, urls: string[]): Promise<boolean> {
  const key = seoEnv.indexNowKey();
  if (!key || !urls.length) return false;
  const res = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: domain, key, keyLocation: `https://${domain}/${key}.txt`, urlList: urls.slice(0, 100) }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return !!res && res.status < 300;
}

export type BingStats = { clicks: number; impressions: number; queries: { query: string; clicks: number; impressions: number; position: number }[] };

const BING = "https://ssl.bing.com/webmaster/api.svc/json";

/** Search numbers from Bing Webmaster Tools. Null when the key is missing or the site isn't added there. */
export async function bingStats(siteUrl: string): Promise<BingStats | null> {
  const key = seoEnv.bingKey();
  if (!key) return null;
  try {
    const res = await fetch(`${BING}/GetQueryStats?siteUrl=${encodeURIComponent(siteUrl)}&apikey=${key}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { d?: { Query: string; Clicks: number; Impressions: number; AvgImpressionPosition: number; Date: string }[] };
    const cutoff = Date.now() - 28 * 86_400_000;
    const by = new Map<string, { clicks: number; impressions: number; pos: number }>();
    for (const r of j.d ?? []) {
      const when = Number(/\d+/.exec(r.Date)?.[0] ?? 0);
      if (when < cutoff) continue;
      const cur = by.get(r.Query) ?? { clicks: 0, impressions: 0, pos: 0 };
      cur.clicks += r.Clicks;
      cur.impressions += r.Impressions;
      cur.pos = r.AvgImpressionPosition;
      by.set(r.Query, cur);
    }
    const queries = [...by.entries()].map(([query, v]) => ({ query, clicks: v.clicks, impressions: v.impressions, position: v.pos })).sort((a, b) => b.impressions - a.impressions).slice(0, 50);
    return { clicks: queries.reduce((n, q) => n + q.clicks, 0), impressions: queries.reduce((n, q) => n + q.impressions, 0), queries };
  } catch {
    return null;
  }
}

export async function bingSites(): Promise<string[] | null> {
  const key = seoEnv.bingKey();
  if (!key) return null;
  try {
    const res = await fetch(`${BING}/GetUserSites?apikey=${key}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return (((await res.json()) as { d?: { Url: string }[] }).d ?? []).map((s) => s.Url);
  } catch {
    return null;
  }
}
