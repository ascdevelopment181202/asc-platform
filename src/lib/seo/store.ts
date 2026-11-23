import "server-only";
import { db } from "@/lib/supabase";
import type { ActionType, Finding, Plan, SeoAction, SeoChange, SeoConfig, SeoSettings, SeoState } from "./types";
import { LATEST_WEEK } from "./types";
import { scoreOf } from "./value";

const DAY = 86_400_000;
const SETTINGS = "client_id, enabled, paused, config, state, tracking_token, last_run_on, last_weekly_on, last_monthly_on, setup_done_at";

export async function getSettings(clientId: string): Promise<SeoSettings | null> {
  const { data } = await db().from("seo_settings").select(SETTINGS).eq("client_id", clientId).maybeSingle<SeoSettings>();
  return data;
}

export async function ensureSettings(clientId: string): Promise<SeoSettings> {
  const found = await getSettings(clientId);
  if (found) return found;
  const { data, error } = await db().from("seo_settings").upsert({ client_id: clientId }, { onConflict: "client_id" }).select(SETTINGS).single<SeoSettings>();
  if (error) throw error;
  return data;
}

export async function allSettings(): Promise<SeoSettings[]> {
  const { data } = await db().from("seo_settings").select(SETTINGS).returns<SeoSettings[]>();
  return data ?? [];
}

export async function saveConfig(clientId: string, patch: Partial<SeoConfig>, extra: Partial<Pick<SeoSettings, "enabled" | "paused" | "setup_done_at">> = {}) {
  const s = await ensureSettings(clientId);
  const config = { ...s.config, ...patch };
  await db().from("seo_settings").update({ config, ...extra, updated_at: new Date().toISOString() }).eq("client_id", clientId);
  return config;
}

/** Merges into state. Read-modify-write is fine here: one run per client at a time. */
export async function patchState(clientId: string, patch: Partial<SeoState>) {
  const s = await getSettings(clientId);
  if (!s) return;
  await db().from("seo_settings").update({ state: { ...s.state, ...patch }, updated_at: new Date().toISOString() }).eq("client_id", clientId);
}

// ---------- Platform-wide values ----------

export async function kvGet<T>(key: string): Promise<T | null> {
  const { data } = await db().from("seo_kv").select("value").eq("key", key).maybeSingle<{ value: T }>();
  return data?.value ?? null;
}
export async function kvSet(key: string, value: unknown) {
  await db().from("seo_kv").upsert({ key, value, updated_at: new Date().toISOString() });
}
export const globalPaused = async () => (await kvGet<boolean>("paused")) === true;

// ---------- Metrics ----------

export async function putMetric(clientId: string, week: string, kind: string, data: unknown) {
  await db().from("seo_metrics").upsert({ client_id: clientId, week, kind, data, updated_at: new Date().toISOString() });
}
export async function getLatest<T>(clientId: string, kind: string): Promise<T | null> {
  const { data } = await db().from("seo_metrics").select("data").eq("client_id", clientId).eq("week", LATEST_WEEK).eq("kind", kind).maybeSingle<{ data: T }>();
  return data?.data ?? null;
}
export const putLatest = (clientId: string, kind: string, data: unknown) => putMetric(clientId, LATEST_WEEK, kind, data);

export async function weeklyMetrics<T>(clientId: string, kind: string, weeks = 16): Promise<{ week: string; data: T }[]> {
  const { data } = await db().from("seo_metrics").select("week, data").eq("client_id", clientId).eq("kind", kind).neq("week", LATEST_WEEK).order("week", { ascending: false }).limit(weeks).returns<{ week: string; data: T }[]>();
  return (data ?? []).reverse();
}

// ---------- Actions ----------

export const OPEN = ["new", "approved", "failed"] as const;

export async function listActions(opts: { clientId?: string; statuses?: readonly string[]; limit?: number } = {}): Promise<SeoAction[]> {
  let q = db().from("seo_actions").select("*").order("score", { ascending: false }).limit(opts.limit ?? 500);
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  if (opts.statuses) q = q.in("status", [...opts.statuses]);
  const { data } = await q.returns<SeoAction[]>();
  return data ?? [];
}

export async function getAction(id: string): Promise<SeoAction | null> {
  const { data } = await db().from("seo_actions").select("*").eq("id", id).maybeSingle<SeoAction>();
  return data;
}

