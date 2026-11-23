// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSearch, isPrice, isQuestion, NOISE, type DetectInput } from "./detect";
import { intoBody, intoHead, isHeadOnly, setDescription, setTitle } from "./html-edit";
import { blockedByRobots, detectOnSite, isPlaceholderTitle, parseHtml, staticCopy, type SiteAudit } from "./onsite";
import { isSafe } from "./safe";
import type { Row, SeoAction, SeoConfig } from "./types";
import { expectedCtr, scoreOf, valueOf } from "./value";
import { verdict } from "./verdict";

const cfg: SeoConfig = { domain: "example.com", trade: "driveways", country: "GB", services: ["Block paving", "Resin driveways"], towns: ["Watford", "Bushey"], facts: { businessName: "Hartley Paving", phone: "01923 555014" }, gscProperty: "sc-domain:example.com" };
const row = (key: string, clicks: number, impressions: number, position: number): Row => ({ key, clicks, impressions, position });
const base = (over: Partial<DetectInput> = {}): DetectInput => ({ cfg, q28: { cur: [], prev: [] }, p28: { cur: [], prev: [] }, qp: [], knownPaths: ["/", "/block-paving-watford"], siteAgeDays: 10, period: "the 28 days to 19 Nov", ...over });
const kinds = (i: DetectInput) => detectSearch(i).findings.map((f) => f.kind);

test("click rate curve falls with position", () => {
  assert.ok(expectedCtr(1) > expectedCtr(3) && expectedCtr(3) > expectedCtr(10) && expectedCtr(10) > expectedCtr(18));
  assert.equal(expectedCtr(4), 0.07);
});

test("value chain uses the client's own numbers when set and labels estimates when not", () => {
  const own = valueOf({ clicks: 100 }, { ...cfg, jobValueGbp: 1000, enquiryRate: 0.1, closeRate: 0.5 });
  assert.equal(Math.round(own.gbp), 5_000);
  assert.ok(own.chain.every((c) => !c.assumed));
  const guess = valueOf({ clicks: 100 }, cfg);
  assert.equal(Math.round(guess.gbp), Math.round(100 * 0.05 * 0.33 * 4500));
  assert.ok(guess.chain.some((c) => c.assumed));
});

test("score: alerts first, profile above page above content, effort and confidence count", () => {
  const d = { gain: { gbp: 1000 }, confidence: "High" as const, effort: "1 click" as const };
  assert.ok(scoreOf("Profile", d) > scoreOf("Page", d));
  assert.ok(scoreOf("Page", d) > scoreOf("Content", d));
  assert.ok(scoreOf("Page", d) > scoreOf("Page", { ...d, effort: "30 min manual" }));
  assert.ok(scoreOf("Page", d) > scoreOf("Page", { ...d, confidence: "Low" }));
  assert.ok(scoreOf("Content", { ...d, alert: true }) > scoreOf("Profile", d));
  assert.ok(scoreOf("Page", d, { servesGoal: false }) < scoreOf("Page", d));
});

test("thin data raises nothing from search but says too early", () => {
  const out = detectSearch(base({ q28: { cur: [row("block paving watford", 1, 20, 8)], prev: [] }, p28: { cur: [row("https://example.com/block-paving-watford", 1, 20, 8)], prev: [] } }));
  assert.equal(out.tooEarly, true);
  assert.ok(!out.findings.some((f) => ["title_rewrite", "page_boost", "page_refresh", "answer_block"].includes(f.kind)));
});

test("low click rate at a good position suggests a title rewrite, and can auto-apply", () => {
  const out = detectSearch(base({ q28: { cur: [row("block paving watford", 10, 1240, 4)], prev: [] }, p28: { cur: [row("https://example.com/block-paving-watford", 10, 1240, 4)], prev: [] }, qp: [{ query: "block paving watford", page: "https://example.com/block-paving-watford", clicks: 10, impressions: 1240, position: 4 }] }));
  const f = out.findings.find((x) => x.kind === "title_rewrite");
  assert.ok(f, "expected a title rewrite");
  assert.equal(f.detail.autoOk, true);
  assert.equal(f.detail.confidence, "High");
  assert.ok((f.detail.gain.clicks ?? 0) > 20);
  assert.ok((f.detail.gain.gbp ?? 0) > 0);
});

