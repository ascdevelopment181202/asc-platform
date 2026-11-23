// A sample client so every screen can be shown before real data builds up.
// It lives only in memory: nothing here is written to the database or counted in any real figure.
import "server-only";
import { seoEnv } from "@/lib/env";
import type { ActionType, AiCheck, Confidence, Draft, Effort, Evidence, Measured, SeoAction, SeoChange, SeoConfig, SeoSettings, WeekPoint } from "./types";
import { citationCopy, directoriesFor } from "./citations";
import { connectionsFor } from "./connections";
import { DEFAULT_PLAYBOOK } from "./strategist";
import { mondayOf } from "./store";
import { scoreOf, valueOf } from "./value";
import type { ClientView } from "./view";

export const DEMO_ID = "demo";
export const DEMO_NAME = "Hartley Paving (demo, sample data)";
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

const cfg: SeoConfig = {
  domain: "hartleypaving.example",
  siteType: "vercel",
  githubRepo: "ascdevelopment181202/hartley-paving",
  gscProperty: "sc-domain:hartleypaving.example",
  gbpLocation: "locations/demo",
  trade: "driveways",
  country: "GB",
  services: ["Block paving", "Resin driveways", "Tarmac driveways", "Patios"],
  towns: ["Watford", "Bushey", "Rickmansworth", "St Albans", "Hemel Hempstead"],
  brandTerms: ["hartley paving", "hartley"],
  facts: { businessName: "Hartley Paving", phone: "01923 555 014", email: "hello@hartleypaving.example", address: "Unit 4, Greycaine Road, Watford WD24", yearsTrading: "Trading since 2009", accreditations: ["Checkatrade member", "Marshalls Registered Installer"], guarantees: "10-year guarantee on all driveways", priceRanges: "Block paving from £95 per m², resin from £70 per m²", confirmed: true },
  profiles: { facebook: "https://facebook.com/hartleypaving", checkatrade: "https://checkatrade.com/trades/hartleypaving" },
  autoApply: { titles: false, schema: true, faq: false, posts: true },
  aiBudgetGbp: 3,
  jobValueGbp: 5200,
  enquiryRate: 0.06,
};

const settings: SeoSettings = {
  client_id: DEMO_ID,
  enabled: true,
  paused: false,
  config: cfg,
  state: {
    health: { checkedAt: iso(0), up: true, status: 200, tlsDaysLeft: 61, domainDaysLeft: 214 },
    baseline: { at: iso(92), clicks: 212, impressions: 9800, calls: 21, reviews: 31, rating: 4.7, aiNamed: 0, aiAsked: 6 },
    gsc: { ok: true, at: iso(0) },
    gbp: { ok: true, write: true, at: iso(1), profile: { title: "Hartley Paving", primaryCategory: "Paving contractor", categories: ["Driveway contractor"], description: "Family-run paving firm in Watford.", hasHours: true, services: 6, website: "https://hartleypaving.example", phone: "01923 555 014", serviceAreas: ["Watford", "Bushey", "Rickmansworth"], lastPostAt: iso(9) } },
    crawl: { at: iso(1), pages: 14, tracking: true },
    speed: { at: iso(1), mobile: 71, lcp: 2.9 },
    brand: { brandClicks: 96, otherClicks: 318 },
    lastRunAt: iso(0),
  },
  tracking_token: "demo",
  last_run_on: day(0),
  last_weekly_on: day(1),
  last_monthly_on: day(12),
  setup_done_at: iso(92),
};

function weeks(): WeekPoint[] {
  const clicks = [48, 51, 47, 55, 58, 54, 61, 66, 63, 71, 78, 74, 83, 91, 88, 97];
  const calls = [5, 4, 6, 5, 6, 7, 6, 8, 7, 9, 8, 10, 9, 11, 12, 11];
  const start = Date.parse(`${mondayOf(new Date())}T12:00:00Z`);
  return clicks.map((c, i) => ({ week: new Date(start - (15 - i) * 7 * DAY).toISOString().slice(0, 10), clicks: c, impressions: c * 41 + i * 30, position: Math.round((14.2 - i * 0.28) * 10) / 10, calls: calls[i], directions: Math.round(calls[i] * 0.6), websiteClicks: calls[i] * 3 }));
}
const series = (label: string, values: number[]) => {
  const w = weeks();
  return { label, points: values.map((value, i) => ({ week: w[i].week, value })) };
};

