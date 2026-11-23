import "server-only";
import { db } from "@/lib/supabase";
import type { ActionType, Finding, GoogleUpdate, Plan, SeoAction, SeoConfig, WeeklyReview } from "./types";
import { claude, claudeJson, MODELS } from "./ai";
import { factSheet } from "./drafts";
import type { RawLocation } from "./gbp";
import { kvGet, kvSet, mondayOf, todayLondon } from "./store";
import { tradeKey, valueOf } from "./value";

const DAY = 86_400_000;

// ---------- Google ranking updates ----------

/** Confirmed ranking updates from Google's Search Status Dashboard, cached for a day. */
export async function googleUpdates(): Promise<GoogleUpdate[]> {
  const cached = await kvGet<{ at: string; items: GoogleUpdate[] }>("google_updates");
  if (cached && Date.now() - Date.parse(cached.at) < DAY) return cached.items;
  try {
    const res = await fetch("https://status.search.google.com/incidents.json", { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return cached?.items ?? [];
    const j = (await res.json()) as { begin?: string; external_desc?: string; service_name?: string }[];
    const items = j.filter((i) => i.begin && /ranking|core update|spam update/i.test(`${i.service_name} ${i.external_desc}`)).map((i) => ({ date: i.begin!.slice(0, 10), name: (i.external_desc ?? "Ranking update").replace(/\s+/g, " ").slice(0, 80) })).filter((i) => Date.now() - Date.parse(i.date) < 500 * DAY).sort((a, b) => a.date.localeCompare(b.date));
    await kvSet("google_updates", { at: new Date().toISOString(), items });
    return items;
  } catch {
    return cached?.items ?? [];
  }
}

export const updatesBetween = (updates: GoogleUpdate[], from: string, to: string) => updates.filter((u) => u.date >= from && u.date <= to);

// ---------- Playbook ----------

export const DEFAULT_PLAYBOOK = `How ASC does local SEO for trades. The strategist reads this before every plan.

1. Maps first. For a local trade, the map results take most calls. What moves them: the right primary category, real secondary categories, a steady flow of genuine reviews, a complete profile with hours, services and a weekly post, and how close the business is to the searcher (which can't be changed).
2. Reviews are a ranking factor and a sales tool. Pace matters more than the total. Reply to every one.
3. Fix what already ranks before writing anything new: titles that don't earn the click, pages at positions 5 to 15, questions the page doesn't answer.
4. One page per service per town worth winning, each with something real from that town: a job, a photo, a review. A few a week. Never near-identical pages.
5. AI search runs on the same signals plus clarity: content readable without JavaScript, crawlers allowed, direct answers and price tables, matching name, address and phone everywhere, listings on the directories AI tools quote, a presence on Bing.
6. The site has to turn visits into calls: a tap-to-call number at the top on mobile, a clear call to action, reviews on the page, fast loading.
7. Nothing against Google's rules. No fake hours, no keywords stuffed in the business name, no fake reviews, no doorway pages. A suspended profile costs more than any shortcut gains.
8. Measure every change after 28 days against the rest of the site. Keep what works, revert what doesn't, and reuse wins across clients in the same trade.
9. When the whole site drops at once, check for a Google update or the season before touching pages.`;

export const getPlaybook = async () => (await kvGet<{ text: string; updatedAt?: string }>("playbook")) ?? { text: DEFAULT_PLAYBOOK };

/** Every quarter: what changed in local SEO and AI search, as proposed playbook edits for Ayush to approve. */
export async function researchPlaybook(): Promise<string | null> {
  const quarter = `${new Date().getUTCFullYear()}-Q${Math.floor(new Date().getUTCMonth() / 3) + 1}`;
  if ((await kvGet<{ quarter: string }>("playbook_proposal"))?.quarter === quarter) return null;
  const pb = await getPlaybook();
  const a = await claude({ clientId: null, purpose: "playbook-research", model: MODELS.write(), maxTokens: 1500, webSearch: 5, system: "You are a senior local SEO consultant keeping an agency playbook current. Search for what has changed in the last three months in local SEO, Google Business Profile and AI search (ChatGPT, Gemini, AI Overviews) that matters for small trades businesses. Ignore rumours and vendor hype; prefer Google's own announcements and well-evidenced studies. No em dashes.", user: `Current playbook:\n${pb.text}\n\nList up to 5 changes worth making to the playbook. For each: what changed in the world, the evidence, and the exact line to add or replace. Plain text, numbered.` });
  await kvSet("playbook_proposal", { quarter, text: a.text, sources: a.sources, at: new Date().toISOString() });
  return a.text;
}

// ---------- 90-day plan and weekly review ----------

export type StrategyContext = { cfg: SeoConfig; weeklyClicks: number[]; weeklyCalls: number[]; open: Pick<SeoAction, "type" | "summary" | "score">[]; measured: { summary: string; verdict: string }[]; competitors: string; aiNamed: string; siteDrop?: string; updates: GoogleUpdate[] };

const TYPES: ActionType[] = ["Profile", "Reviews", "Technical", "Page", "AI search", "Content", "Manual"];

export async function writePlan(clientId: string, ctx: StrategyContext): Promise<Plan | null> {
  const pb = await getPlaybook();
  const j = await claudeJson<Plan>({
    clientId,
    purpose: "plan-90",
    model: MODELS.think(),
    maxTokens: 1800,
    system: `You are a senior local SEO strategist writing a 90-day plan for one trades business. Be specific to this business's numbers. Only state facts from FACTS and DATA. Plain English a busy agency owner reads in a minute.\n\nPLAYBOOK\n${pb.text}`,
    user: `FACTS\n${factSheet(ctx.cfg)}\n\nDATA\nClicks from Google per week, oldest first: ${ctx.weeklyClicks.join(", ") || "no data yet"}\nCalls from the Business Profile per week: ${ctx.weeklyCalls.join(", ") || "no data yet"}\nMap results: ${ctx.competitors || "not checked yet"}\nAI answers: ${ctx.aiNamed || "not checked yet"}\nOpen opportunities, biggest first:\n${ctx.open.slice(0, 15).map((o) => `- [${o.type}] ${o.summary}`).join("\n") || "- none yet"}\nPast changes and how they did:\n${ctx.measured.slice(0, 12).map((m) => `- ${m.summary}: ${m.verdict}`).join("\n") || "- none measured yet"}\n\nWrite the plan: 2 to 4 goals for the next 90 days, each with why it matters for this business, how it's measured, and which kinds of work serve it (from: ${TYPES.join(", ")}). Then 3 priorities in order, and 1 to 3 things to stop doing or not start.\n\n{"summary":"two sentences","goals":[{"goal":"","why":"","measure":"","serves":["Profile"]}],"priorities":[""],"stop":[""]}`,
  });
  if (!j?.goals?.length) return null;
  j.goals = j.goals.slice(0, 4).map((g) => ({ ...g, serves: (g.serves ?? []).filter((t): t is ActionType => TYPES.includes(t as ActionType)) }));
  await db().from("seo_plans").upsert({ client_id: clientId, kind: "plan", period: todayLondon().slice(0, 8) + "01", content: j }, { onConflict: "client_id,kind,period" });
  return j;
}

/** A diagnosis from rules alone, used when AI isn't connected. */
export function ruleReview(ctx: StrategyContext): WeeklyReview {
  const c = ctx.weeklyClicks;
  const last = c.at(-1) ?? 0;
  const usual = c.length > 4 ? c.slice(-5, -1).reduce((n, x) => n + x, 0) / 4 : 0;
  const recent = updatesBetween(ctx.updates, new Date(Date.now() - 21 * DAY).toISOString().slice(0, 10), todayLondon());
  const parts: string[] = [];
  if (!c.length) parts.push("No Search Console data yet, so this week is about the Business Profile, the site basics and getting connected.");
  else if (usual >= 5 && last < usual * 0.7) parts.push(`Clicks fell to ${last} last week against a usual ${usual.toFixed(0)}.${recent.length ? ` Google confirmed a ranking update on ${recent.map((u) => u.date).join(", ")}, so hold steady on page changes and watch another week.` : " No Google update was confirmed in that window, so check the pages that fell."}`);
  else if (usual >= 5 && last > usual * 1.3) parts.push(`Clicks rose to ${last} last week against a usual ${usual.toFixed(0)}. Keep going with what's been applied.`);
  else parts.push(`Clicks are steady at about ${last} a week.`);
  if (ctx.siteDrop) parts.push(ctx.siteDrop);
  const byType = new Map<string, number>();
  for (const o of ctx.open) byType.set(o.type, (byType.get(o.type) ?? 0) + 1);
  return { diagnosis: parts.join(" "), plan: ctx.open.slice(0, 4).map((o) => o.summary) };
}

export async function writeWeeklyReview(clientId: string, ctx: StrategyContext): Promise<WeeklyReview> {
  let review = ruleReview(ctx);
  try {
    const recent = updatesBetween(ctx.updates, new Date(Date.now() - 28 * DAY).toISOString().slice(0, 10), todayLondon());
    const j = await claudeJson<WeeklyReview>({ clientId, purpose: "weekly-review", model: MODELS.quick, maxTokens: 600, system: "You are a senior local SEO strategist. Give one joined-up diagnosis across all the signals, not a list of alerts. If everything fell together around a confirmed Google update, say hold steady. Plain English, 2 to 4 sentences. Then the 3 to 4 things to do this week, most valuable first, each one sentence.", user: `Business: ${ctx.cfg.facts?.businessName} (${ctx.cfg.trade})\nClicks per week, oldest first: ${ctx.weeklyClicks.join(", ") || "none"}\nProfile calls per week: ${ctx.weeklyCalls.join(", ") || "none"}\nConfirmed Google updates in the last 4 weeks: ${recent.map((u) => `${u.date} ${u.name}`).join("; ") || "none"}\n${ctx.siteDrop ? `Note: ${ctx.siteDrop}\n` : ""}Map results: ${ctx.competitors || "not checked"}\nAI answers: ${ctx.aiNamed || "not checked"}\nOpen items:\n${ctx.open.slice(0, 12).map((o) => `- [${o.type}] ${o.summary}`).join("\n")}\n\n{"diagnosis":"","plan":[""]}` });
    if (j?.diagnosis) review = { diagnosis: j.diagnosis, plan: (j.plan ?? []).slice(0, 4) };
  } catch {}
  await db().from("seo_plans").upsert({ client_id: clientId, kind: "weekly", period: mondayOf(new Date()), content: review }, { onConflict: "client_id,kind,period" });
  return review;
}

// ---------- Seasons, weather and holidays ----------

/** When each trade's busy season starts (month 1 to 12). Content and posts are prepared 6 to 8 weeks before. */
const SEASONS: Record<string, { month: number; name: string; angle: string }[]> = {
  driveways: [{ month: 4, name: "spring driveway season", angle: "people plan driveways and patios once the weather turns" }, { month: 9, name: "autumn, before the frost", angle: "the last chance to lay a driveway before winter" }],
  landscaping: [{ month: 3, name: "spring garden season", angle: "gardens and patios get planned for summer" }],
  roofing: [{ month: 10, name: "storm season", angle: "roof checks and repairs before winter storms" }, { month: 3, name: "spring repairs", angle: "fixing what winter damaged" }],
  heating: [{ month: 9, name: "boiler season", angle: "boiler services and replacements before the cold" }],
  plumbing: [{ month: 11, name: "frozen pipe season", angle: "burst and frozen pipes" }],
  hvac: [{ month: 5, name: "cooling season", angle: "air conditioning before the heat" }, { month: 10, name: "heating season", angle: "furnace checks before winter" }],
  fencing: [{ month: 3, name: "spring fencing season", angle: "replacing fences after winter storms" }],
  electrical: [{ month: 10, name: "darker evenings", angle: "outdoor and security lighting" }],
};

function simple(cfg: SeoConfig, kind: string, type: ActionType, dedupe: string, summary: string, why: string, calls: number, extra: Partial<Finding["detail"]> = {}, draft?: Finding["draft"]): Finding {
  const v = valueOf({ calls }, cfg, [{ label: "Timely posts and pages catch seasonal demand", value: "estimate", assumed: true }]);
  return { kind, type, dedupe, summary, detail: { evidence: { why }, gain: { calls, gbp: Math.round(v.gbp) }, chain: v.chain, confidence: "Medium", effort: "1 click", risk: "Low", undoable: true, ...extra }, draft: draft ?? { target: "profile", needsAi: true } };
}

export function seasonalFindings(cfg: SeoConfig, now = new Date()): Finding[] {
  const out: Finding[] = [];
  for (const s of SEASONS[tradeKey(cfg.trade)] ?? []) {
    const year = now.getUTCMonth() + 1 > s.month ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    const start = Date.UTC(year, s.month - 1, 1);
    const weeks = (start - now.getTime()) / (7 * DAY);
    if (weeks > 8 || weeks < 1) continue;
    out.push(simple(cfg, "seasonal_post", "Profile", `seasonal:${year}-${s.month}`, `Get ahead of ${s.name}: publish a Business Profile post now.`, `${s.name[0].toUpperCase()}${s.name.slice(1)} starts in about ${Math.round(weeks)} weeks: ${s.angle}. Posts and pages published 6 to 8 weeks ahead are ranking by the time people search.`, 1));
  }
  return out;
}

async function geocode(cfg: SeoConfig): Promise<{ lat: number; lng: number } | null> {
  if (cfg.lat && cfg.lng) return { lat: cfg.lat, lng: cfg.lng };
  const town = cfg.towns?.[0];
  if (!town) return null;
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(town)}&count=1&country_code=${cfg.country === "US" ? "US" : "GB"}`, { signal: AbortSignal.timeout(8000) });
    const j = (await res.json()) as { results?: { latitude: number; longitude: number }[] };
    return j.results?.[0] ? { lat: j.results[0].latitude, lng: j.results[0].longitude } : null;
  } catch {
    return null;
  }
}

const WEATHER_TRADES: Record<string, string[]> = { storm: ["roofing", "fencing", "building", "landscaping"], rain: ["roofing", "plumbing", "driveways"], snow: ["heating", "plumbing", "roofing"], heat: ["hvac"] };

/** Storms, heavy rain, snow and heatwaves in the next 4 days, from Open-Meteo (free, no key). Always needs approval. */
export async function weatherFindings(cfg: SeoConfig): Promise<{ findings: Finding[]; alert?: string; at?: { lat: number; lng: number } }> {
  const at = await geocode(cfg);
  if (!at) return { findings: [] };
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lng}&daily=wind_gusts_10m_max,precipitation_sum,snowfall_sum,temperature_2m_max&forecast_days=4&timezone=auto`, { signal: AbortSignal.timeout(8000) });
    const d = ((await res.json()) as { daily?: { time: string[]; wind_gusts_10m_max: number[]; precipitation_sum: number[]; snowfall_sum: number[]; temperature_2m_max: number[] } }).daily;
    if (!d) return { findings: [], at };
    const hot = cfg.country === "US" ? 38 : 30;
    let event: { key: string; day: string; text: string } | null = null;
    d.time.forEach((day, i) => {
      if (event) return;
      if (d.wind_gusts_10m_max[i] >= 80) event = { key: "storm", day, text: `gusts of ${Math.round(d.wind_gusts_10m_max[i])} km/h` };
      else if (d.snowfall_sum[i] >= 5) event = { key: "snow", day, text: `${Math.round(d.snowfall_sum[i])} cm of snow` };
      else if (d.precipitation_sum[i] >= 25) event = { key: "rain", day, text: `${Math.round(d.precipitation_sum[i])} mm of rain` };
      else if (d.temperature_2m_max[i] >= hot) event = { key: "heat", day, text: `${Math.round(d.temperature_2m_max[i])}°C` };
    });
    const e = event as { key: string; day: string; text: string } | null;
    if (!e || !WEATHER_TRADES[e.key].includes(tradeKey(cfg.trade))) return { findings: [], at, alert: e ? `${e.key} on ${e.day}` : undefined };
    const town = cfg.towns?.[0] ?? "the area";
    const label = { storm: "Storm", snow: "Snow", rain: "Heavy rain", heat: "A heatwave" }[e.key];
    return { at, alert: `${e.key} on ${e.day}`, findings: [simple(cfg, "weather_post", "Profile", `weather:${e.key}-${e.day}`, `${label} is forecast for ${town} on ${new Date(e.day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}: post before the calls start.`, `The forecast for ${town} shows ${e.text} on ${e.day}. People search for ${cfg.trade ?? "help"} during and straight after. A post now puts the business in front of them first. Helpful, not alarmist.`, 2, { confidence: "Medium" })] };
  } catch {
    return { findings: [], at };
  }
}