test("small drops are ignored; real page drops are raised", () => {
  const small = base({ q28: { cur: [row("x", 2, 200, 5)], prev: [] }, p28: { cur: [row("https://example.com/", 1, 200, 5)], prev: [row("https://example.com/", 2, 200, 5)] } });
  assert.ok(!kinds(small).includes("page_refresh"), `below ${NOISE.minClicks} clicks is noise`);
  const real = base({ q28: { cur: [row("x", 30, 900, 5)], prev: [] }, p28: { cur: [row("https://example.com/", 40, 900, 5), row("https://example.com/patios", 4, 300, 9)], prev: [row("https://example.com/", 38, 900, 5), row("https://example.com/patios", 20, 300, 6)] } });
  const f = detectSearch(real).findings.find((x) => x.kind === "page_refresh");
  assert.equal(f?.detail.evidence.page, "/patios");
});

test("a drop across the whole site is one diagnosis, not one alert per page", () => {
  const out = detectSearch(base({ q28: { cur: [row("x", 30, 2000, 5)], prev: [] }, p28: { cur: [row("https://example.com/", 20, 1000, 6), row("https://example.com/patios", 10, 1000, 7)], prev: [row("https://example.com/", 60, 1000, 4), row("https://example.com/patios", 40, 1000, 5)] } }));
  assert.ok(out.siteDrop);
  assert.equal(out.findings.filter((f) => f.kind === "site_drop").length, 1);
  assert.equal(out.findings.filter((f) => f.kind === "page_refresh").length, 0);
});

test("positions 5 to 15 with real impressions become a page boost; brand searches don't", () => {
  const qp = [{ query: "resin driveways watford", page: "https://example.com/resin", clicks: 3, impressions: 400, position: 8 }, { query: "hartley paving", page: "https://example.com/", clicks: 50, impressions: 400, position: 7 }];
  const out = detectSearch(base({ q28: { cur: [row("resin driveways watford", 3, 400, 8), row("hartley paving", 50, 400, 7)], prev: [] }, p28: { cur: [row("https://example.com/resin", 3, 400, 8)], prev: [] }, qp, knownPaths: ["/", "/resin"] }));
  const boosts = out.findings.filter((f) => f.kind === "page_boost");
  assert.equal(boosts.length, 1);
  assert.equal(boosts[0].detail.evidence.page, "/resin");
  assert.equal(out.brand.brandClicks, 50);
});

test("questions and price searches are recognised", () => {
  assert.ok(isQuestion("how long does a resin driveway last"));
  assert.ok(!isQuestion("resin driveway watford"));
  assert.ok(isPrice("block paving cost per m2"));
  const qp = [{ query: "how long does a resin driveway last in the uk", page: "https://example.com/resin", clicks: 1, impressions: 190, position: 9 }];
  const out = detectSearch(base({ q28: { cur: [row("how long does a resin driveway last in the uk", 1, 190, 9), row("block paving cost per m2", 2, 230, 12)], prev: [] }, p28: { cur: [row("https://example.com/resin", 1, 190, 9)], prev: [] }, qp, knownPaths: ["/", "/resin"] }));
  assert.ok(out.findings.some((f) => f.kind === "answer_block" && f.detail.evidence.page === "/resin"));
  assert.ok(out.findings.some((f) => f.kind === "cost_guide"));
});

test("a service and town with no page is a gap; one with a page is not", () => {
  const out = detectSearch(base({ q28: { cur: [row("block paving bushey", 1, 120, 19)], prev: [] }, p28: { cur: [row("https://example.com/", 1, 120, 19)], prev: [] } }));
  const gaps = out.findings.filter((f) => f.kind === "new_page").map((f) => f.dedupe);
  assert.ok(gaps.includes("new_page:block-paving-bushey"));
  assert.ok(!gaps.includes("new_page:block-paving-watford"), "the Watford page exists");
  assert.equal(out.findings.find((f) => f.dedupe === "new_page:block-paving-bushey")?.detail.confidence, "Medium");
});

