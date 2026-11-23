import "server-only";
import crypto from "node:crypto";
import { seoEnv } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { signoff } from "@/lib/email";
import type { Finding, SeoConfig, WeekPoint } from "./types";
import { recentAiChecks } from "./aivis";
import { DEMO_ID, demoView } from "./demo";
import type { GbpWeek } from "./gbp";
import { latestCompetitors, rankHistory } from "./places";
import { composeReport, weeklyEmail, type ClientReport, type Pair, type ReportInput, type ReportItem } from "./report-compose";
import { getSettings, saveConfig, shortDate, weeklyMetrics } from "./store";

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
export const weekLabel = () => `the week to ${shortDate(new Date())}`;

/** The private link to a client's progress page. Created the first time it's needed. */
export async function reportUrl(clientId: string): Promise<string> {
  if (clientId === DEMO_ID) return `${seoEnv.appUrl()}/progress/demo`;
  const s = await getSettings(clientId);
  let token = s?.config.reportToken;
  if (!token) {
    token = crypto.randomBytes(12).toString("hex");
    await saveConfig(clientId, { reportToken: token });
  }
  return `${seoEnv.appUrl()}/progress/${token}`;
}

export async function clientForReportToken(token: string): Promise<string | null> {
  if (!/^[0-9a-f]{24}$/.test(token)) return null;
  const { data } = await db().from("seo_settings").select("client_id, config").eq("config->>reportToken", token).limit(1).returns<{ client_id: string; config: SeoConfig }[]>();
  // Checked again here, so a wrong link can never open someone else's page.
  const row = (data ?? []).find((r) => r.config?.reportToken === token);
  return row?.client_id ?? null;
}

async function pair(table: "enquiries", clientId: string): Promise<Pair> {
  const count = async (from: string, to: string) => (await db().from(table).select("id", { count: "exact", head: true }).eq("client_id", clientId).gte("created_at", from).lt("created_at", to)).count ?? 0;
  const [cur, prev] = await Promise.all([count(iso(28), iso(0)), count(iso(56), iso(28))]);
  return { cur, prev };
}

/** Everything the report needs, read from tables that already exist. Nothing is written. */
async function gather(c: Client, cfg: SeoConfig): Promise<ReportInput> {
  const smsCount = async (kind: string) => (await db().from("sms_log").select("id", { count: "exact", head: true }).eq("client_id", c.id).eq("kind", kind).gte("created_at", iso(28))).count ?? 0;
  const [site, gbp, events, enquiries, textBacks, reviewRequests, reviews, competitors, ranks, ai, applied, open] = await Promise.all([
    weeklyMetrics<WeekPoint>(c.id, "site", 12),
    weeklyMetrics<GbpWeek>(c.id, "gbp", 12),
    db().from("seo_events").select("day, kind, count").eq("client_id", c.id).in("kind", ["call", "form"]).gte("day", iso(56).slice(0, 10)).limit(5000).returns<{ day: string; kind: string; count: number }[]>(),
    pair("enquiries", c.id),
    smsCount("missed_call"),
    smsCount("review"),
    db().from("google_reviews").select("created_at").eq("client_id", c.id).gte("created_at", iso(28)).limit(500).returns<{ created_at: string }[]>(),
    latestCompetitors(c.id),
    rankHistory(c.id),
    recentAiChecks(c.id, 24),
    db().from("seo_actions").select("kind, draft, detail").eq("client_id", c.id).in("status", ["applied", "done"]).gte("applied_at", iso(7)).order("applied_at", { ascending: false }).limit(40).returns<{ kind: string; draft: { page?: string } | null; detail: { evidence?: { page?: string; query?: string } } }[]>(),
    db().from("seo_actions").select("kind, draft, detail").eq("client_id", c.id).in("status", ["new", "approved"]).order("score", { ascending: false }).limit(12).returns<{ kind: string; draft: { page?: string } | null; detail: { evidence?: { page?: string; query?: string } } }[]>(),
  ]);
  const byWeek = new Map<string, WeekPoint>();
  for (const w of site) byWeek.set(w.week, { ...w.data, week: w.week });
  for (const w of gbp) byWeek.set(w.week, { ...(byWeek.get(w.week) ?? { week: w.week, clicks: 0, impressions: 0, position: 0 }), calls: w.data.calls, directions: w.data.directions, websiteClicks: w.data.websiteClicks });
  const ev = events.data ?? [];
  const cut = iso(28).slice(0, 10);
  const lastDay = ai[0]?.checked_on;
  const ranksBefore: Record<string, number | null> = {};
  for (const r of ranks) if (!(r.query in ranksBefore)) ranksBefore[r.query] = r.client_rank;
  const item = (a: { kind: string; draft: { page?: string } | null; detail: { evidence?: { page?: string; query?: string } } }): ReportItem => ({ kind: a.kind, page: a.draft?.page ?? a.detail.evidence?.page, query: a.detail.evidence?.query });
  return {
    name: clientLabel(c),
    firstName: c.first_name,
    weeks: [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week)),
    hasSearch: !!cfg.gscProperty && site.length > 0,
    hasProfile: !!cfg.gbpLocation && gbp.length > 0,
    siteLeads: ev.length ? { cur: ev.filter((e) => e.day >= cut).reduce((n, e) => n + e.count, 0), prev: ev.filter((e) => e.day < cut).reduce((n, e) => n + e.count, 0) } : null,
    enquiries,
    textBacks,
    reviewRequests,
    reviewsNew7: (reviews.data ?? []).filter((r) => r.created_at >= iso(7)).length,
    reviewsNew28: (reviews.data ?? []).length,
    reviewCount: c.google_review_count,
    rating: c.google_rating,
    competitors,
    ranksBefore,
    aiChecks: ai.filter((x) => x.checked_on === lastDay),
    done: (applied.data ?? []).map(item),
    next: (open.data ?? []).filter((a) => !["citations", "client_report", "weekly_report", "spam_competitor", "review_pace", "site_drop", "dead_pages", "cannibal"].includes(a.kind)).map(item),
  };
}