let n = 0;
function act(kind: string, type: ActionType, summary: string, evidence: Evidence, gain: { clicks?: number; calls?: number }, o: { confidence?: Confidence; effort?: Effort; draft?: Draft; lead?: { label: string; value: string }[]; alert?: boolean; autoOk?: boolean; status?: SeoAction["status"]; apply?: SeoAction["apply"]; result?: Measured; appliedDaysAgo?: number; goal?: string; risk?: "Low" | "Medium" | "High"; created?: number; links?: { label: string; url: string }[] } = {}): SeoAction {
  const v = valueOf(gain, cfg, o.lead?.map((l) => ({ ...l, assumed: true })));
  const detail = { evidence, gain: { ...gain, gbp: Math.round(v.gbp) }, chain: gain.clicks || gain.calls ? v.chain : [{ label: "Protects", value: "the traffic and rankings the site already has" }], confidence: o.confidence ?? "Medium", effort: o.effort ?? "1 click", risk: o.risk ?? "Low", undoable: true, autoOk: o.autoOk, alert: o.alert, links: o.links ?? [{ label: "Live page", url: `https://${cfg.domain}${evidence.page ?? ""}` }, { label: "Search Console", url: "https://search.google.com/search-console" }] } as SeoAction["detail"];
  n++;
  return { id: `demo-${n}`, client_id: DEMO_ID, kind, type, status: o.status ?? "new", dedupe_key: `${kind}:${n}`, score: scoreOf(type, detail), summary, detail, draft: o.draft ?? null, apply: o.apply ?? null, undo: null, result: o.result ?? null, goal: o.goal ?? GOALS[type], dismissed_reason: null, snoozed_until: null, applied_at: o.appliedDaysAgo !== undefined ? iso(o.appliedDaysAgo) : null, measure_at: o.appliedDaysAgo !== undefined ? iso(o.appliedDaysAgo - 28) : null, created_at: iso(o.created ?? 1), updated_at: iso(o.created ?? 1) };
}

const GOALS: Record<ActionType, string> = { Profile: "Top 3 on Maps for block paving and driveways in Watford, Bushey and Rickmansworth", Reviews: "Top 3 on Maps for block paving and driveways in Watford, Bushey and Rickmansworth", Page: "Double clicks from searches the site already shows for", Technical: "Double clicks from searches the site already shows for", "AI search": "Be named by AI answers for driveways in Watford", Content: "A page for each core service in each of the 5 towns", Manual: "A page for each core service in each of the 5 towns" };