test("robots.txt: a blanket block shuts AI crawlers out; a specific allow lets one back in", () => {
  assert.deepEqual(blockedByRobots("User-agent: *\nDisallow: /", ["GPTBot"]), ["GPTBot"]);
  assert.deepEqual(blockedByRobots("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /", ["GPTBot", "ClaudeBot"]), ["ClaudeBot"]);
  assert.deepEqual(blockedByRobots("User-agent: *\nDisallow: /admin\n", ["GPTBot"]), []);
  assert.deepEqual(blockedByRobots("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /", ["GPTBot", "ClaudeBot", "Bingbot"]), ["GPTBot", "ClaudeBot"]);
});

const HOME = `<html><head><title>Hartley Paving</title><meta name="description" content="Driveways in Watford."><script type="application/ld+json">{"@type":"LocalBusiness","sameAs":["https://facebook.com/h"]}</script></head><body><h1>Driveways in Watford</h1><a href="tel:01923555014">Call</a><a href="/patios">Patios</a><p>${"Quality driveways. ".repeat(60)} Get a free quote. Reviews from customers.</p><img src="a.jpg"></body></html>`;

test("html is read without running scripts", () => {
  const p = parseHtml("https://example.com/", HOME);
  assert.equal(p.title, "Hartley Paving");
  assert.equal(p.description, "Driveways in Watford.");
  assert.deepEqual(p.h1, ["Driveways in Watford"]);
  assert.deepEqual(p.tel, ["01923555014"]);
  assert.ok(p.schemaTypes.includes("LocalBusiness"));
  assert.deepEqual(p.links, ["/patios"]);
  assert.equal(p.imgsNoAlt, 1);
  assert.ok(p.hasCta && p.hasReviews);
});

test("on-site checks: a healthy home page raises only what's missing; an empty one raises the alert", () => {
  const audit = (html: string): SiteAudit => ({ pages: [parseHtml("https://example.com/", html)], robots: "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml", llms: false, sitemapFound: true, broken: [], botWall: [] });
  const good = detectOnSite(cfg, audit(HOME), { monthlyClicks: 300, appUrl: "https://app.test", trackingToken: "abc" }).map((f) => f.kind);
  assert.ok(good.includes("llms_txt") && good.includes("tracking"));
  assert.ok(!good.includes("schema_local") && !good.includes("phone_click") && !good.includes("no_js_content"));
  const empty = detectOnSite(cfg, audit(`<html><head><title>x</title></head><body><div id="root"></div><script src="app.js"></script></body></html>`), { monthlyClicks: 300, appUrl: "https://app.test", trackingToken: "abc" });
  assert.ok(empty.find((f) => f.kind === "no_js_content")?.detail.alert);
});

test("28-day verdict is judged against how the rest of the site moved", () => {
  assert.equal(verdict(2, 3, 100, 100), "too early");
  assert.equal(verdict(20, 40, 100, 100), "worked");
  assert.equal(verdict(20, 40, 100, 220), "no change", "the whole site doubled, so this page only kept pace");
  assert.equal(verdict(40, 20, 100, 100), "worse");
  assert.equal(verdict(40, 22, 100, 50), "no change", "the whole site halved");
});

test("approve all safe leaves out anything with gaps, risk, new pages or a failed visual check", () => {
  const a = (over: Partial<SeoAction>): SeoAction => ({ id: "1", client_id: "c", kind: "title_rewrite", type: "Page", status: "new", dedupe_key: "k", score: 1, summary: "s", detail: { evidence: { why: "" }, gain: {}, chain: [], confidence: "High", effort: "1 click", risk: "Low", undoable: true }, draft: { target: "site", fields: [{ name: "title", label: "Title", before: "a", after: "b" }] }, apply: null, undo: null, result: null, goal: null, dismissed_reason: null, snoozed_until: null, applied_at: null, measure_at: null, created_at: "", updated_at: "", ...over });
  assert.equal(isSafe(a({})), true);
  assert.equal(isSafe(a({ draft: { target: "site", needsAi: true } })), false);
  assert.equal(isSafe(a({ draft: { target: "site", html: "<p>From [ADD: price]</p>" } })), false);
  assert.equal(isSafe(a({ kind: "new_page" })), false);
  assert.equal(isSafe(a({ draft: { target: "manual", steps: [] } })), false);
  assert.equal(isSafe(a({ apply: { visual: { ok: false, note: "moved" } } })), false);
  assert.equal(isSafe(a({ detail: { evidence: { why: "" }, gain: {}, chain: [], confidence: "Low", effort: "1 click", risk: "Low", undoable: true } })), false);
});

