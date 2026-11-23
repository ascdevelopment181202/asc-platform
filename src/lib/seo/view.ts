import "server-only";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { googleAccount } from "@/lib/google";
import { googleEnabled } from "@/lib/env";
import type { AiCheck, CompetitorCheck, Connection, GoogleUpdate, MonthResult, Plan, SeoAction, SeoChange, SeoSettings, WeeklyReview, WeekPoint } from "./types";
import { aiSpend } from "./ai";
import { recentAiChecks } from "./aivis";
import type { BingStats } from "./bing";
import { citationCopy, citationRows, directoriesFor, type CitationRow, type Directory } from "./citations";
import { reportUrl } from "./client-report";
import { connectionsFor } from "./connections";
import { demoActions, demoView, DEMO_ID } from "./demo";
import type { PageSnapshot, PageSummary, QuerySnapshot } from "./engine";
import type { GbpWeek } from "./gbp";
import { latestCompetitors, rankHistory } from "./places";
import { reviewPace, type ReviewPace } from "./profile";
import { monthResults, trackingSeen } from "./results";
import { allSettings, currentPlan, getLatest, getSettings, listActions, listChanges, weeklyMetrics } from "./store";
import { googleUpdates, trackRecord, type TrackRecord } from "./strategist";

export type ClientView = {
  demo: boolean;
  clientId: string;
  name: string;
  settings: SeoSettings;
  weeks: WeekPoint[];
  queries: QuerySnapshot | null;
  pageRows: PageSnapshot | null;
  pages: PageSummary[];
  actions: SeoAction[];
  changes: SeoChange[];
  competitors: CompetitorCheck[];
  ranks: { query: string; checked_on: string; client_rank: number | null }[];
  aiChecks: AiCheck[];
  directories: Directory[];
  citations: CitationRow[];
  copy: { label: string; value: string }[];
  plan: { plan: Plan; written: boolean; period?: string };
  review: WeeklyReview | null;
  results: MonthResult[];
  connections: Connection[];
  updates: GoogleUpdate[];
  gbpKeywords: { keyword: string; impressions: number }[];
  pace: ReviewPace;
  bing: BingStats | null;
  track: TrackRecord;
  spend: { spent: number; budget: number };
  score: number;
  rating: number | null;
  reviewCount: number | null;
  reportUrl: string; // the client's private progress page
};

const PENALTY: Record<string, number> = { Technical: 4, Profile: 5, Page: 2, "AI search": 3, Content: 1, Reviews: 3, Manual: 1 };

/** Starts at 100. Each open issue takes points off; missing connections take off 10 each. */
export function healthScore(actions: SeoAction[], connections: Connection[]): number {
  let score = 100;
  for (const a of actions) if (a.status === "new" || a.status === "failed") score -= a.detail.alert ? 15 : (PENALTY[a.type] ?? 2);
  for (const c of connections) if ((c.key === "gbp" || c.key === "gsc") && c.state !== "ok") score -= 10;
  return Math.max(5, Math.min(100, Math.round(score)));
}