export async function updateAction(id: string, patch: Partial<SeoAction>) {
  await db().from("seo_actions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

/** The default goals every client starts with, until the strategist writes a plan from their data. */
export function defaultPlan(cfg: SeoConfig): Plan {
  const towns = (cfg.towns ?? []).slice(0, 3).join(", ");
  return {
    summary: "Starter plan. The strategist replaces this with one written from the client's own data once there's enough of it.",
    goals: [
      { goal: `Top 3 on Google Maps for the core services${towns ? ` in ${towns}` : ""}`, why: "The map results take most of the calls for local trades.", measure: "Map position for the main searches, and calls from the Business Profile", serves: ["Profile", "Reviews"] },
      { goal: "Win more clicks from searches the site already shows for", why: "Pages close to the top are the fastest wins.", measure: "Clicks and average position in Search Console", serves: ["Page", "Technical"] },
      { goal: "Be the business AI answers name", why: "ChatGPT and Google's AI answers now sit above the normal results.", measure: "Share of AI answers that name the business", serves: ["AI search"] },
      { goal: "Cover every service in every town worth winning", why: "A search with no matching page can't be won.", measure: "Service and town pages live and getting impressions", serves: ["Content", "Manual"] },
    ],
    priorities: ["Business Profile and reviews first", "Then fix pages that already rank", "Then new pages, a few a week"],
    stop: ["Publishing pages with nothing local on them"],
  };
}

export async function currentPlan(clientId: string, cfg: SeoConfig): Promise<{ plan: Plan; written: boolean; period?: string }> {
  const { data } = await db().from("seo_plans").select("content, period").eq("client_id", clientId).eq("kind", "plan").order("period", { ascending: false }).limit(1).maybeSingle<{ content: Plan; period: string }>();
  return data ? { plan: data.content, written: true, period: data.period } : { plan: defaultPlan(cfg), written: false };
}

export const goalFor = (plan: Plan, type: ActionType) => plan.goals.find((g) => g.serves?.includes(type))?.goal ?? null;

/**
 * Turns findings into inbox rows. One row per (client, dedupe key):
 * - an open row gets fresh evidence; a written draft is kept
 * - a dismissed row stays quiet for 30 days, an applied one for 60
 * - open rows in `group` that are no longer detected are closed as resolved
 */
export async function upsertFindings(clientId: string, findings: Finding[], cfg: SeoConfig, group: string[] = []): Promise<{ added: number; resolved: number }> {
  const { data: rows } = await db().from("seo_actions").select("id, kind, dedupe_key, status, updated_at, snoozed_until, applied_at, draft, apply, dismissed_reason").eq("client_id", clientId).returns<Pick<SeoAction, "id" | "kind" | "dedupe_key" | "status" | "updated_at" | "snoozed_until" | "applied_at" | "draft" | "apply" | "dismissed_reason">[]>();
  const existing = new Map((rows ?? []).map((r) => [r.dedupe_key, r]));
  const { plan } = await currentPlan(clientId, cfg);
  // Each "not relevant" or "wrong" on a kind pushes that kind down for this client.
  const disliked = new Map<string, number>();
  for (const r of rows ?? []) if (r.status === "dismissed" && (r.dismissed_reason === "not relevant" || r.dismissed_reason === "wrong")) disliked.set(r.kind, (disliked.get(r.kind) ?? 0) + 1);
  const now = Date.now();
  const seen = new Set<string>();
  let added = 0;

  for (const f of findings) {
    if (seen.has(f.dedupe)) continue;
    seen.add(f.dedupe);
    const goal = goalFor(plan, f.type);
    const score = scoreOf(f.type, f.detail, { servesGoal: !!goal, penalty: Math.max(0.4, Math.pow(0.8, disliked.get(f.kind) ?? 0)) });
    const fresh = { kind: f.kind, type: f.type, summary: f.summary, detail: f.detail, score, goal, updated_at: new Date().toISOString() };
    const old = existing.get(f.dedupe);
    if (!old) {
      const { error } = await db().from("seo_actions").insert({ client_id: clientId, dedupe_key: f.dedupe, status: "new", draft: f.draft ?? null, ...fresh });
      if (!error) added++;
      continue;
    }
    const age = now - Date.parse(old.updated_at);
    const reopen = (old.status === "dismissed" && age > 30 * DAY) || ((old.status === "applied" || old.status === "done") && now - Date.parse(old.applied_at ?? old.updated_at) > 60 * DAY) || (old.status === "snoozed" && (!old.snoozed_until || Date.parse(old.snoozed_until) < now));
    if (reopen) {
      await db().from("seo_actions").update({ ...fresh, status: "new", draft: f.draft ?? null, apply: null, result: null, snoozed_until: null, dismissed_reason: null }).eq("id", old.id);
      added++;
    } else if (old.status === "new") {
      const keepDraft = old.draft && !old.draft.needsAi;
      await db().from("seo_actions").update({ ...fresh, ...(keepDraft ? {} : { draft: f.draft ?? old.draft ?? null }) }).eq("id", old.id);
    }
  }

  let resolved = 0;
  for (const r of rows ?? []) {
    if (r.status !== "new" || !group.includes(r.kind) || seen.has(r.dedupe_key) || r.apply?.prNumber) continue;
    await db().from("seo_actions").update({ status: "dismissed", dismissed_reason: "resolved itself", updated_at: new Date().toISOString() }).eq("id", r.id);
    resolved++;
  }
  return { added, resolved };
}

// ---------- Changes ----------

export async function logChange(c: { clientId: string; actionId?: string | null; target: string; summary: string; before?: unknown; after?: unknown; undo?: unknown; auto?: boolean }): Promise<string | null> {
  const { data } = await db().from("seo_changes").insert({ client_id: c.clientId, action_id: c.actionId ?? null, target: c.target, summary: c.summary, before: c.before ?? null, after: c.after ?? null, undo: c.undo ?? null, auto: !!c.auto }).select("id").single<{ id: string }>();
  return data?.id ?? null;
}

export async function listChanges(clientId: string, limit = 100): Promise<SeoChange[]> {
  const { data } = await db().from("seo_changes").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(limit).returns<SeoChange[]>();
  return data ?? [];
}

/** New pages published on this client's site in the last 7 days (drip: at most 3 a week). */
export async function pagesThisWeek(clientId: string): Promise<number> {
  const { count } = await db().from("seo_actions").select("id", { count: "exact", head: true }).eq("client_id", clientId).in("kind", ["new_page", "cost_guide", "comparison", "blog"]).eq("status", "applied").gte("applied_at", new Date(Date.now() - 7 * DAY).toISOString());
  return count ?? 0;
}

// ---------- Dates ----------

const london = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
export const todayLondon = () => london(new Date());
export const londonHour = () => Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }));
export const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** The Monday of the week a date falls in. */
export function mondayOf(d: Date | string): string {
  const x = new Date(typeof d === "string" ? `${d}T12:00:00Z` : d);
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return ymd(x);
}
export const shortDate = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
