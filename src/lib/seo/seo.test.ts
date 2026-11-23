// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectSearch, isPrice, isQuestion, NOISE, type DetectInput } from "./detect";
import { blockedByRobots, detectOnSite, parseHtml, type SiteAudit } from "./onsite";
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
  const own = valueOf({ clicks: 100 }, { ...cfg, jobValueGbp: 1000, enquiryRate: 0.1 });
  assert.equal(Math.round(own.gbp), 10_000);
  assert.ok(own.chain.every((c) => !c.assumed));
  const guess = valueOf({ clicks: 100 }, cfg);
  assert.equal(Math.round(guess.gbp), 100 * 0.05 * 4500);
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