export function demoActions(): SeoAction[] {
  n = 0;
  return [
    act("title_rewrite", "Page", "Rewrite the block paving Watford page title and description so more searchers click it.", { why: "1,240 impressions in the 28 days to last Thursday at position 4.1, but a 0.8% click rate where pages at that position usually get about 7%.", numbers: [{ label: "Impressions", value: "1,240" }, { label: "Position", value: "4.1" }, { label: "Click rate", value: "0.8% (typical 7%)" }], page: "/block-paving-watford", series: series("Clicks to /block-paving-watford", [3, 2, 3, 2, 4, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2]) }, { clicks: 27 }, { confidence: "High", autoOk: true, lead: [{ label: "Better title and description", value: "click rate 0.8% → 3%" }], draft: { target: "site", page: "/block-paving-watford", fields: [{ name: "title", label: "Title", before: "Block Paving | Hartley Paving", after: "Block Paving Watford: Driveways from £95 per m² | Hartley Paving" }, { name: "description", label: "Description", before: "We do block paving.", after: "Block paving driveways in Watford with a 10-year guarantee. Marshalls Registered Installer, trading since 2009. Free quote: call 01923 555 014." }] }, apply: { mode: "pr", prNumber: 41, prUrl: "https://github.com", previewUrl: "https://vercel.com", build: "ok", visual: { ok: true, note: "Only the edited part changed. Phone number and call to action still visible on mobile and desktop." } } }),
    act("gbp_categories", "Profile", "Add secondary categories to the Business Profile.", { why: "The profile lists Paving contractor and 1 other. Categories decide which searches the profile can show for. Competitors in the top results use: Driveway contractor, Landscaper, Patio builder, Asphalt contractor. Only add ones that are true for this business.", competitor: "Top competitors' categories: Driveway contractor, Landscaper, Patio builder, Asphalt contractor" }, { calls: 3.4 }, { effort: "5 min manual", lead: [{ label: "Showing for more searches", value: "about 8% more calls" }], draft: { target: "manual", minutes: 5, steps: [{ text: "Open the Business Profile.", url: "https://business.google.com/locations" }, { text: "Edit profile, then Business category." }, { text: "Add each category that truly applies:", copy: "Landscaper\nPatio builder\nAsphalt contractor" }, { text: "Save, then press Mark done. The autopilot re-checks the profile on its next run." }] }, links: [{ label: "Business Profile", url: "https://business.google.com" }] }),
    act("review_reply", "Reviews", "Reply to Priya S's 5-star Google review.", { why: "Replying to reviews shows customers and Google the business is active. Review: \"Dan and the team relaid our whole driveway in Bushey in block paving. Tidy, on time and it looks fantastic.\"" }, { calls: 0.2 }, { confidence: "High", draft: { target: "review", fields: [{ name: "reply", label: "Reply", before: "", after: "Thanks Priya, really glad you're pleased with the new block paving. It was a pleasure working on your driveway in Bushey. Dan" }] }, links: [{ label: "Business Profile", url: "https://business.google.com" }] }),
    act("answer_block", "AI search", "Answer 3 questions people search at the top of the resin driveways page.", { why: "These long, question-style searches showed this page 410 times in the 28 days to last Thursday but the page doesn't answer them directly. They're the same questions people ask ChatGPT and Google's AI answers.", numbers: [{ label: "how long does a resin driveway last in the uk", value: "190 impressions, 2 clicks" }, { label: "can you lay resin over existing tarmac driveway", value: "140 impressions, 1 click" }, { label: "is a resin driveway cheaper than block paving", value: "80 impressions, 0 clicks" }], page: "/resin-driveways", queries: ["how long does a resin driveway last in the uk", "can you lay resin over existing tarmac driveway", "is a resin driveway cheaper than block paving"], series: series("Clicks to /resin-driveways", [6, 7, 6, 8, 7, 8, 9, 8, 9, 10, 9, 11, 10, 11, 12, 11]) }, { clicks: 12 }, { autoOk: true, lead: [{ label: "A direct answer on the page", value: "about 3 more clicks per 100 impressions" }], draft: { target: "site", page: "/resin-driveways", html: "<section>\n<h2>Quick answers about resin driveways</h2>\n<h3>How long does a resin driveway last?</h3>\n<p>Every driveway we lay carries our 10-year guarantee. [ADD: typical lifespan you quote customers]</p>\n<h3>Can resin go over an existing tarmac driveway?</h3>\n<p>Often, yes, if the tarmac is sound and drains properly. We check the base at the free survey and tell you straight if it needs replacing first.</p>\n<h3>Is resin cheaper than block paving?</h3>\n<p>Resin starts from £70 per m² and block paving from £95 per m², so resin is usually the cheaper of the two.</p>\n</section>", note: "Missing facts to add: typical lifespan quoted to customers." }, apply: { mode: "pr", prNumber: 42, prUrl: "https://github.com", previewUrl: "https://vercel.com", build: "ok", visual: { ok: false, note: "Mobile: 4 existing elements changed size, so the layout shifted. Open the preview and look before approving." } } }),
    act("new_page", "Content", "Create a Block paving in St Albans page: there isn't one.", { why: "Searches for block paving in St Albans were shown 380 times in the 28 days to last Thursday with 2 clicks, and no page on the site is about that service in that town.", numbers: [{ label: "block paving st albans", value: "210 impressions, position 18.2" }, { label: "driveway block paving st albans", value: "170 impressions, position 21" }], queries: ["block paving st albans"] }, { clicks: 36 }, { lead: [{ label: "A dedicated page reaching the top 3", value: "about 10% of 380 impressions" }], draft: { target: "site", page: "/block-paving-st-albans", needsAi: true } }),
    act("gbp_post", "Profile", "Publish this week's Business Profile post.", { why: "The last post was 9 days ago. A weekly post shows Google and customers the business is active." }, { calls: 0.8 }, { autoOk: true, lead: [{ label: "An active profile", value: "about 2% more calls" }], draft: { target: "profile", fields: [{ name: "post", label: "Post", before: "", after: "Frost is on the way, and it finds every loose block and cracked edge on a driveway. If yours has started to sink or spread, it's far cheaper to lift and relay a section now than to replace the lot in spring. We're booking free surveys across Watford, Bushey and Rickmansworth this month. Every driveway we lay carries a 10-year guarantee. Give us a call for a straight answer on what yours needs." }] }, links: [{ label: "Business Profile", url: "https://business.google.com" }] }),
    act("map_rank", "Profile", "Maps: position 6 for \"Block paving Watford\". The top 3 get most of the calls.", { why: `Checked on ${day(1)}. Ahead: Elite Driveways Watford (142 reviews, 4.9 stars, Driveway contractor); Herts Paving Co (88 reviews, 4.8 stars, Paving contractor); Prestige Drives (61 reviews, 4.6 stars, Landscaper). The levers are categories, reviews, a complete profile and how close the business is to the searcher.`, query: "Block paving Watford", competitor: "Elite Driveways Watford: 142 reviews, 4.9 stars · Herts Paving Co: 88 reviews, 4.8 stars · Prestige Drives: 61 reviews, 4.6 stars" }, { calls: 12.6 }, { confidence: "Low", effort: "5 min manual", lead: [{ label: "Top 3 on Maps takes most of the calls", value: "about 30% more calls" }], draft: { target: "manual", minutes: 10, steps: [{ text: "Add the secondary categories the top three use and that are true here (its own item, above)." }, { text: "Hold the review pace at 3 a week: the leader has 142 against 43." }, { text: "Publish the block paving in Watford page fixes so the profile's landing page matches the search." }, { text: "Press Mark done once these are in hand." }] }, links: [{ label: "See the map results", url: "https://www.google.com/maps/search/block+paving+watford" }] }),
    act("launch_check", "Technical", "Bring the site up to the launch standard: 3 fixes in one change.", { why: "The site is missing 3 basics every site should launch with. They're bundled into one change so there's one thing to review.", numbers: [{ label: "Add an llms.txt file: a plain summary of the business for AI tools.", value: "/llms.txt" }, { label: "List the sitemap in robots.txt.", value: "/robots.txt" }, { label: "Add the IndexNow key file so Bing hears about new pages within hours.", value: "/key.txt" }] }, { clicks: 5 }, { confidence: "High", lead: [{ label: "The basics every new site needs", value: "estimate" }], draft: { target: "site", page: "/", files: [{ path: "llms.txt", content: "# Hartley Paving\n\n> Hartley Paving provides block paving, resin driveways, tarmac driveways, patios in Watford, Bushey, Rickmansworth, St Albans, Hemel Hempstead.\n\n## Key facts\n\n- Phone: 01923 555 014\n- Trading: Trading since 2009\n- Guarantee: 10-year guarantee on all driveways" }, { path: "robots.txt", content: "User-agent: *\nAllow: /\n\nSitemap: https://hartleypaving.example/sitemap.xml" }] } }),
    act("weather_post", "Profile", "Heavy rain is forecast for Watford on Thursday: post before the calls start.", { why: "The forecast for Watford shows 31 mm of rain on Thursday. People search for driveways help during and straight after: standing water shows up every drainage problem. A post now puts the business in front of them first. Helpful, not alarmist." }, { calls: 2 }, { lead: [{ label: "Timely posts catch demand", value: "estimate" }], draft: { target: "profile", fields: [{ name: "post", label: "Post", before: "", after: "Heavy rain due in Watford on Thursday. If water pools on your driveway or runs towards the house, that's a drainage problem, and it's fixable. We fit channel drains and relay sunken sections across Watford and Bushey, all with a 10-year guarantee. Take a photo of where the water sits and give us a call for a free survey." }] }, links: [{ label: "Business Profile", url: "https://business.google.com" }] }),
    act("cost_guide", "Content", "Publish a cost guide: 7 price searches a month have no clear answer on the site.", { why: "Price searches were shown 520 times in the 28 days to last Thursday. People asking about cost are close to buying, and AI answers quote pages with clear price tables.", numbers: [{ label: "block paving cost per m2", value: "230 impressions" }, { label: "how much is a resin driveway", value: "160 impressions" }, { label: "new driveway cost watford", value: "130 impressions" }], queries: ["block paving cost per m2", "how much is a resin driveway", "new driveway cost watford"] }, { clicks: 21 }, { lead: [{ label: "A page that answers the price question", value: "about 4 more clicks per 100 impressions" }], draft: { target: "site", page: "/driveway-costs", needsAi: true } }),
    act("ai_visibility", "AI search", "AI answers named the business in 1 of 6 checks: get listed where they look.", { why: `Asked gemini, chatgpt 6 questions a customer would ask, on ${day(1)}. The business was named in 1. The answers leaned on: checkatrade.com (5), yell.com (4), trustatrader.com (3), reddit.com (2). AI tools recommend businesses they can confirm from several sources.`, numbers: [{ label: "gemini: Who are the best block paving companies in Watford UK?", value: "Not named" }, { label: "chatgpt: Who are the best block paving companies in Watford UK?", value: "Named" }, { label: "gemini: Can you recommend someone for resin driveways in Watford UK?", value: "Not named" }] }, { clicks: 21 }, { confidence: "Low", effort: "30 min manual", lead: [{ label: "Being named in AI answers", value: "about 5% more visitors" }], draft: { target: "manual", minutes: 30, steps: [{ text: "Check the business is listed, with matching name, address and phone, on yell.com.", url: "https://yell.com" }, { text: "Check the listing on trustatrader.com.", url: "https://trustatrader.com" }, { text: "Work through the Citations tab so the same details appear everywhere AI tools look." }, { text: "Press Mark done. The check runs again next week." }] }, links: [] }),
    act("link_outreach", "Manual", "Ask Marshalls for a link from their installer finder.", { why: "Hartley is a Marshalls Registered Installer, and Marshalls lists registered installers with a link to their website. The listing exists but has no website link." }, { clicks: 3 }, { confidence: "Low", effort: "5 min manual", lead: [{ label: "One good local link lifts the whole site a little", value: "about 3 clicks a month" }], draft: { target: "manual", minutes: 5, steps: [{ text: "Open the page and find the contact email or form.", url: "https://www.marshalls.co.uk" }, { text: "Send this (edit to taste):", copy: "Hi, we're a Marshalls Registered Installer (Hartley Paving, Watford). Our listing on the installer finder doesn't link to our website. Could you add https://hartleypaving.example? Many thanks, Dan" }, { text: "Press Mark done once it's sent." }] }, links: [{ label: "The page", url: "https://www.marshalls.co.uk" }] }),
    // Already done, with results, so the Changes tab and track record have something to show.
    act("title_rewrite", "Page", "Rewrite the home page title and description so more searchers click it.", { why: "980 impressions at position 5.2 with a 1.1% click rate.", page: "/" }, { clicks: 18 }, { status: "applied", appliedDaysAgo: 41, created: 44, result: { at: iso(10), verdict: "worked", before: 11, after: 29, control: 6, text: "This page: 11 clicks in the 28 days before, 29 in the 28 days after. The rest of the site moved +6% over the same days, which is the control." } }),
    act("gbp_description", "Profile", "Rewrite the Business Profile description: it's too short to say what the business does and where.", { why: "The description was 38 characters." }, { calls: 0.6 }, { status: "applied", appliedDaysAgo: 55, created: 57, result: { at: iso(24), verdict: "worked", before: 24, after: 33, text: "Calls from the profile: 24 in the 4 weeks before, 33 in the 4 weeks after. No control is available for profile changes, so read this with the season in mind." } }),
    act("answer_block", "AI search", "Answer 2 questions people search at the top of the patios page.", { why: "Question searches showed the page 150 times.", page: "/patios" }, { clicks: 4 }, { status: "applied", appliedDaysAgo: 38, created: 40, result: { at: iso(7), verdict: "no change", before: 9, after: 10, control: 6, text: "This page: 9 clicks in the 28 days before, 10 in the 28 days after. The rest of the site moved +6% over the same days, which is the control." } }),
    act("schema_local", "Technical", "Add business schema to the home page so Google and AI tools read the name, phone, services and areas.", { why: "The home page had no LocalBusiness structured data.", page: "/" }, { clicks: 3 }, { status: "applied", appliedDaysAgo: 12, created: 13 }),
  ];
}