export async function loadView(clientId: string): Promise<ClientView | null> {
  if (clientId === DEMO_ID) return demoView();
  const { data: c } = await db().from("clients").select("*").eq("id", clientId).maybeSingle<Client>();
  const settings = c ? await getSettings(clientId) : null;
  if (!c || !settings) return null;
  const cfg = settings.config;
  const [site, gbp, queries, pageRows, pages, actions, changes, competitors, ranks, aiChecks, citations, plan, weekly, results, updates, gbpKeywords, bing, track, spend, tracking, reviews, gAccount] = await Promise.all([
    weeklyMetrics<WeekPoint>(clientId, "site"),
    weeklyMetrics<GbpWeek>(clientId, "gbp"),
    getLatest<QuerySnapshot>(clientId, "query_rows"),
    getLatest<PageSnapshot>(clientId, "page_rows"),
    getLatest<PageSummary[]>(clientId, "pages"),
    listActions({ clientId, limit: 400 }),
    listChanges(clientId),
    latestCompetitors(clientId),
    rankHistory(clientId),
    recentAiChecks(clientId),
    citationRows(clientId),
    currentPlan(clientId, cfg),
    db().from("seo_plans").select("content").eq("client_id", clientId).eq("kind", "weekly").order("period", { ascending: false }).limit(1).maybeSingle<{ content: WeeklyReview }>(),
    monthResults(clientId),
    googleUpdates(),
    getLatest<{ keyword: string; impressions: number }[]>(clientId, "gbp_keywords"),
    getLatest<BingStats>(clientId, "bing"),
    trackRecord(),
    aiSpend(clientId),
    trackingSeen(clientId),
    db().from("google_reviews").select("created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(200).returns<{ created_at: string }[]>(),
    googleEnabled() ? googleAccount() : Promise.resolve(null),
  ]);
  const byWeek = new Map<string, WeekPoint>();
  for (const w of site) byWeek.set(w.week, { ...w.data, week: w.week });
  for (const w of gbp) byWeek.set(w.week, { ...(byWeek.get(w.week) ?? { week: w.week, clicks: 0, impressions: 0, position: 0 }), calls: w.data.calls, directions: w.data.directions, websiteClicks: w.data.websiteClicks });
  const name = clientLabel(c);
  const connections = connectionsFor(settings, c.first_name ?? name, { tracking, bing: !!bing, google: !!gAccount });
  return {
    demo: false,
    clientId,
    name,
    settings,
    weeks: [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week)),
    queries,
    pageRows,
    pages: pages ?? [],
    actions,
    changes,
    competitors,
    ranks,
    aiChecks,
    directories: directoriesFor({ ...cfg, country: cfg.country ?? c.country }),
    citations: [...citations.values()],
    copy: citationCopy(cfg),
    plan,
    review: weekly.data?.content ?? null,
    results,
    connections,
    updates,
    gbpKeywords: gbpKeywords ?? [],
    pace: reviewPace(c, reviews.data ?? [], competitors),
    bing,
    track,
    spend: { spent: spend.spent, budget: cfg.aiBudgetGbp ?? 3 },
    score: healthScore(actions, connections),
    rating: c.google_rating,
    reviewCount: c.google_review_count,
    reportUrl: await reportUrl(clientId),
  };
}

export type InboxItem = { action: SeoAction; clientName: string; country: "GB" | "US"; demo: boolean };

/** Open items across every client, alerts first, then by score. */
export async function inboxItems(opts: { demo?: boolean } = {}): Promise<{ items: InboxItem[]; clients: { id: string; name: string }[] }> {
  const [actions, settings, { data: clients }] = await Promise.all([listActions({ statuses: ["new", "approved", "failed"], limit: 400 }), allSettings(), db().from("clients").select("id, business_name, full_name, email, country").returns<Pick<Client, "id" | "business_name" | "full_name" | "email" | "country">[]>()]);
  const name = new Map((clients ?? []).map((c) => [c.id, { name: clientLabel(c), country: c.country }]));
  const on = new Set(settings.filter((s) => s.enabled).map((s) => s.client_id));
  const items: InboxItem[] = actions.filter((a) => on.has(a.client_id)).map((a) => ({ action: a, clientName: name.get(a.client_id)?.name ?? "Client", country: name.get(a.client_id)?.country ?? "GB", demo: false }));
  if (opts.demo) items.push(...demoActions().filter((a) => ["new", "approved", "failed"].includes(a.status)).map((a) => ({ action: a, clientName: "Demo client", country: "GB" as const, demo: true })));
  return { items, clients: [...settings.filter((s) => s.enabled).map((s) => ({ id: s.client_id, name: name.get(s.client_id)?.name ?? "Client" })), ...(opts.demo ? [{ id: DEMO_ID, name: "Demo client" }] : [])] };
}