type Holiday = { date: string; name: string };

async function holidays(country: "GB" | "US"): Promise<Holiday[]> {
  const key = `holidays:${country}:${new Date().getUTCFullYear()}`;
  const cached = await kvGet<Holiday[]>(key);
  if (cached) return cached;
  try {
    let items: Holiday[];
    if (country === "GB") {
      const j = (await (await fetch("https://www.gov.uk/bank-holidays.json", { signal: AbortSignal.timeout(8000) })).json()) as { "england-and-wales": { events: { title: string; date: string }[] } };
      items = j["england-and-wales"].events.map((e) => ({ date: e.date, name: e.title }));
    } else {
      const y = new Date().getUTCFullYear();
      const j = (await (await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/US`, { signal: AbortSignal.timeout(8000) })).json()) as { date: string; localName: string; global: boolean }[];
      items = j.filter((h) => h.global).map((h) => ({ date: h.date, name: h.localName }));
    }
    await kvSet(key, items);
    return items;
  } catch {
    return [];
  }
}

/** Special hours for the next public holiday. Approve sets the profile to closed that day; dismiss if they're working. */
export async function holidayFindings(cfg: SeoConfig, raw?: RawLocation): Promise<Finding[]> {
  if (!cfg.gbpLocation || !raw) return [];
  const today = todayLondon();
  const soon = new Date(Date.now() + 12 * DAY).toISOString().slice(0, 10);
  const next = (await holidays(cfg.country === "US" ? "US" : "GB")).find((h) => h.date > today && h.date <= soon);
  if (!next) return [];
  type Period = { startDate?: { year: number; month: number; day: number } };
  const existing = ((raw.specialHours?.specialHourPeriods ?? []) as Period[]);
  const [year, month, day] = next.date.split("-").map(Number);
  if (existing.some((p) => p.startDate?.year === year && p.startDate?.month === month && p.startDate?.day === day)) return [];
  const body = { specialHourPeriods: [...existing, { startDate: { year, month, day }, closed: true }] };
  const nice = new Date(next.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return [simple(cfg, "holiday_hours", "Profile", `holiday:${next.date}`, `Set the Business Profile to closed for ${next.name} (${nice}).`, `${next.name} is on ${nice}. Google shows "hours might differ" on profiles with no holiday hours, which puts callers off. Approve to mark the profile closed that day. If they're working, dismiss this and the normal hours stand.`, 0.5, { confidence: "High" }, { target: "profile", fields: [{ name: "specialHours", label: "Holiday hours", before: "Not set", after: `Closed on ${nice}` }], note: JSON.stringify(body) })];
}

// ---------- What has worked, by trade ----------

export type TrackRecord = Record<string, { worked: number; total: number }>;

/** How often each kind of change has worked, across every client (and within one trade). */
export async function trackRecord(trade?: string): Promise<TrackRecord> {
  const { data } = await db().from("seo_actions").select("kind, client_id, result").not("result", "is", null).limit(2000).returns<{ kind: string; client_id: string; result: { verdict: string } }[]>();
  let rows = data ?? [];
  if (trade) {
    const { data: s } = await db().from("seo_settings").select("client_id, config").returns<{ client_id: string; config: SeoConfig }[]>();
    const same = new Set((s ?? []).filter((x) => tradeKey(x.config.trade) === tradeKey(trade)).map((x) => x.client_id));
    rows = rows.filter((r) => same.has(r.client_id));
  }
  const out: TrackRecord = {};
  for (const r of rows) {
    if (r.result.verdict === "too early") continue;
    out[r.kind] ??= { worked: 0, total: 0 };
    out[r.kind].total++;
    if (r.result.verdict === "worked") out[r.kind].worked++;
  }
  return out;
}

