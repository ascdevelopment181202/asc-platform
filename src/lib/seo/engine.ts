import "server-only";
import { seoEnv } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import type { Finding, Row, SeoAction, SeoConfig, SeoSettings, SeoState, WeekPoint } from "./types";
import { AiUnavailable } from "./ai";
import { aiFindings, checkAiVisibility, recentAiChecks } from "./aivis";
import { approveAction, canAuto, preparePr, progressPr } from "./apply";
import { bingStats } from "./bing";
import { citationFinding, citationRows, findLinks } from "./citations";
import { crawlSite, get, healthCheck, pageSpeed } from "./crawl";
import { detectSearch, pathOf } from "./detect";
import { draftFor, templateReply } from "./drafts";
import { searchKeywords } from "./gbp";
import { inspectUrl, searchSnapshot, seriesFor, weeklyTotals } from "./gsc";
import { clientReportFinding } from "./mail";
import { measureDue } from "./measure";
import { detectOnSite, isPlaceholderTitle, parseHtml, staticCopy, type PageAudit, type SiteAudit } from "./onsite";
import { renderPage } from "./visual";
import { checkCompetitors, competitorFindings, latestCompetitors } from "./places";
import { readProfile, reviewFindings } from "./profile";
import { monthResults, realEnquiryRate } from "./results";
import { getLatest, getSettings, globalPaused, listActions, mondayOf, patchState, putLatest, putMetric, todayLondon, updateAction, upsertFindings, weeklyMetrics } from "./store";
import { googleUpdates, holidayFindings, researchPlaybook, seasonalFindings, trackRecord, weatherFindings, writePlan, writeWeeklyReview, type StrategyContext } from "./strategist";
import { repoInfo } from "./github";
import { valueOf } from "./value";

const DAY = 86_400_000;

const SEARCH_KINDS = ["site_drop", "page_refresh", "page_boost", "title_rewrite", "answer_block", "cost_guide", "comparison", "cannibal", "dead_pages", "new_page"];
const ALERT_KINDS = ["robots_ai", "bot_wall", "no_js_content"];
const ONSITE_KINDS = [...ALERT_KINDS, "llms_txt", "sitemap", "sitemap_robots", "schema_local", "schema_sameas", "phone_click", "nap_mismatch", "no_cta", "no_reviews_shown", "tracking", "meta_fix", "h1_missing", "broken_links", "alt_text", "faq_schema", "thin_pages", "launch_check", "indexnow_key", "slow_site", "quotable"];
const PROFILE_KINDS = ["gbp_description", "gbp_utm", "gbp_hours", "gbp_categories", "gbp_services", "gbp_service_area", "gbp_calls_drop"];
const HEALTH_KINDS = ["site_down", "tls_expiring", "domain_expiring"];
const BUNDLE_KINDS = ["llms_txt", "sitemap", "sitemap_robots", "schema_local", "tracking", "indexnow_key"];

export type PageSummary = { path: string; title: string; description: string; words: number; h1: string; status: number };
export type QuerySnapshot = { period: string; rows: (Row & { prevClicks: number; prevImpressions: number; prevPosition: number | null; page?: string })[] };
export type PageSnapshot = { period: string; rows: (Row & { prevClicks: number })[] };

function alert(cfg: SeoConfig, kind: string, summary: string, why: string, steps: string[]): Finding {
  return { kind, type: "Technical", dedupe: kind, summary, detail: { evidence: { why }, gain: {}, chain: [{ label: "Protects", value: "every visit and ranking the site already has" }], confidence: "High", effort: "5 min manual", risk: "High", undoable: false, alert: true, links: cfg.domain ? [{ label: "Live site", url: `https://${cfg.domain}` }] : undefined }, draft: { target: "manual", minutes: 5, steps: [...steps.map((text) => ({ text })), { text: "Press Mark done once it's sorted. The check runs again tomorrow." }] } };
}

// Checks that read the page's words. When the words only exist after scripts run, they're judged on the rendered page instead.
const CONTENT_KINDS = ["phone_click", "nap_mismatch", "no_cta", "no_reviews_shown", "h1_missing", "thin_pages", "alt_text", "faq_schema", "quotable", "meta_fix"];

