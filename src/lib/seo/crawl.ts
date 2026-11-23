import "server-only";
import tls from "node:tls";
import { seoEnv } from "@/lib/env";
import type { Health } from "./types";
import { AI_BOTS, parseHtml, sitemapsInRobots, type PageAudit, type SiteAudit } from "./onsite";

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const BOT_UA: Record<string, string> = {
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  Bingbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0 Safari/537.36",
};

type Got = { status: number; text: string; type: string; url: string };

export async function get(url: string, ua = BROWSER, ms = 10_000): Promise<Got> {
  try {
    const res = await fetch(url, { headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(ms), cache: "no-store" });
    const text = (await res.text()).slice(0, 1_500_000);
    return { status: res.status, text, type: res.headers.get("content-type") ?? "", url: res.url };
  } catch {
    return { status: 0, text: "", type: "", url };
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      out[n] = await fn(items[n]);
    }
  }));
  return out;
}

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
const sameHost = (url: string, domain: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === domain.replace(/^www\./, "");
  } catch {
    return false;
  }
};

/** Reads the site the way a crawler without JavaScript does. `max` pages; a light crawl is the home page only. */
export async function crawlSite(domain: string, max = 40): Promise<SiteAudit> {
  const base = `https://${domain}`;
  const [robotsRes, llmsRes, homeRes] = await Promise.all([get(`${base}/robots.txt`), get(`${base}/llms.txt`), get(base)]);
  const isText = (g: Got) => g.status === 200 && !/<html/i.test(g.text.slice(0, 500));
  const robots = isText(robotsRes) ? robotsRes.text : null;

  // Sitemap: from robots.txt, else the usual place. One level of sitemap index is followed.
  let urls: string[] = [];
  let sitemapFound = false;
  for (const sm of [...sitemapsInRobots(robots), `${base}/sitemap.xml`].slice(0, 3)) {
    const r = await get(sm);
    if (r.status !== 200 || !/<(urlset|sitemapindex)/i.test(r.text)) continue;
    sitemapFound = true;
    if (/<sitemapindex/i.test(r.text)) {
      const children = await pool(locs(r.text).slice(0, 5), 3, (u) => get(u));
      urls.push(...children.flatMap((c) => locs(c.text)));
    } else urls.push(...locs(r.text));
    break;
  }
  urls = [...new Set(urls.filter((u) => sameHost(u, domain)))];

  const pages: PageAudit[] = [];
  const seen = new Set<string>();
  const add = (g: Got, url: string) => {
    if (!/html/i.test(g.type) && g.status === 200) return;
    const p = parseHtml(g.url || url, g.text, g.status);
    if (seen.has(p.path)) return;
    seen.add(p.path);
    pages.push(p);
  };
  add(homeRes, base);
  const home = pages[0];
  const queue = urls.length ? urls : (home?.links ?? []).map((p) => `${base}${p}`);
  const todo = queue.filter((u) => {
    const path = new URL(u).pathname.replace(/\/$/, "") || "/";
    return path !== "/";
  }).slice(0, Math.max(0, max - 1));
  const fetched = await pool(todo, 5, (u) => get(u));
  fetched.forEach((g, i) => add(g, todo[i]));

  // Links that lead nowhere.
  const known = new Map(pages.map((p) => [p.path, p.status]));
  const unknown = new Set<string>();
  for (const p of pages) for (const l of p.links) if (!known.has(l)) unknown.add(l);
  const check = [...unknown].slice(0, 40);
  const statuses = max > 1 ? await pool(check, 6, async (l) => (await get(`${base}${l}`, BROWSER, 8000)).status) : [];
  check.forEach((l, i) => known.set(l, statuses[i] ?? 0));
  const broken: { from: string; to: string }[] = [];
  for (const p of pages) for (const l of p.links) if ((known.get(l) ?? 200) === 404 || (known.get(l) ?? 200) === 410) broken.push({ from: p.path, to: l });

  // Bot protection: the browser gets the site, a crawler gets turned away.
  const botWall: string[] = [];
  if (homeRes.status === 200) {
    const results = await pool(Object.keys(BOT_UA), 4, async (name) => ({ name, r: await get(base, BOT_UA[name], 8000) }));
    for (const { name, r } of results) if (r.status === 403 || r.status === 429 || r.status === 503 || (r.status === 200 && /just a moment|attention required|verify you are human|captcha/i.test(r.text.slice(0, 3000)))) botWall.push(name);
  }
  return { pages, robots, llms: isText(llmsRes) && llmsRes.text.trim().length > 20, sitemapFound, broken: broken.slice(0, 30), botWall: botWall.filter((b) => AI_BOTS.includes(b) || b === "Bingbot") };
}

function tlsDaysLeft(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    const done = (v: number | null) => {
      try {
        socket.destroy();
      } catch {}
      resolve(v);
    };
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      done(cert?.valid_to ? Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000) : null);
    });
    socket.on("error", () => done(null));
    socket.on("timeout", () => done(null));
  });
}

async function domainDaysLeft(domain: string): Promise<number | null> {
  try {
    const parts = domain.replace(/^www\./, "").split(".");
    const registrable = /\.(co|org|me|ltd|plc)\.uk$|\.com\.au$/.test(domain) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
    const res = await fetch(`https://rdap.org/domain/${registrable}`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/rdap+json" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { events?: { eventAction: string; eventDate: string }[] };
    const exp = j.events?.find((e) => e.eventAction === "expiration")?.eventDate;
    return exp ? Math.floor((Date.parse(exp) - Date.now()) / 86_400_000) : null;
  } catch {
    return null;
  }
}

/** Is the site up, and are its certificate and domain safe for a while yet? */
export async function healthCheck(domain: string, previous?: Health, withDomain = false): Promise<Health> {
  const [page, tlsDays, domDays] = await Promise.all([get(`https://${domain}`, BROWSER, 12_000), tlsDaysLeft(domain), withDomain ? domainDaysLeft(domain) : Promise.resolve(previous?.domainDaysLeft ?? null)]);
  return { checkedAt: new Date().toISOString(), up: page.status >= 200 && page.status < 400, status: page.status, tlsDaysLeft: tlsDays, domainDaysLeft: domDays, error: page.status === 0 ? "No response" : undefined };
}

export type Speed = { score: number; lcp: number; cls: number; tbt: number };

/** Google PageSpeed on mobile. Free; the API key just raises the quota. Null when it can't run. */
export async function pageSpeed(url: string): Promise<Speed | null> {
  try {
    const key = seoEnv.googleKey();
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance${key ? `&key=${key}` : ""}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { lighthouseResult?: { categories?: { performance?: { score?: number } }; audits?: Record<string, { numericValue?: number }> } };
    const a = j.lighthouseResult?.audits ?? {};
    return { score: Math.round((j.lighthouseResult?.categories?.performance?.score ?? 0) * 100), lcp: Math.round((a["largest-contentful-paint"]?.numericValue ?? 0) / 100) / 10, cls: Math.round((a["cumulative-layout-shift"]?.numericValue ?? 0) * 100) / 100, tbt: Math.round(a["total-blocking-time"]?.numericValue ?? 0) };
  } catch {
    return null;
  }
}