export async function buildReport(clientId: string): Promise<ClientReport | null> {
  if (clientId === DEMO_ID) return demoReport();
  const [{ data: c }, s] = await Promise.all([db().from("clients").select("*").eq("id", clientId).maybeSingle<Client>(), getSettings(clientId)]);
  if (!c || !s) return null;
  return composeReport(await gather(c, { ...s.config, country: s.config.country ?? c.country }), weekLabel());
}

/** The sample client's report, so the page and email can be shown before a real client has data. */
function demoReport(): ClientReport {
  const v = demoView();
  const day = v.aiChecks[0]?.checked_on;
  const item = (a: (typeof v.actions)[number]): ReportItem => ({ kind: a.kind, page: a.draft?.page ?? a.detail.evidence.page, query: a.detail.evidence.query });
  return composeReport({ name: "Hartley Paving", firstName: "Dan", weeks: v.weeks, hasSearch: true, hasProfile: true, siteLeads: { cur: 21, prev: 14 }, enquiries: { cur: 7, prev: 5 }, textBacks: 9, reviewRequests: 14, reviewsNew7: 1, reviewsNew28: 4, reviewCount: v.reviewCount, rating: v.rating, competitors: v.competitors, ranksBefore: { "Block paving Watford": 8, "Resin driveways Watford": 5 }, aiChecks: v.aiChecks.filter((c) => c.checked_on === day), done: v.actions.filter((a) => a.status === "applied").slice(0, 3).map(item), next: v.actions.filter((a) => a.status === "new").map(item) }, weekLabel());
}

/**
 * The weekly progress email as an inbox item. It only goes when Ayush presses Send,
 * unless the client is set to send without asking. Skipped when there's nothing worth saying yet.
 */
export async function weeklyReportFinding(c: Client, week: string): Promise<Finding | null> {
  if (!c.email) return null;
  const report = await buildReport(c.id);
  if (!report || report.sections.length + report.done.length < 2) return null;
  const url = await reportUrl(c.id);
  const mail = weeklyEmail(report, url, signoff());
  return {
    kind: "weekly_report",
    type: "Content",
    dedupe: `weekly_report:${week}`,
    summary: `Send ${c.first_name ?? "the client"} this week's progress email.`,
    detail: { evidence: { why: `A short, plain update for ${clientLabel(c)}: ${report.sections.map((s) => s.title.toLowerCase().replace(/ \(.*\)/, "")).join(", ")}${report.done.length ? `, and ${report.done.length} thing${report.done.length === 1 ? "" : "s"} done this week` : ""}. It compares the last 4 weeks with the 4 before, leaves out anything that isn't connected, and links to their private progress page. It never mentions this dashboard. Edit it before sending if you want to add a line.` }, gain: {}, chain: [{ label: "Clients who see progress every week stay", value: "retention" }], confidence: "High", effort: "1 click", risk: "Low", undoable: false, priority: 400, links: [{ label: "Their progress page", url }] },
    draft: { target: "email", fields: [{ name: "subject", label: "Subject", before: "", after: mail.subject }, { name: "body", label: "Email", before: "", after: mail.body }] },
  };
}