/**
 * The home page is an empty shell until its scripts run (a bundled single-page site).
 * Google runs scripts; most AI crawlers don't. This builds the fix from the page's own rendered words:
 * a real title and description in the HTML, and an invisible plain copy for crawlers. Nothing visible changes.
 */
function shellFix(cfg: SeoConfig, raw: PageAudit, rendered: PageAudit, renderedHtml: string, base: Finding): Finding {
  const f = cfg.facts ?? {};
  const town = cfg.towns?.[0];
  const trade = cfg.trade ? cfg.trade[0].toUpperCase() + cfg.trade.slice(1) : "";
  const factTitle = [trade && town ? `${trade} in ${town}` : trade || "", f.businessName ?? cfg.domain].filter(Boolean).join(" | ");
  const title = !isPlaceholderTitle(rendered.title) ? rendered.title : factTitle;
  const firstPara = renderedHtml.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").match(/<p[^>]*>([^<]{60,400})<\/p>/i)?.[1]?.replace(/\s+/g, " ").trim();
  const description = rendered.description || (firstPara ? (firstPara.length > 155 ? `${firstPara.slice(0, 152).replace(/\s+\S*$/, "")}...` : firstPara) : "");
  const copy = staticCopy(renderedHtml);
  if (!copy) return base;
  const fields = [{ name: "title", label: "Title", before: raw.title, after: title.slice(0, 70) }, ...(description ? [{ name: "description", label: "Description", before: raw.description, after: description }] : [])].filter((x) => x.after && x.after !== x.before);
  return {
    ...base,
    summary: "AI crawlers see an empty page: the site's words only appear after scripts run. Add a readable copy and a real title.",
    detail: {
      ...base.detail,
      effort: "1 click",
      evidence: {
        why: `Read without JavaScript, the home page has ${raw.words} word${raw.words === 1 ? "" : "s"} and its title is "${raw.title || "(none)"}". Once its scripts run it has ${rendered.words} words${!isPlaceholderTitle(rendered.title) && rendered.title !== raw.title ? ` and the title "${rendered.title}"` : ""}. Google runs scripts, so it can read the page. ChatGPT, Claude, Perplexity and most other AI crawlers don't, so to them this business has no services, no areas and no phone number. This change puts a real title and description into the page itself and adds a plain copy of the page's own words that only those crawlers read. Visitors see no difference. It's the quick fix; the full one is publishing the site as real HTML instead of a script bundle.`,
        page: "/",
        numbers: [{ label: "Words without scripts", value: String(raw.words) }, { label: "Words after scripts run", value: String(rendered.words) }, { label: "Title in the page itself", value: raw.title || "(none)" }, { label: "Title after scripts run", value: rendered.title || "(none)" }],
      },
    },
    draft: { target: "site", page: "/", fields, blocks: [{ page: "/", label: "Plain copy of the page's words, for crawlers that don't run scripts", html: copy }] },
  };
}

/** Rolls the small deterministic site fixes into one reviewed change: the launch check. */
function bundleLaunch(cfg: SeoConfig, findings: Finding[]): Finding[] {
  const parts = findings.filter((f) => BUNDLE_KINDS.includes(f.kind) && f.draft && !f.draft.needsAi);
  if (parts.length < 2) return findings;
  const files = new Map<string, string>();
  const blocks: { page: string; label: string; html: string }[] = [];
  for (const p of parts) {
    for (const f of p.draft!.files ?? []) files.set(f.path, f.content);
    if (p.draft!.html) blocks.push({ page: p.draft!.page ?? "/", label: p.kind === "tracking" ? "Tracking script" : "Business schema", html: p.draft!.html });
  }
  const clicks = parts.reduce((n, p) => n + (p.detail.gain.clicks ?? 0), 0);
  const v = valueOf({ clicks }, cfg, [{ label: "The basics every new site needs", value: "estimate", assumed: true }]);
  const bundle: Finding = {
    kind: "launch_check",
    type: "Technical",
    dedupe: "launch_check",
    summary: `Bring the site up to the launch standard: ${parts.length} fixes in one change.`,
    detail: { evidence: { why: `The site is missing ${parts.length} basics every site should launch with. They're bundled into one change so there's one thing to review.`, numbers: parts.map((p) => ({ label: p.summary, value: p.draft!.files?.map((f) => `/${f.path}`).join(", ") || (p.kind === "tracking" ? "every page" : "home page") })) }, gain: { clicks, gbp: Math.round(v.gbp) }, chain: v.chain, confidence: "High", effort: "1 click", risk: "Low", undoable: true, links: cfg.domain ? [{ label: "Live site", url: `https://${cfg.domain}` }] : undefined },
    draft: { target: "site", page: "/", files: [...files.entries()].map(([path, content]) => ({ path, content })), blocks },
  };
  return [bundle, ...findings.filter((f) => !parts.includes(f))];
}

