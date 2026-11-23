import "server-only";
import { db } from "@/lib/supabase";
import type { MonthResult } from "./types";
import type { GbpWeek } from "./gbp";
import { weeklyMetrics } from "./store";

const DAY = 86_400_000;
const AI_SOURCES = ["ai"];

type Ev = { day: string; kind: string; source: string; count: number };

/** Leads that came from Google and AI search, month by month. Reads the existing call and enquiry tables; never writes to them. */
export async function monthResults(clientId: string, months = 6): Promise<MonthResult[]> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));
  const since = start.toISOString().slice(0, 10);
  const [gbp, calls, enquiries, events] = await Promise.all([
    weeklyMetrics<GbpWeek>(clientId, "gbp", 30),
    db().from("calls").select("created_at").eq("client_id", clientId).gte("created_at", since).limit(5000).returns<{ created_at: string }[]>(),
    db().from("enquiries").select("created_at").eq("client_id", clientId).gte("created_at", since).limit(5000).returns<{ created_at: string }[]>(),
    db().from("seo_events").select("day, kind, source, count").eq("client_id", clientId).gte("day", since).limit(20000).returns<Ev[]>(),
  ]);
  const out = new Map<string, MonthResult>();
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    const m = d.toISOString().slice(0, 7);
    out.set(m, { month: m, profileCalls: 0, directions: 0, profileWebsite: 0, ascCalls: 0, enquiries: 0, siteCalls: 0, forms: 0, aiVisits: 0, searchVisits: 0 });
  }
  for (const w of gbp) {
    const r = out.get(w.week.slice(0, 7));
    if (!r) continue;
    r.profileCalls += w.data.calls;
    r.directions += w.data.directions;
    r.profileWebsite += w.data.websiteClicks;
  }
  for (const c of calls.data ?? []) {
    const r = out.get(c.created_at.slice(0, 7));
    if (r) r.ascCalls++;
  }
  for (const e of enquiries.data ?? []) {
    const r = out.get(e.created_at.slice(0, 7));
    if (r) r.enquiries++;
  }
  for (const e of events.data ?? []) {
    const r = out.get(e.day.slice(0, 7));
    if (!r) continue;
    if (e.kind === "call") r.siteCalls += e.count;
    else if (e.kind === "form") r.forms += e.count;
    else if (e.kind === "view" && AI_SOURCES.includes(e.source)) r.aiVisits += e.count;
    else if (e.kind === "view" && (e.source === "search" || e.source === "maps")) r.searchVisits += e.count;
  }
  return [...out.values()];
}

/** The share of visitors who call or send a form, from the tracking script. Null until there's enough traffic to trust. */
export async function realEnquiryRate(clientId: string): Promise<number | null> {
  const { data } = await db().from("seo_events").select("kind, count").eq("client_id", clientId).gte("day", new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10)).limit(20000).returns<{ kind: string; count: number }[]>();
  let views = 0;
  let leads = 0;
  for (const e of data ?? []) {
    if (e.kind === "view") views += e.count;
    else if (e.kind === "call" || e.kind === "form") leads += e.count;
  }
  return views >= 200 ? Math.min(0.3, leads / views) : null;
}

export async function trackingSeen(clientId: string): Promise<boolean> {
  const { count } = await db().from("seo_events").select("day", { count: "exact", head: true }).eq("client_id", clientId).gte("day", new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10));
  return (count ?? 0) > 0;
}
