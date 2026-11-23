// Detectors over Search Console data. Pure functions: same input, same findings. No AI.
import type { ActionDetail, ActionType, ChainStep, Confidence, Effort, Evidence, Finding, Pair, QueryPage, Row, SeoConfig } from "./types";
import { expectedCtr, valueOf } from "./value";

/** Below these volumes a change is noise, so nothing is raised. */
export const NOISE = { minImpressions: 20, minClicks: 3, tooEarlyImpressions: 50 };

export type DetectInput = {
  cfg: SeoConfig;
  q28: Pair;
  p28: Pair;
  qp: QueryPage[];
  knownPaths: string[];
  siteAgeDays: number;
  period: string; // "the 28 days to 19 Nov"
};

export type DetectOutput = {
  findings: Finding[];
  tooEarly: boolean;
  siteDrop: { from: number; to: number; pct: number } | null;
  brand: { brandClicks: number; otherClicks: number };
};

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const pathOf = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/";
  } catch {
    return url.startsWith("/") ? url.replace(/\/$/, "") || "/" : "/" + url;
  }
};
const ctr = (r: { clicks: number; impressions: number }) => (r.impressions ? r.clicks / r.impressions : 0);
const sum = (rows: { clicks: number }[]) => rows.reduce((n, r) => n + r.clicks, 0);
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
const pos = (n: number) => n.toFixed(1).replace(/\.0$/, "");
const nice = (path: string) => (path === "/" ? "home" : path.replace(/^\//, "").replace(/[-/]+/g, " "));
const STOP = new Set(["and", "the", "for", "with", "services", "service", "installation", "installations", "repairs", "repair", "work", "works"]);

export const wordCount = (q: string) => q.trim().split(/\s+/).length;
export const isPrice = (q: string) => /\b(cost|costs|price|prices|pricing|how much|quote|quotes|cheap|cheapest|per m2|per metre|per square)\b/i.test(q);
export const isQuestion = (q: string) => /^(who|what|how|why|when|where|can|do|does|is|are|should|which|will)\b/i.test(q.trim());
export const isComparison = (q: string) => /\b(vs|versus|compared to|or better|difference between)\b/i.test(q);

export function brandTerms(cfg: SeoConfig): string[] {
  const given = (cfg.brandTerms ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean);
  if (given.length) return given;
  const name = (cfg.facts?.businessName ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  const dom = (cfg.domain ?? "").replace(/\..*$/, "").toLowerCase();
  return [name, name.replace(/\s+/g, ""), dom].filter((t) => t.length >= 3);
}
export const isBrand = (q: string, terms: string[]) => {
  const s = q.toLowerCase();
  return terms.some((t) => s.includes(t) || s.replace(/\s+/g, "").includes(t.replace(/\s+/g, "")));
};

function serviceWords(service: string): string[] {
  return service.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
}
/** Loose match so "driveways" matches "driveway" and "paving" matches "pave". */
const stem = (w: string) => w.replace(/(ing|s|es)$/, "");
const mentions = (text: string, word: string) => text.includes(stem(word));

function make(
  cfg: SeoConfig,
  kind: string,
  type: ActionType,
  dedupe: string,
  summary: string,
  evidence: Evidence,
  gain: { clicks?: number; calls?: number },
  o: { confidence: Confidence; effort?: Effort; risk?: ActionDetail["risk"]; autoOk?: boolean; lead?: ChainStep[]; needsAi?: boolean; page?: string; links?: { label: string; url: string }[] },
): Finding {
  const v = valueOf(gain, cfg, o.lead);
  const links = [...(o.links ?? [])];
  if (evidence.page && cfg.domain) links.push({ label: "Live page", url: `https://${cfg.domain}${evidence.page === "/" ? "" : evidence.page}` });
  if (cfg.gscProperty) {
    const base = `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(cfg.gscProperty)}`;
    links.push({ label: "Search Console", url: evidence.page ? `${base}&page=*${encodeURIComponent(evidence.page)}` : evidence.query ? `${base}&query=*${encodeURIComponent(evidence.query)}` : base });
  }
  return {
    kind,
    type,
    dedupe,
    summary,
    detail: { evidence, gain: { ...gain, gbp: Math.round(v.gbp) }, chain: v.chain, confidence: o.confidence, effort: o.effort ?? "1 click", risk: o.risk ?? "Low", undoable: true, autoOk: o.autoOk, links },
    draft: o.needsAi === false ? undefined : { target: "site", page: o.page ?? evidence.page, needsAi: true },
  };
}

export function detectSearch(input: DetectInput): DetectOutput {
  const { cfg, q28, p28, qp, period } = input;
  const terms = brandTerms(cfg);
  const findings: Finding[] = [];
  const prevP = new Map(p28.prev.map((r) => [pathOf(r.key), r]));
  const curP = new Map(p28.cur.map((r) => [pathOf(r.key), r]));
  const totalImpr = q28.cur.reduce((n, r) => n + r.impressions, 0);
  const brandClicks = sum(q28.cur.filter((r) => isBrand(r.key, terms)));
  const brand = { brandClicks, otherClicks: sum(q28.cur) - brandClicks };
  const tooEarly = totalImpr < NOISE.tooEarlyImpressions;

  // The page that ranks best for each search.
  const topPage = new Map<string, QueryPage>();
  for (const r of qp) {
    const best = topPage.get(r.query);
    if (!best || r.impressions > best.impressions) topPage.set(r.query, r);
  }
  const pageFor = (q: string) => (topPage.has(q) ? pathOf(topPage.get(q)!.page) : undefined);

  // 1. A drop across the whole site is one diagnosis, not twenty alerts.
  const curClicks = sum(p28.cur);
  const prevClicks = sum(p28.prev);
  const siteDrop = prevClicks >= 30 && curClicks < prevClicks * 0.7 ? { from: prevClicks, to: curClicks, pct: 1 - curClicks / prevClicks } : null;
  if (siteDrop) {
    findings.push(
      make(cfg, "site_drop", "Technical", "site_drop", `Clicks from Google fell ${pct(siteDrop.pct)} across the whole site: check before changing pages.`, {
        why: `${siteDrop.to} clicks in ${period}, down from ${siteDrop.from} in the 28 days before. When every page falls together the cause is usually a Google update, the season or a site problem, not one page.`,
        numbers: [{ label: "Clicks now", value: String(siteDrop.to) }, { label: "Clicks before", value: String(siteDrop.from) }],
      }, { clicks: siteDrop.from - siteDrop.to }, { confidence: "Medium", effort: "5 min manual", needsAi: false }),
    );
  }

  if (!tooEarly) {
    const perPage = new Map<string, Finding>();

    // 2. Pages losing clicks.
    if (!siteDrop) {
      for (const [path, prev] of prevP) {
        const cur = curP.get(path) ?? { key: path, clicks: 0, impressions: 0, position: 0 };
        if (prev.clicks < NOISE.minClicks || prev.impressions < NOISE.minImpressions) continue;
        if (cur.clicks > prev.clicks * 0.6 || prev.clicks - cur.clicks < NOISE.minClicks) continue;
        perPage.set(
          path,
          make(cfg, "page_refresh", "Page", `page_refresh:${path}`, `Refresh the ${nice(path)} page: its clicks fell from ${prev.clicks} to ${cur.clicks}.`, {
            why: `${cur.clicks} clicks in ${period}, down from ${prev.clicks} in the 28 days before. Average position went from ${pos(prev.position)} to ${cur.position ? pos(cur.position) : "not showing"}.`,
            numbers: [{ label: "Clicks", value: `${prev.clicks} → ${cur.clicks}` }, { label: "Position", value: `${pos(prev.position)} → ${cur.position ? pos(cur.position) : "-"}` }],
            page: path,
          }, { clicks: prev.clicks - cur.clicks }, { confidence: "Medium" }),
        );
      }
    }

    // 3. Close to the top: positions 5 to 15 with real impressions.
    const striking = new Map<string, { rows: Row[]; gain: number }>();
    for (const r of q28.cur) {
      if (isBrand(r.key, terms) || r.position < 5 || r.position > 15 || r.impressions < 30) continue;
      const page = pageFor(r.key);
      if (!page) continue;
      const g = r.impressions * Math.max(0, expectedCtr(3) - Math.max(ctr(r), expectedCtr(r.position)));
      const cur = striking.get(page) ?? { rows: [], gain: 0 };
      cur.rows.push(r);
      cur.gain += g;
      striking.set(page, cur);
    }
    for (const [page, s] of striking) {
      if (perPage.has(page) || s.gain < 2) continue;
      const top = s.rows.sort((a, b) => b.impressions - a.impressions)[0];
      perPage.set(
        page,
        make(cfg, "page_boost", "Page", `page_boost:${page}`, `Strengthen the ${nice(page)} page: it sits at position ${pos(top.position)} for "${top.key}", just off the top spots.`, {
          why: `"${top.key}" was shown ${top.impressions} times in ${period} at position ${pos(top.position)}. Results in the top 3 get about ${pct(expectedCtr(3))} of clicks; this page gets ${pct(ctr(top))}.${s.rows.length > 1 ? ` ${s.rows.length - 1} more searches on this page are in the same spot.` : ""}`,
          numbers: s.rows.slice(0, 5).map((r) => ({ label: r.key, value: `position ${pos(r.position)}, ${r.impressions} impressions` })),
          page,
          query: top.key,
          queries: s.rows.slice(0, 8).map((r) => r.key),
        }, { clicks: s.gain }, { confidence: "Medium", lead: [{ label: "Move from position " + pos(top.position) + " to the top 3", value: `click rate ${pct(ctr(top))} → about ${pct(expectedCtr(3))}`, assumed: true }] }),
      );
    }
    findings.push(...perPage.values());

    // 4. Shown a lot, clicked a little: the title and description aren't earning the click.
    for (const [path, r] of curP) {
      if (r.impressions < 100 || r.position > 10) continue;
      const want = expectedCtr(r.position);
      if (ctr(r) >= want * 0.5) continue;
      const target = want * 0.8;
      findings.push(
        make(cfg, "title_rewrite", "Page", `title_rewrite:${path}`, `Rewrite the ${nice(path)} page title and description so more searchers click it.`, {
          why: `${r.impressions.toLocaleString("en-GB")} impressions in ${period} at position ${pos(r.position)}, but a ${pct(ctr(r))} click rate where pages at that position usually get about ${pct(want)}.`,
          numbers: [{ label: "Impressions", value: r.impressions.toLocaleString("en-GB") }, { label: "Position", value: pos(r.position) }, { label: "Click rate", value: `${pct(ctr(r))} (typical ${pct(want)})` }],
          page: path,
        }, { clicks: r.impressions * (target - ctr(r)) }, { confidence: r.impressions >= 300 ? "High" : "Medium", autoOk: true, lead: [{ label: "Better title and description", value: `click rate ${pct(ctr(r))} → ${pct(target)}`, assumed: true }] }),
      );
    }

    // 5. Long searches and questions: answer them on the page that already ranks.
    const answers = new Map<string, Row[]>();
    const prices: Row[] = [];
    const versus: Row[] = [];
    for (const r of q28.cur) {
      if (isBrand(r.key, terms) || r.impressions < 10) continue;
      if (isPrice(r.key)) prices.push(r);
      else if (isComparison(r.key)) versus.push(r);
      else if (wordCount(r.key) >= 7 || isQuestion(r.key)) {
        const page = pageFor(r.key);
        if (page) answers.set(page, [...(answers.get(page) ?? []), r]);
      }
    }
    for (const [page, rows] of answers) {
      rows.sort((a, b) => b.impressions - a.impressions);
      const impressions = rows.reduce((n, r) => n + r.impressions, 0);
      if (impressions < NOISE.minImpressions) continue;
      findings.push(
        make(cfg, "answer_block", "AI search", `answer_block:${page}`, `Answer ${rows.length === 1 ? `"${rows[0].key}"` : `${rows.length} questions people search`} at the top of the ${nice(page)} page.`, {
          why: `These long, question-style searches showed this page ${impressions} times in ${period} but the page doesn't answer them directly. They're the same questions people ask ChatGPT and Google's AI answers.`,
          numbers: rows.slice(0, 5).map((r) => ({ label: r.key, value: `${r.impressions} impressions, ${r.clicks} clicks` })),
          page,
          queries: rows.slice(0, 5).map((r) => r.key),
        }, { clicks: impressions * 0.03 }, { confidence: "Medium", autoOk: true, lead: [{ label: "A direct answer on the page", value: "about 3 more clicks per 100 impressions", assumed: true }] }),
      );
    }

    // 6. Price searches: a cost guide.
    const priceImpr = prices.reduce((n, r) => n + r.impressions, 0);
    if (priceImpr >= NOISE.minImpressions) {
      prices.sort((a, b) => b.impressions - a.impressions);
      const existing = input.knownPaths.find((p) => /cost|price/.test(p));
      findings.push(
        make(cfg, existing ? "answer_block" : "cost_guide", "Content", existing ? `answer_block:${existing}` : "cost_guide", existing ? `Add clear prices to the ${nice(existing)} page: ${prices.length} price searches land near it.` : `Publish a cost guide: ${prices.length} price searches a month have no clear answer on the site.`, {
          why: `Price searches were shown ${priceImpr} times in ${period}. People asking about cost are close to buying, and AI answers quote pages with clear price tables.`,
          numbers: prices.slice(0, 5).map((r) => ({ label: r.key, value: `${r.impressions} impressions` })),
          page: existing,
          queries: prices.slice(0, 6).map((r) => r.key),
        }, { clicks: priceImpr * 0.04 }, { confidence: "Medium", lead: [{ label: "A page that answers the price question", value: "about 4 more clicks per 100 impressions", assumed: true }] }),
      );
    }

    // 7. "X vs Y" searches.
    const vsImpr = versus.reduce((n, r) => n + r.impressions, 0);
    if (vsImpr >= NOISE.minImpressions) {
      versus.sort((a, b) => b.impressions - a.impressions);
      findings.push(
        make(cfg, "comparison", "Content", `comparison:${slug(versus[0].key)}`, `Write a comparison: "${versus[0].key}" and similar searches.`, {
          why: `Comparison searches were shown ${vsImpr} times in ${period}. Buyers weighing options need a straight answer from a tradesperson.`,
          numbers: versus.slice(0, 5).map((r) => ({ label: r.key, value: `${r.impressions} impressions` })),
          queries: versus.slice(0, 5).map((r) => r.key),
        }, { clicks: vsImpr * 0.03 }, { confidence: "Low" }),
      );
    }

    // 8. Two pages competing for one search.
    const byQuery = new Map<string, QueryPage[]>();
    for (const r of qp) byQuery.set(r.query, [...(byQuery.get(r.query) ?? []), r]);
    let cannibal = 0;
    for (const [q, rows] of byQuery) {
      if (cannibal >= 3 || rows.length < 2 || isBrand(q, terms)) continue;
      rows.sort((a, b) => b.impressions - a.impressions);
      const total = rows.reduce((n, r) => n + r.impressions, 0);
      if (total < 30 || rows[1].impressions < 10 || rows[1].impressions < total * 0.2) continue;
      cannibal++;
      findings.push(
        make(cfg, "cannibal", "Page", `cannibal:${slug(q)}`, `Two pages compete for "${q}": point Google at one.`, {
          why: `${nice(pathOf(rows[0].page))} (${rows[0].impressions} impressions) and ${nice(pathOf(rows[1].page))} (${rows[1].impressions} impressions) both show for this search in ${period}, splitting the ranking between them.`,
          page: pathOf(rows[0].page),
          query: q,
        }, { clicks: total * 0.02 }, { confidence: "Low" }),
      );
    }

    // 9. Pages Google isn't showing at all.
    if (input.siteAgeDays >= 30) {
      const dead = input.knownPaths.filter((p) => !curP.has(p) && !/privacy|terms|thank|cookie|legal/.test(p));
      if (dead.length) {
        findings.push(
          make(cfg, "dead_pages", "Technical", "dead_pages", `${dead.length} page${dead.length === 1 ? "" : "s"} got no impressions on Google: check ${dead.length === 1 ? "it's" : "they're"} indexed.`, {
            why: `These pages are on the site but were not shown once in ${period}: ${dead.slice(0, 8).map(nice).join(", ")}${dead.length > 8 ? " and more" : ""}.`,
            numbers: dead.slice(0, 8).map((p) => ({ label: p, value: "0 impressions" })),
          }, { clicks: Math.min(dead.length, 5) * 2 }, { confidence: "Medium", needsAi: false }),
        );
      }
    }
  }

  // 10. Service and town combinations with no page. Runs even on thin data, at low confidence.
  const gaps: { f: Finding; impressions: number }[] = [];
  const paths = input.knownPaths.map((p) => p.toLowerCase());
  for (const town of cfg.towns ?? []) {
    const t = slug(town);
    if (!t) continue;
    for (const service of cfg.services ?? []) {
      const words = serviceWords(service);
      if (!words.length) continue;
      const hasPage = paths.some((p) => p.includes(t) && words.some((w) => mentions(p, w)));
      if (hasPage) continue;
      const hits = q28.cur.filter((r) => r.key.toLowerCase().includes(town.toLowerCase()) && words.some((w) => mentions(r.key.toLowerCase(), w)));
      const impressions = hits.reduce((n, r) => n + r.impressions, 0);
      const clicks = sum(hits);
      const seen = impressions >= 10;
      const gain = seen ? Math.max(1, impressions * expectedCtr(3) - clicks) : 6;
      gaps.push({
        impressions,
        f: make(cfg, "new_page", "Content", `new_page:${slug(service)}-${t}`, `Create a ${service} in ${town} page: there isn't one.`, {
          why: seen
            ? `Searches for ${service.toLowerCase()} in ${town} were shown ${impressions} times in ${period} with ${clicks} clicks, and no page on the site is about that service in that town.`
            : `${town} is in the service area and ${service.toLowerCase()} is a core service, but no page covers the two together. No search data for it yet, so this is a lower-confidence suggestion.`,
          numbers: hits.slice(0, 5).map((r) => ({ label: r.key, value: `${r.impressions} impressions, position ${pos(r.position)}` })),
          queries: hits.slice(0, 5).map((r) => r.key),
        }, { clicks: gain }, { confidence: seen ? "Medium" : "Low", page: `/${slug(service)}-${t}`, lead: seen ? [{ label: "A dedicated page reaching the top 3", value: `about ${pct(expectedCtr(3))} of ${impressions} impressions`, assumed: true }] : [{ label: "Typical for a new town page", value: "about 6 clicks a month", assumed: true }] }),
      });
    }
  }
  gaps.sort((a, b) => b.impressions - a.impressions);
  findings.push(...gaps.slice(0, 6).map((g) => g.f));

  return { findings, tooEarly, siteDrop, brand };
}