type Mode = "daily" | "full";

/**
 * One client's run. Detectors are plain code on free data; AI is only used to write drafts.
 * Every step is wrapped so one failing source never stops the rest.
 */
export async function runClient(clientId: string, mode: Mode = "daily", deadline = Date.now() + 200_000): Promise<string[]> {
  const log: string[] = [];
  // Past the deadline, the optional slow steps are skipped and picked up on the next run.
  const time = () => Date.now() < deadline;
  const s0 = await getSettings(clientId);
  const { data: c } = await db().from("clients").select("*").eq("id", clientId).maybeSingle<Client>();
  if (!s0 || !c) return ["no settings or client"];
  const today = todayLondon();
  const weekly = mode === "full" || !s0.last_weekly_on || s0.last_weekly_on < mondayOf(new Date());
  const monthly = !s0.last_monthly_on || s0.last_monthly_on.slice(0, 7) !== today.slice(0, 7);
  const rate = s0.config.enquiryRate ? null : await realEnquiryRate(clientId).catch(() => null);
  const cfg: SeoConfig = { ...s0.config, country: s0.config.country ?? c.country, ...(rate ? { enquiryRate: rate } : {}) };
  const state: Partial<SeoState> = {};
  const paused = s0.paused || (await globalPaused());

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      if (mode === "full") await patchState(clientId, { progress: name });
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(`${name} failed: ${msg}`);
      console.error("SEO step failed", clientId, name, msg);
    }
  };
  // What has worked for this trade ranks a little higher; what hasn't, a little lower.
  const boost: Record<string, number> = {};
  for (const [kind, r] of Object.entries(await trackRecord(cfg.trade).catch(() => ({})))) if (r.total >= 3) boost[kind] = r.worked / r.total >= 0.6 ? 1.2 : r.worked / r.total <= 0.25 ? 0.8 : 1;
  const raise = async (findings: Finding[], group: string[]) => {
    const r = await upsertFindings(clientId, findings, cfg, group, boost);
    if (r.added) log.push(`+${r.added} items`);
  };

  // 1. Is the site up, and are the certificate and domain safe?
  if (cfg.domain) await step("Checking the site is up", async () => {
    let h = await healthCheck(cfg.domain!, s0.state.health, weekly);
    if (!h.up) h = await healthCheck(cfg.domain!, s0.state.health, false); // one retry before raising the alarm
    state.health = h;
    const f: Finding[] = [];
    if (!h.up) f.push(alert(cfg, "site_down", `${cfg.domain} is down${h.status ? ` (error ${h.status})` : ""}.`, `The site didn't load on two attempts at ${new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}. A site that stays down loses its rankings within days.`, ["Open the site in a browser to confirm.", "Check the Vercel project (or host) for a failed deploy or a billing problem.", "Check the domain's DNS still points at the host."]));
    if (h.tlsDaysLeft !== null && h.tlsDaysLeft !== undefined && h.tlsDaysLeft < 10) f.push(alert(cfg, "tls_expiring", `${cfg.domain}'s security certificate expires in ${h.tlsDaysLeft} days.`, "Certificates normally renew themselves. One this close to expiry means renewal is failing, and browsers will block the site when it lapses.", ["Open the host's domain settings and check the certificate status.", "On Vercel: Project, Settings, Domains, then Refresh on the domain."]));
    if (h.domainDaysLeft !== null && h.domainDaysLeft !== undefined && h.domainDaysLeft < 30) f.push(alert(cfg, "domain_expiring", `The domain ${cfg.domain} expires in ${h.domainDaysLeft} days.`, "If the domain lapses, the site, the email and every ranking go with it.", ["Tell the client today: they need to renew it with their registrar and switch on auto-renew."]));
    await raise(f, HEALTH_KINDS);
  });

  if (cfg.siteType === "vercel" && cfg.githubRepo && seoEnv.githubToken() && weekly) await step("Checking GitHub access", async () => {
    try {
      const info = await repoInfo(cfg.githubRepo!);
      state.github = info.push ? { ok: true, at: new Date().toISOString() } : { ok: false, at: new Date().toISOString(), error: "The token can read this repo but can't write to it." };
    } catch (err) {
      state.github = { ok: false, at: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 2. Read the site the way a crawler does. Full crawl weekly, home page only on other days.
  let audit: SiteAudit | null = null;
  let pages: PageSummary[] = (await getLatest<PageSummary[]>(clientId, "pages")) ?? [];
  const clicksNow = (await getLatest<PageSnapshot>(clientId, "page_rows"))?.rows.reduce((n, r) => n + r.clicks, 0) ?? 0;
  if (cfg.domain && state.health?.up !== false) await step("Reading the site's pages", async () => {
    audit = await crawlSite(cfg.domain!, weekly ? 40 : 1);
    let f = detectOnSite(cfg, audit, { monthlyClicks: clicksNow, appUrl: seoEnv.appUrl(), trackingToken: s0.tracking_token });
    if (!weekly) {
      // Daily: alerts only. An empty-shell alert that's already open keeps its fuller weekly write-up.
      const shellNow = f.some((x) => x.kind === "no_js_content");
      const known = shellNow && (await listActions({ clientId, statuses: ["new", "approved"] })).some((a) => a.kind === "no_js_content");
      return void (await raise(f.filter((x) => ALERT_KINDS.includes(x.kind) && !(known && x.kind === "no_js_content")), shellNow ? ALERT_KINDS.filter((k) => k !== "no_js_content") : ALERT_KINDS));
    }
    // An empty shell until scripts run: read the rendered page too, so the other checks judge what's really there.
    const shell = f.find((x) => x.kind === "no_js_content");
    if (shell && audit.pages[0]) {
      const raw = audit.pages[0];
      const r = time() ? await renderPage(`https://${cfg.domain}`) : null;
      const rendered = r ? parseHtml(`https://${cfg.domain}/`, r.html) : null;
      if (r && rendered && rendered.words >= 80) {
        const seen: SiteAudit = { ...audit, pages: [{ ...rendered, path: "/", status: 200, hasTracking: raw.hasTracking, schemaTypes: [...new Set([...raw.schemaTypes, ...rendered.schemaTypes])] }, ...audit.pages.slice(1)] };
        const fix = shellFix(cfg, raw, rendered, r.html, shell);
        const fixesTitle = fix.draft?.fields?.some((x) => x.name === "title");
        f = [fix, ...detectOnSite(cfg, seen, { monthlyClicks: clicksNow, appUrl: seoEnv.appUrl(), trackingToken: s0.tracking_token }).filter((x) => x.kind !== "no_js_content" && !(fixesTitle && x.dedupe === "title_rewrite:/"))];
        audit = seen;
      } else {
        // Couldn't render it: the content checks would only be guessing, so they wait for this to be fixed.
        shell.detail.evidence.why += " The other content checks (phone link, call to action, headings, reviews) are on hold for this site until this is fixed, because the words can't be read.";
        f = f.filter((x) => !CONTENT_KINDS.includes(x.kind));
      }
    }
    pages = audit.pages.map((p) => ({ path: p.path, title: p.title, description: p.description, words: p.words, h1: p.h1[0] ?? "", status: p.status }));
    await putLatest(clientId, "pages", pages);
    state.crawl = { at: new Date().toISOString(), pages: pages.length, tracking: !!audit.pages[0]?.hasTracking };
    const key = seoEnv.indexNowKey();
    if (key && (await get(`https://${cfg.domain}/${key}.txt`)).status !== 200) f.push({ kind: "indexnow_key", type: "Technical", dedupe: "indexnow_key", summary: "Add the IndexNow key file so Bing hears about new pages within hours.", detail: { evidence: { why: "IndexNow tells Bing, and through it ChatGPT search, the moment a page changes. It needs one small key file on the site." }, gain: { clicks: 1, gbp: Math.round(valueOf({ clicks: 1 }, cfg).gbp) }, chain: valueOf({ clicks: 1 }, cfg).chain, confidence: "Medium", effort: "1 click", risk: "Low", undoable: true }, draft: { target: "site", files: [{ path: `${key}.txt`, content: key }] } });
    const sp = await pageSpeed(`https://${cfg.domain}`);
    if (sp) {
      state.speed = { at: new Date().toISOString(), mobile: sp.score, lcp: sp.lcp };
      if (sp.score < 50) f.push({ kind: "slow_site", type: "Technical", dedupe: "slow_site", summary: `The site is slow on phones: ${sp.score} out of 100 on Google's speed test.`, detail: { evidence: { why: `Google PageSpeed on mobile scored ${sp.score}/100. The main content takes ${sp.lcp} seconds to appear (under 2.5 is good). Slow pages lose visitors before they call.`, numbers: [{ label: "Mobile score", value: `${sp.score}/100` }, { label: "Main content appears", value: `${sp.lcp}s` }, { label: "Blocked time", value: `${sp.tbt}ms` }] }, gain: { clicks: Math.max(2, clicksNow * 0.05), gbp: Math.round(valueOf({ clicks: Math.max(2, clicksNow * 0.05) }, cfg).gbp) }, chain: valueOf({ clicks: Math.max(2, clicksNow * 0.05) }, cfg, [{ label: "Faster pages keep more visitors", value: "about 5% more", assumed: true }]).chain, confidence: "Medium", effort: "30 min manual", risk: "Low", undoable: true, links: [{ label: "PageSpeed report", url: `https://pagespeed.web.dev/analysis?url=https://${cfg.domain}` }] }, draft: { target: "site", page: "/", note: "Compress and resize the largest images (serve WebP at the size shown), lazy-load images below the fold, and remove any script that isn't needed. Do not change the design." } });
    }
    const existing = (await listActions({ clientId })).find((a) => a.dedupe_key === "launch_check");
    if ((!existing && (mode === "full" || !s0.last_weekly_on)) || (existing && ["new", "approved", "snoozed"].includes(existing.status))) f = bundleLaunch(cfg, f);
    await raise(f, ONSITE_KINDS);
  });

  // 3. Search Console.
  let weeks: WeekPoint[] = [];
  let siteDropNote: string | undefined;
  if (cfg.gscProperty) await step("Reading Search Console", async () => {
    try {
      const snap = await searchSnapshot(cfg.gscProperty!);
      weeks = await weeklyTotals(cfg.gscProperty!);
      for (const w of weeks.slice(mode === "full" || weekly ? 0 : -3)) await putMetric(clientId, w.week, "site", w);
      const prevQ = new Map(snap.q28.prev.map((r) => [r.key, r]));
      const topPage = new Map<string, string>();
      for (const r of [...snap.qp].sort((a, b) => a.impressions - b.impressions)) topPage.set(r.query, pathOf(r.page));
      await putLatest(clientId, "query_rows", { period: snap.period, rows: snap.q28.cur.slice(0, 500).map((r) => ({ ...r, prevClicks: prevQ.get(r.key)?.clicks ?? 0, prevImpressions: prevQ.get(r.key)?.impressions ?? 0, prevPosition: prevQ.get(r.key)?.position ?? null, page: topPage.get(r.key) })) } satisfies QuerySnapshot);
      const prevP = new Map(snap.p28.prev.map((r) => [pathOf(r.key), r]));
      await putLatest(clientId, "page_rows", { period: snap.period, rows: snap.p28.cur.map((r) => ({ ...r, key: pathOf(r.key), prevClicks: prevP.get(pathOf(r.key))?.clicks ?? 0 })) } satisfies PageSnapshot);
      if (weekly) await putMetric(clientId, mondayOf(new Date()), "top", { queries: snap.q28.cur.slice(0, 50), pages: snap.p28.cur.slice(0, 30).map((r) => ({ ...r, key: pathOf(r.key) })) });
      const setupAge = s0.setup_done_at ? (Date.now() - Date.parse(s0.setup_done_at)) / DAY : 0;
      const out = detectSearch({ cfg, q28: snap.q28, p28: snap.p28, qp: snap.qp, knownPaths: pages.filter((p) => p.status === 200).map((p) => p.path), siteAgeDays: Math.max(setupAge, weeks.length >= 6 ? 42 : 0), period: snap.period });
      // The chart on each card: that page's or search's clicks over 16 weeks. Only the biggest few, to stay light.
      for (const f of [...out.findings].sort((a, b) => (b.detail.gain.gbp ?? 0) - (a.detail.gain.gbp ?? 0)).slice(0, 6)) {
        const ev = f.detail.evidence;
        if (f.kind === "site_drop") ev.series = { label: "Clicks from Google, whole site", points: weeks.map((w) => ({ week: w.week, value: w.clicks })) };
        else if (ev.page || ev.query) ev.series = { label: ev.page ? `Clicks to ${ev.page}` : `Clicks for "${ev.query}"`, points: await seriesFor(cfg.gscProperty!, { page: ev.page, query: ev.page ? undefined : ev.query }, cfg.domain).catch(() => []) };
      }
      if (weekly) {
        const dead = out.findings.find((f) => f.kind === "dead_pages");
        for (const n of dead?.detail.evidence.numbers?.slice(0, 5) ?? []) {
          const r = await inspectUrl(cfg.gscProperty!, `https://${cfg.domain}${n.label}`).catch(() => null);
          if (r) n.value = r.coverage;
        }
      }
      if (out.siteDrop) siteDropNote = `Clicks fell ${Math.round(out.siteDrop.pct * 100)}% across the whole site (${out.siteDrop.from} to ${out.siteDrop.to}).`;
      state.gsc = { ok: true, at: new Date().toISOString(), tooEarly: out.tooEarly };
      state.brand = out.brand;
      if (!s0.state.baseline) state.baseline = { at: new Date().toISOString(), clicks: snap.p28.cur.reduce((n, r) => n + r.clicks, 0), impressions: snap.p28.cur.reduce((n, r) => n + r.impressions, 0), reviews: c.google_review_count ?? undefined, rating: c.google_rating ?? undefined };
      await raise(out.findings, SEARCH_KINDS);
    } catch (err) {
      state.gsc = { ok: false, at: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
      throw err;
    }
  });
  if (!weeks.length) weeks = (await weeklyMetrics<WeekPoint>(clientId, "site")).map((w) => w.data);

  // 4. Business Profile (weekly) and reviews (daily).
  let competitors = await latestCompetitors(clientId).catch(() => []);
  let callsMonth = 0;
  if (weekly && time()) await step("Checking Google Maps competitors", async () => {
    const r = await checkCompetitors(clientId, cfg);
    if (r.checks.length) competitors = r.checks;
    if (r.note) log.push(r.note);
  });
  if (cfg.gbpLocation && weekly) await step("Reading the Business Profile", async () => {
    const p = await readProfile(clientId, cfg, competitors);
    state.gbp = { ok: !!p.profile, write: p.write, error: p.error, at: new Date().toISOString(), profile: p.profile ?? undefined };
    for (const w of p.weeks) await putMetric(clientId, w.week, "gbp", w);
    callsMonth = p.weeks.slice(-4).reduce((n, w) => n + w.calls, 0);
    if (p.profile) await raise([...p.findings.filter((f) => !f.kind.includes("post")), ...(await holidayFindings(cfg, p.raw))], [...PROFILE_KINDS, "holiday_hours"]);
    const post = p.findings.find((f) => f.kind === "gbp_post");
    await raise(post ? [post] : [], ["gbp_post"]);
    if (state.baseline && p.weeks.length) state.baseline.calls = callsMonth;
    await putLatest(clientId, "gbp_keywords", await searchKeywords(cfg.gbpLocation!).catch(() => []));
  });
  await step("Checking reviews", async () => {
    const r = await reviewFindings(c, cfg, competitors);
    await raise(r.findings, ["review_pace", "review_reply"]);
  });
  if (weekly && competitors.length) await step("Comparing competitors", async () => void (await raise(competitorFindings(cfg, competitors, callsMonth), ["map_rank"])));

  // 5. Weather daily; AI visibility, Bing, seasons and citations weekly.
  await step("Checking the weather", async () => {
    const w = await weatherFindings(cfg);
    state.weather = { at: new Date().toISOString(), alert: w.alert };
    await raise(w.findings, ["weather_post"]);
  });
  let aiNamed = "";
  if (weekly) {
    if (time()) await step("Asking AI tools about the business", async () => {
      const r = await checkAiVisibility(clientId, cfg);
      if (r.note) log.push(r.note);
      const checks = r.checks.length ? r.checks : (await recentAiChecks(clientId, 12)).filter((x) => Date.now() - Date.parse(x.checked_on) < 10 * DAY);
      if (checks.length) {
        aiNamed = `named in ${checks.filter((x) => x.named).length} of ${checks.length} answers`;
        if (state.baseline && state.baseline.aiAsked === undefined) Object.assign(state.baseline, { aiNamed: checks.filter((x) => x.named).length, aiAsked: checks.length });
        await raise(aiFindings(cfg, checks, clicksNow), ["ai_visibility"]);
      }
    });
    await step("Reading Bing", async () => {
      const b = cfg.domain ? await bingStats(cfg.bingSite ?? `https://${cfg.domain}/`) : null;
      if (b) await putLatest(clientId, "bing", b);
    });
    await step("Seasonal and directory checks", async () => {
      await raise(seasonalFindings(cfg), []);
      await raise(citationFinding(cfg, await citationRows(clientId)), ["citations"]);
    });
  }

  // 6. Measure what was changed 28 days ago.
  await step("Measuring past changes", async () => {
    const m = await measureDue(clientId, cfg);
    if (m.measured) log.push(`measured ${m.measured}`);
    await raise(m.findings, []);
  });

  // 7. The strategist: a weekly diagnosis, and a 90-day plan each month.
  const context = async (): Promise<StrategyContext> => {
    const open = await listActions({ clientId, statuses: ["new"] });
    const done = (await listActions({ clientId, statuses: ["applied"], limit: 60 })).filter((a) => a.result);
    const gbpWeeks = await weeklyMetrics<{ calls: number }>(clientId, "gbp");
    return { cfg, weeklyClicks: weeks.map((w) => w.clicks), weeklyCalls: gbpWeeks.map((w) => w.data.calls), open: open.map((o) => ({ type: o.type, summary: o.summary, score: o.score })), measured: done.map((a) => ({ summary: a.summary, verdict: a.result!.text })), competitors: competitors.map((k) => `"${k.query}": ${k.clientRank ? `position ${k.clientRank}` : "not in the top 10"}; top: ${k.top.filter((t) => !t.isClient).slice(0, 3).map((t) => `${t.name} (${t.reviews ?? "?"} reviews)`).join(", ")}`).join(" | "), aiNamed, siteDrop: siteDropNote, updates: await googleUpdates() };
  };
  let aiNote: string | undefined;
  if (weekly) await step("Writing the weekly review", async () => void (await writeWeeklyReview(clientId, await context())));
  const didMonthly = monthly && !!s0.setup_done_at && time();
  if (didMonthly) {
    await step("Writing the 90-day plan", async () => {
      try {
        await writePlan(clientId, await context());
      } catch (err) {
        if (err instanceof AiUnavailable) aiNote = err.message;
        else throw err;
      }
    });
    if (time()) await step("Looking for local links", async () => {
      try {
        await raise(await findLinks(clientId, cfg), []);
      } catch (err) {
        if (!(err instanceof AiUnavailable)) throw err;
      }
    });
    await step("Drafting the client's results email", async () => {
      const done = (await listActions({ clientId, statuses: ["applied"], limit: 30 })).filter((a) => a.applied_at && Date.now() - Date.parse(a.applied_at) < 35 * DAY && a.type !== "Manual").slice(0, 4).map((a) => a.summary.replace(/:.*$/, ""));
      const f = clientReportFinding(c, cfg, await monthResults(clientId, 3), done);
      if (f) await raise([f], []);
    });
    if (time()) await step("Checking the playbook", async () => {
      try {
        await researchPlaybook();
      } catch (err) {
        if (!(err instanceof AiUnavailable)) throw err;
      }
    });
  }

  // 8. Write the drafts. The top few each run, within the AI budget.
  await step("Writing drafts", async () => {
    const waiting = (await listActions({ clientId, statuses: ["new"] })).filter((a) => a.draft?.needsAi).slice(0, mode === "full" ? 10 : 8);
    for (const a of waiting) {
      if (!time()) break;
      try {
        const d = await draftFor(a, cfg, c);
        if (d) await updateAction(a.id, { draft: d });
      } catch (err) {
        if (err instanceof AiUnavailable) {
          aiNote = err.message;
          break;
        }
        console.error("SEO draft failed", a.id, err instanceof Error ? err.message : err);
      }
    }
    // Review replies never sit empty: a plain template stands in until AI is connected.
    for (const a of (await listActions({ clientId, statuses: ["new"] })).filter((x) => x.kind === "review_reply" && x.draft?.needsAi)) {
      const { data: rv } = await db().from("google_reviews").select("rating, reviewer_name").eq("id", a.draft?.note ?? "").maybeSingle<{ rating: number | null; reviewer_name: string | null }>();
      if (rv) await updateAction(a.id, { draft: { target: "review", note: a.draft?.note, fields: [{ name: "reply", label: "Reply", before: "", after: templateReply(rv, c) }] } });
    }
  });

  // 9. Pull requests for repo-backed sites, and auto-apply for the safe kinds that are switched on.
  if (!paused && time()) await step("Preparing site changes", async () => {
    const open = await listActions({ clientId, statuses: ["new", "approved"] });
    const repoSite = cfg.siteType === "vercel" && !!cfg.githubRepo && !!seoEnv.githubToken();
    if (repoSite) {
      for (const a of open.filter((x) => x.apply?.prNumber)) log.push(`PR ${a.apply!.prNumber}: ${await progressPr(a.id).catch((e) => (e instanceof Error ? e.message : String(e)))}`);
      const openPrs = open.filter((x) => x.apply?.prNumber).length;
      const ready = open.filter((x) => x.status === "new" && x.draft?.target === "site" && !x.draft.needsAi && !x.apply?.prNumber && !x.apply?.error);
      for (const a of ready.slice(0, Math.max(0, Math.min(3, 6 - openPrs)))) {
        if (!time()) break;
        try {
          await preparePr(a, { ...s0, config: cfg } as SeoSettings);
          log.push(`opened PR for ${a.kind}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (err instanceof AiUnavailable) {
            aiNote = msg;
            break;
          }
          await updateAction(a.id, { apply: { error: msg } });
        }
      }
    }
    for (const a of open.filter((x) => x.status === "new" && x.draft?.target === "profile" && !x.draft.needsAi && canAuto(x, cfg))) {
      const r = await approveAction(a.id, { auto: true });
      log.push(`auto ${a.kind}: ${r.message}`);
    }
  });

  if (!s0.state.baseline && !state.baseline) state.baseline = { at: new Date().toISOString(), reviews: c.google_review_count ?? undefined, rating: c.google_rating ?? undefined, calls: callsMonth || undefined };
  await patchState(clientId, { ...state, lastRunAt: new Date().toISOString(), lastError: aiNote ?? log.find((l) => l.includes("failed")) ?? undefined, progress: undefined });
  await db().from("seo_settings").update({ last_run_on: today, run_claimed_at: null, ...(weekly && time() ? { last_weekly_on: today } : {}), ...(didMonthly ? { last_monthly_on: today } : {}) }).eq("client_id", clientId);
  return log;
}

/** Old rows go after 16 months so the free database plan stays small. */
export async function prune() {
  const cutoff = new Date(Date.now() - 16 * 30.5 * DAY).toISOString();
  const day = cutoff.slice(0, 10);
  await Promise.all([
    db().from("seo_metrics").delete().lt("week", day).neq("week", "2000-01-03"),
    db().from("seo_events").delete().lt("day", day),
    db().from("seo_ai_checks").delete().lt("checked_on", day),
    db().from("seo_competitors").delete().lt("checked_on", day),
    db().from("seo_ai_usage").delete().lt("created_at", cutoff),
    db().from("seo_actions").delete().in("status", ["dismissed", "done"]).lt("updated_at", cutoff),
  ]);
}

export type { SeoAction };