const SHELL = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bundled Page</title><script>${"var a=1;".repeat(400)}</script></head><body><div id="root"></div><script type="module">${"render();".repeat(400)}</script></body></html>`;
const RENDERED = `<html><head><title>Bundled Page</title></head><body><div id="root"><nav><a href="/#services">Services</a><a href="tel:07775900145">07775 900145</a></nav><h1>Driveways in Hertfordshire</h1><p>P.I.C Driveways lays block paving, resin and tarmac driveways for homes across the county, with every job surveyed and quoted free.</p><ul><li>Block paving</li><li>Resin bound</li></ul><button>Open menu</button><script>track()</script><p>P.I.C Driveways lays block paving, resin and tarmac driveways for homes across the county, with every job surveyed and quoted free.</p></div></body></html>`;

test("a script-only shell is spotted, and placeholder titles are recognised", () => {
  const raw = parseHtml("https://example.com/", SHELL);
  assert.ok(raw.words < 5);
  assert.ok(isPlaceholderTitle(raw.title) && isPlaceholderTitle("") && isPlaceholderTitle("Vite App"));
  assert.ok(!isPlaceholderTitle("Driveways in Watford | Hartley Paving"));
});

test("the plain copy mirrors the rendered page: its words and links, once each, and no scripts or buttons", () => {
  const copy = staticCopy(RENDERED);
  assert.ok(copy.startsWith("<noscript>") && copy.endsWith("</noscript>"));
  assert.ok(copy.includes("<h1>Driveways in Hertfordshire</h1>"));
  assert.ok(copy.includes('<a href="tel:07775900145">07775 900145</a>'));
  assert.ok(copy.includes("<li>Block paving</li>"));
  assert.equal(copy.split("lays block paving").length - 1, 1, "repeated text appears once");
  assert.ok(!copy.includes("track()") && !copy.includes("Open menu"));
  assert.equal(staticCopy("<html><body><div id=root></div></body></html>"), "");
});

test("edits to a bundled page change only the title, description and the added blocks", () => {
  let html = setTitle(SHELL, "Driveways in Hertfordshire | P.I.C Driveways");
  html = setDescription(html, 'Block paving & "resin" driveways.');
  html = intoHead(html, '<script type="application/ld+json">{"@type":"LocalBusiness"}</script>');
  html = intoBody(html, staticCopy(RENDERED));
  assert.ok(html.includes("<title>Driveways in Hertfordshire | P.I.C Driveways</title>") && !html.includes("Bundled Page"));
  assert.ok(html.includes('<meta name="description" content="Block paving &amp; &quot;resin&quot; driveways.">'));
  assert.ok(html.length > SHELL.length, "nothing was removed");
  assert.ok(html.includes("var a=1;".repeat(400)) && html.includes("render();".repeat(400)), "the site's own scripts are untouched");
  assert.ok(html.indexOf("<noscript>") < html.indexOf("</body>") && html.indexOf("<noscript>") > html.indexOf('<div id="root">'));
  assert.equal(intoBody(html, staticCopy(RENDERED)), html, "applying twice changes nothing");
  assert.ok(isHeadOnly('<script type="application/ld+json">{}</script>') && !isHeadOnly("<noscript><p>x</p></noscript>"));
});

test("edits ignore markup that only exists as text inside the site's scripts, and keep dollar signs literal", () => {
  const tricky = `<html><head><script>var t = "<title>fake</title></head></body>";</script><title>Bundled Page</title></head><body><div id="root"></div><script>document.write("</body>")</script></body></html>`;
  let html = setTitle(tricky, "Resin from $70 per m² | P.I.C");
  html = setDescription(html, "From $70. $& and $1 stay as typed.");
  html = intoHead(html, '<script type="application/ld+json">{"price":"$70"}</script>');
  html = intoBody(html, "<noscript><p>Hello</p></noscript>");
  assert.ok(html.includes('var t = "<title>fake</title></head></body>";'), "script text untouched");
  assert.ok(html.includes('document.write("</body>")'), "script text untouched");
  assert.ok(html.includes("<title>Resin from $70 per m² | P.I.C</title>"));
  assert.ok(html.includes('content="From $70. $&amp; and $1 stay as typed."'));
  assert.ok(html.endsWith("<noscript><p>Hello</p></noscript>\n</body></html>"), "added before the real closing body tag");
  assert.ok(html.indexOf('{"price":"$70"}') < html.indexOf("<body>") && html.indexOf('{"price":"$70"}') > html.indexOf("</title>"));
});

// ---------- The client's weekly report ----------
import { composeReport, weeklyEmail, versus, type ReportInput } from "./report-compose";

const wk = (i: number, clicks: number, calls?: number) => ({ week: `2026-0${1 + Math.floor(i / 4)}-${String(1 + (i % 4) * 7).padStart(2, "0")}`, clicks, impressions: clicks * 30, position: 6, calls, directions: calls ? 2 : undefined });
const emptyInput = (over: Partial<ReportInput> = {}): ReportInput => ({ name: "P.I.C Driveways", firstName: "John", weeks: [], hasSearch: false, hasProfile: false, siteLeads: null, enquiries: { cur: 0, prev: 0 }, textBacks: 0, reviewRequests: 0, reviewsNew7: 0, reviewsNew28: 0, reviewCount: null, rating: null, competitors: [], ranksBefore: {}, aiChecks: [], done: [], next: [], ...over });

test("the client report leaves out anything that isn't connected", () => {
  const r = composeReport(emptyInput({ textBacks: 5, done: [{ kind: "no_js_content" }] }), "the week to 23 Nov");
  assert.deepEqual(r.sections.map((s) => s.key), ["leads"]);
  assert.ok(r.sections[0].lines[0].startsWith("5 missed calls answered"));
  assert.deepEqual(r.done, ["Made your website readable by ChatGPT and other AI search tools"]);
  assert.equal(composeReport(emptyInput(), "x").sections.length, 0);
});

test("the client report compares 4 weeks with the 4 before, and says a fall as plainly as a rise", () => {
  assert.equal(versus({ cur: 30, prev: 20 }), "up from 20 in the 4 weeks before");
  assert.equal(versus({ cur: 12, prev: 20 }), "down from 20 in the 4 weeks before");
  assert.equal(versus({ cur: 5, prev: 0 }), "the first we've counted");
  const weeks = [10, 10, 10, 10, 20, 20, 20, 20].map((c, i) => wk(i, c, i < 4 ? 5 : 3));
  const r = composeReport(emptyInput({ weeks, hasSearch: true, hasProfile: true, reviewCount: 12, rating: 4.8, reviewsNew28: 2, reviewsNew7: 1 }), "the week to 23 Nov");
  assert.deepEqual(r.sections.map((s) => s.key), ["leads", "reviews", "search"]);
  assert.ok(r.sections[0].lines[0].includes("12 calls from your Google profile, down from 20"));
  assert.ok(r.sections[2].lines[0].includes("80 clicks, up from 40"));
  assert.equal(r.sections[1].headline, "12 reviews, 4.8 stars");
});

test("the client email is plain, lists what was done and what's next, and links to the page", () => {
  const r = composeReport(emptyInput({ textBacks: 3, done: [{ kind: "review_reply" }, { kind: "review_reply" }, { kind: "title_rewrite", page: "/patios" }, { kind: "internal_only" }], next: [{ kind: "new_page", page: "/driveways-sheffield" }, { kind: "site_drop" }] }), "the week to 23 Nov");
  assert.deepEqual(r.done, ["Replied to a Google review (2 times)", "Rewrote how your patios page appears on Google, so more people click it"]);
  assert.deepEqual(r.next, ["A new page: driveways sheffield"]);
  const mail = weeklyEmail(r, "https://app.test/progress/abc");
  assert.ok(mail.body.startsWith("Hi John,") && mail.body.includes("https://app.test/progress/abc") && mail.body.includes("What we did this week"));
  assert.ok(!/dashboard|—/.test(mail.body));
});