function demoChanges(actions: SeoAction[]): SeoChange[] {
  return actions.filter((a) => a.status === "applied").map((a, i) => ({ id: `demo-change-${i}`, client_id: DEMO_ID, action_id: a.id, target: a.type === "Profile" ? "profile" : "site", summary: a.summary, before: a.kind === "title_rewrite" ? { Title: "Hartley Paving | Home" } : a.kind === "gbp_description" ? { Description: "Family-run paving firm in Watford." } : null, after: a.kind === "title_rewrite" ? { Title: "Driveways and Block Paving in Watford | Hartley Paving" } : a.kind === "gbp_description" ? { Description: "Hartley Paving lays block paving, resin and tarmac driveways and patios across Watford, Bushey, Rickmansworth, St Albans and Hemel Hempstead. Trading since 2009, Marshalls Registered Installer, with a 10-year guarantee on every driveway." } : { how: "Pull request merged" }, undo: { type: "repo" }, auto: a.kind === "schema_local", undone_at: null, created_at: a.applied_at! }));
}

export function demoView(): ClientView {
  const actions = demoActions();
  const w = weeks();
  const q = (key: string, clicks: number, impressions: number, position: number, prevPosition: number | null, page?: string) => ({ key, clicks, impressions, position, prevClicks: Math.round(clicks * 0.8), prevImpressions: Math.round(impressions * 0.9), prevPosition, page });
  const aiChecks: AiCheck[] = [0, 7, 14].flatMap((d) => ["gemini", "chatgpt"].flatMap((provider) => ["Who are the best block paving companies in Watford UK?", "Can you recommend someone for resin driveways in Watford UK?", "Best rated block paving in Bushey UK?"].map((question, i) => ({ checked_on: day(d + 1), provider, question, named: d === 0 && provider === "chatgpt" && i === 0, sources: [{ url: "https://www.checkatrade.com/Search/Paving/in/Watford", title: "Checkatrade" }, { url: "https://www.yell.com/s/paving-watford.html", title: "Yell" }], excerpt: provider === "chatgpt" && i === 0 && d === 0 ? "Well-reviewed options in Watford include Elite Driveways Watford, Herts Paving Co and Hartley Paving, a Marshalls Registered Installer trading since 2009..." : "For Watford, highly rated options include Elite Driveways Watford and Herts Paving Co, both with strong Checkatrade profiles..." }))));
  const top = [{ placeId: "a", name: "Elite Driveways Watford", rating: 4.9, reviews: 142, category: "Driveway contractor" }, { placeId: "b", name: "Herts Paving Co", rating: 4.8, reviews: 88, category: "Paving contractor" }, { placeId: "c", name: "Prestige Drives", rating: 4.6, reviews: 61, category: "Landscaper" }, { placeId: "d", name: "Watford Block Paving Ltd", rating: 4.7, reviews: 54, category: "Paving contractor" }, { placeId: "e", name: "A1 Surfacing", rating: 4.4, reviews: 39, category: "Asphalt contractor" }, { placeId: "f", name: "Hartley Paving", rating: 4.7, reviews: 43, category: "Paving contractor", isClient: true }];
  const months = [5, 4, 3, 2, 1, 0].map((m) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - m);
    const k = 5 - m;
    return { month: d.toISOString().slice(0, 7), profileCalls: 19 + k * 5, directions: 11 + k * 3, profileWebsite: 60 + k * 14, ascCalls: 14 + k * 3, enquiries: 3 + k, siteCalls: 6 + k * 3, forms: 2 + k, aiVisits: k * 4, searchVisits: 210 + k * 46 };
  });
  const connections = connectionsFor(settings, "Dan", { tracking: true, bing: true, google: true }).map((c) => (["gemini", "openai", "anthropic", "googlekey", "site"].includes(c.key) ? { ...c, state: "ok" as const, detail: "Connected (demo)." } : c));
  return {
    demo: true,
    clientId: DEMO_ID,
    name: DEMO_NAME,
    settings,
    weeks: w,
    queries: { period: "the 28 days to last Thursday", rows: [q("block paving watford", 10, 1240, 4.1, 5.6, "/block-paving-watford"), q("driveways watford", 31, 890, 3.2, 4.8, "/"), q("resin driveways watford", 22, 610, 5.4, 9.1, "/resin-driveways"), q("hartley paving", 96, 240, 1, 1, "/"), q("block paving st albans", 2, 210, 18.2, 22, "/block-paving-watford"), q("patios bushey", 9, 180, 7.7, 11.3, "/patios"), q("tarmac driveway rickmansworth", 6, 160, 8.9, 8.2, "/tarmac-driveways"), q("block paving cost per m2", 3, 230, 12.4, 14, "/block-paving-watford"), q("how long does a resin driveway last in the uk", 2, 190, 9.8, null, "/resin-driveways"), q("driveway company hemel hempstead", 4, 140, 11.6, 15.9, "/")] },
    pageRows: { period: "the 28 days to last Thursday", rows: [{ key: "/", clicks: 168, impressions: 3900, position: 4.4, prevClicks: 131 }, { key: "/block-paving-watford", clicks: 10, impressions: 1240, position: 4.1, prevClicks: 11 }, { key: "/resin-driveways", clicks: 44, impressions: 1420, position: 6.2, prevClicks: 36 }, { key: "/patios", clicks: 31, impressions: 760, position: 7.9, prevClicks: 27 }, { key: "/tarmac-driveways", clicks: 19, impressions: 540, position: 9.3, prevClicks: 21 }] },
    pages: ["/", "/block-paving-watford", "/resin-driveways", "/patios", "/tarmac-driveways", "/about", "/contact", "/gallery"].map((path) => ({ path, title: path === "/" ? "Driveways and Block Paving in Watford | Hartley Paving" : `${path.slice(1).replace(/-/g, " ")} | Hartley Paving`, description: path === "/contact" ? "" : "Hartley Paving, Watford.", words: path === "/gallery" ? 60 : 480, h1: path.slice(1).replace(/-/g, " ") || "Driveways in Watford", status: 200 })),
    actions,
    changes: demoChanges(actions),
    competitors: [{ query: "Block paving Watford", checkedOn: day(1), clientRank: 6, top }, { query: "Resin driveways Watford", checkedOn: day(1), clientRank: 3, top: [top[0], top[2], top[5], top[1]] }, { query: "Block paving Bushey", checkedOn: day(1), clientRank: 4, top: [top[1], top[0], top[3], top[5]] }],
    ranks: [8, 8, 7, 7, 6].map((r, i) => ({ query: "Block paving Watford", checked_on: day(29 - i * 7), client_rank: r })),
    aiChecks,
    directories: directoriesFor(cfg),
    citations: [{ directory: "bing", status: "listed", url: "https://bing.com/maps", checked_at: iso(20) }, { directory: "checkatrade", status: "listed", url: "https://checkatrade.com/trades/hartleypaving", checked_at: iso(60) }, { directory: "facebook", status: "listed", url: "https://facebook.com/hartleypaving", checked_at: iso(60) }],
    copy: citationCopy(cfg),
    plan: { written: true, period: day(12), plan: { summary: "Hartley ranks on the first page for most Watford searches but sits just outside the map top 3, and three nearby towns have no page at all. The next 90 days close the review and category gap on Maps, sharpen the pages already close to the top, and add town pages a few a week.", goals: [{ goal: GOALS.Profile, why: "The map results take most calls for driveways, and the leader has 142 reviews to Hartley's 43.", measure: "Map position for 5 core searches; calls from the profile", serves: ["Profile", "Reviews"] }, { goal: GOALS.Page, why: "Five pages sit at positions 4 to 9 with weak titles: the cheapest clicks available.", measure: "Clicks in Search Console against the baseline of 212 a month", serves: ["Page", "Technical"] }, { goal: GOALS["AI search"], why: "AI answers named Hartley in 1 of 6 checks, and they sit above the normal results.", measure: "Share of AI answers naming the business", serves: ["AI search"] }, { goal: GOALS.Content, why: "St Albans and Hemel Hempstead searches already show the site with no page to land on.", measure: "Town pages live and getting impressions", serves: ["Content", "Manual"] }], priorities: ["Categories and a steady 3 reviews a week", "Titles and answer blocks on pages at positions 4 to 9", "St Albans and Hemel Hempstead pages, with a real job on each"], stop: ["General blog posts: they bring no local searches", "Any page without a real job, photo or review from that town"] } },
    review: { diagnosis: "Clicks are up for the fifth week running (97 last week against 83 a month ago) and profile calls are holding at 11 to 12. No Google update in the window, so the gains are from the title and description changes made in October. The block paving Watford page is the outlier: lots of impressions, almost no clicks.", plan: ["Approve the block paving Watford title rewrite", "Add the three secondary categories on the profile", "Reply to Priya's review", "Approve the St Albans page once a job photo is added"] },
    results: months,
    connections,
    updates: [{ date: day(64), name: "Core update" }, { date: day(23), name: "Spam update" }],
    gbpKeywords: [{ keyword: "driveways watford", impressions: 410 }, { keyword: "block paving", impressions: 380 }, { keyword: "paving contractors near me", impressions: 290 }, { keyword: "resin driveway", impressions: 170 }, { keyword: "hartley paving", impressions: 150 }],
    pace: { ours: 43, last90: 12, leader: { name: "Elite Driveways Watford", reviews: 142, rating: 4.9 }, gap: 99, perWeek: 4, text: "43 reviews against Elite Driveways Watford's 142. 4 new reviews a week draws level in about 6 months. The current pace is 0.9 a week." },
    bing: { clicks: 14, impressions: 620, queries: [{ query: "driveways watford", clicks: 5, impressions: 210, position: 3.1 }, { query: "block paving watford", clicks: 3, impressions: 160, position: 4.4 }] },
    track: { title_rewrite: { worked: 7, total: 9 }, gbp_description: { worked: 3, total: 4 }, answer_block: { worked: 3, total: 6 }, gbp_post: { worked: 2, total: 5 }, new_page: { worked: 4, total: 5 } },
    spend: { spent: 1.42, budget: 3 },
    score: 74,
    rating: 4.7,
    reviewCount: 43,
    reportUrl: `${seoEnv.appUrl()}/progress/demo`,
  };
}

export const demoPlaybook = DEFAULT_PLAYBOOK;
