import "server-only";
import { db, type Client } from "./supabase";
import { env } from "./env";
import { signoff } from "./email";
import { firstNameOf } from "./onboarding";
import { allPaths, pageForPath } from "./seo-pages";
import type { Site } from "./sites";
import { siteInsights, type Insights, type Ranking } from "./insights";

const DAY = 24 * 3600_000;
export const REPORT_DAYS = 30;

type EventRow = { day: string; kind: "view" | "call"; path: string; source: string; count: number };
type EnquiryRow = { created_at: string; name: string; service: string | null };

export type Period = { from: Date; to: Date };

export type ReportStats = {
  period: Period;
  visits: number;
  calls: number;
  enquiries: number;
  recent: EnquiryRow[];
  sources: { search: number; social: number; direct: number; other: number };
  topPages: { label: string; views: number }[];
  pagesLive: number;
  previous: { visits: number; calls: number; enquiries: number } | null;
  dailyVisits: { day: string; views: number }[];
  insights: Insights;
};

/** London calendar day, as YYYY-MM-DD. */
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const nice = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

/** The nth 30-day period after launch (n starts at 1). */
export function reportPeriod(launchedAt: string, n: number): Period {
  const start = Date.parse(launchedAt);
  return { from: new Date(start + (n - 1) * REPORT_DAYS * DAY), to: new Date(start + n * REPORT_DAYS * DAY) };
}

/** The 30 days up to now, for previews and manual sends. */
export const lastDays = (n: number): Period => ({ from: new Date(Date.now() - n * DAY), to: new Date() });
export const lastThirtyDays = (): Period => lastDays(REPORT_DAYS);

function pageLabel(site: Site, path: string) {
  if (path === "/") return "Homepage";
  return pageForPath(site.content, path)?.h1 ?? path;
}

async function counts(site: Site, p: Period) {
  const [{ data: events }, { data: enquiries }] = await Promise.all([
    db()
      .from("site_events")
      .select("day, kind, path, source, count")
      .eq("site_id", site.id)
      .gte("day", dayOf(p.from))
      .lt("day", dayOf(p.to))
      .returns<EventRow[]>(),
    db()
      .from("enquiries")
      .select("created_at, name, service")
      .eq("site_id", site.id)
      .gte("created_at", p.from.toISOString())
      .lt("created_at", p.to.toISOString())
      .order("created_at", { ascending: false })
      .returns<EnquiryRow[]>(),
  ]);
  const ev = events ?? [];
  const views = ev.filter((e) => e.kind === "view");
  const sources = { search: 0, social: 0, direct: 0, other: 0 };
  const byPage = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const v of views) {
    if (v.source !== "internal") byDay.set(v.day, (byDay.get(v.day) ?? 0) + v.count);
    if (v.source in sources) sources[v.source as keyof typeof sources] += v.count;
    byPage.set(v.path, (byPage.get(v.path) ?? 0) + v.count);
  }
  return {
    visits: views.filter((v) => v.source !== "internal").reduce((n, v) => n + v.count, 0),
    calls: ev.filter((e) => e.kind === "call").reduce((n, e) => n + e.count, 0),
    enquiries: enquiries?.length ?? 0,
    recent: (enquiries ?? []).slice(0, 10),
    sources,
    byPage,
    byDay,
  };
}

export async function reportStats(site: Site, period: Period): Promise<ReportStats> {
  const len = period.to.getTime() - period.from.getTime();
  const prevPeriod = { from: new Date(period.from.getTime() - len), to: period.from };
  const hasPrevious = Date.parse(site.created_at) < prevPeriod.to.getTime() - 7 * DAY;
  const [now, prev, insights] = await Promise.all([counts(site, period), hasPrevious ? counts(site, prevPeriod) : null, siteInsights(site, period)]);
  const dailyVisits: { day: string; views: number }[] = [];
  for (let t = period.from.getTime(); t < period.to.getTime(); t += DAY) {
    const day = dayOf(new Date(t));
    dailyVisits.push({ day, views: now.byDay.get(day) ?? 0 });
  }
  return {
    period,
    visits: now.visits,
    calls: now.calls,
    enquiries: now.enquiries,
    recent: now.recent,
    sources: now.sources,
    topPages: [...now.byPage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, views]) => ({ label: pageLabel(site, path), views })),
    pagesLive: allPaths(site.content).length,
    previous: prev ? { visits: prev.visits, calls: prev.calls, enquiries: prev.enquiries } : null,
    dailyVisits,
    insights,
  };
}

/** "#3 (up from #11)" for a ranking. */
export function rankLine(r: Ranking) {
  const now = Math.max(1, Math.round(r.position));
  if (r.previous === null) return `#${now} (new this month)`;
  const before = Math.max(1, Math.round(r.previous));
  if (before === now) return `#${now} (no change)`;
  return `#${now} (${before > now ? "up" : "down"} from #${before})`;
}

export const dashboardUrl = (c: Client) => `${env.appUrl}/r/${c.dashboard_token}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function vsLast(now: number, before: number | undefined) {
  if (before === undefined) return "";
  if (now === before) return " (same as last month)";
  return ` (${before} last month)`;
}

function sourceLine(s: ReportStats["sources"]) {
  const total = s.search + s.social + s.direct + s.other;
  if (!total) return "";
  const pct = (n: number) => Math.round((n / total) * 100);
  const parts = [
    [s.search, "Google and other search engines"],
    [s.direct, "typed in your address or tapped a saved link"],
    [s.social, "social media"],
    [s.other, "other websites"],
  ] as const;
  return parts
    .filter(([n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([n, label]) => `- ${pct(n)}% ${label}`)
    .join("\n");
}

/** The monthly report email for a client. */
export function reportEmail(c: Client, site: Site, s: ReportStats, opts: { first?: boolean } = {}) {
  const name = firstNameOf(c);
  const biz = site.content.businessName;
  const liveUrl = site.domain ? `https://${site.domain}` : c.live_url ?? `${env.appUrl}/s/${site.slug}`;
  const p = s.previous;
  const lastDay = new Date(s.period.to.getTime() - DAY);

  const g = s.insights.gbp;
  const search = s.insights.search;
  const taps = s.calls + (g?.calls ?? 0);
  const subject = `${biz} this month: ${plural(s.enquiries, "enquiry", "enquiries")}, ${plural(taps, "phone tap")}, ${plural(s.visits, "website visit")}`;

  const lines: string[] = [
    `Hi ${name},`,
    `Here's how the ${biz} website did from ${nice(s.period.from)} to ${nice(lastDay)}.`,
    [
      `**Enquiry forms sent: ${s.enquiries}**${vsLast(s.enquiries, p?.enquiries)}`,
      `**Taps on your number on the website: ${s.calls}**${vsLast(s.calls, p?.calls)}`,
      `**Visits: ${s.visits}**${vsLast(s.visits, p?.visits)}`,
    ].join("\n"),
  ];

  if (g) {
    const gp = g.previous ?? undefined;
    lines.push(
      [
        "**Your Google Business Profile**",
        `- ${plural(g.calls, "call")} from your profile${vsLast(g.calls, gp?.calls)}`,
        `- ${plural(g.directions, "person", "people")} asked for directions${vsLast(g.directions, gp?.directions)}`,
        `- ${plural(g.views, "view")} on Google Search and Maps${vsLast(g.views, gp?.views)}`,
        `- ${plural(g.websiteClicks, "click")} through to your website${vsLast(g.websiteClicks, gp?.websiteClicks)}`,
      ].join("\n"),
    );
  }
  if (search && (search.rankings.length || search.impressions)) {
    const top = search.previous ? ` (${search.previous.topTen} last month)` : "";
    lines.push(
      [
        "**Where you show up on Google**",
        `You're on the first page of Google for ${plural(search.topTen, "search", "searches")}${top}, and you appeared in results ${search.impressions.toLocaleString("en-GB")} times.`,
        ...search.rankings.slice(0, 6).map((r) => `- "${r.query}": ${rankLine(r)}`),
      ].join("\n"),
    );
  }

  const src = sourceLine(s.sources);
  if (src) lines.push(`**How people found you**\n${src}`);
  if (s.topPages.length) lines.push(`**Most visited pages**\n${s.topPages.map((t) => `- ${t.label} (${t.views})`).join("\n")}`);
  if (s.recent.length) {
    lines.push(
      `**Latest enquiries**\n${s.recent
        .slice(0, 5)
        .map((e) => `- ${new Date(e.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}: ${e.name}${e.service ? `, ${e.service}` : ""}`)
        .join("\n")}`,
    );
  }

  const did = [
    opts.first ? "Launched your new website" : "",
    `Kept ${plural(s.pagesLive, "page")} live on your site, each one written for a service or area you cover`,
    ...(c.report_note ?? "").split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()),
  ].filter(Boolean);
  lines.push(`**What we did this month**\n${did.map((d) => `- ${d}`).join("\n")}`);

  if (s.enquiries + taps === 0) {
    lines.push(
      opts.first
        ? "New sites usually take a few weeks to start showing up on Google. I'm keeping an eye on it and I'll be in touch if there's anything we should change."
        : "It's been a quiet month, so I'm looking into what we can improve and I'll be in touch this week.",
    );
  }
  lines.push(`See your site: ${liveUrl}\nYour live dashboard, any time: ${dashboardUrl(c)}`);
  lines.push("Want anything changed or added? Just reply to this email.");
  lines.push("P.S. If you know another trade who could do with more work, reply with their name and number and I'll look after them.");
  lines.push(signoff());

  return { subject, text: lines.join("\n\n") };
}

/** Builds and sends a report, then clears the client's note. */
export async function sendReport(c: Client, site: Site, period: Period, opts: { first?: boolean } = {}) {
  const { sendEmail, notifyAdmin } = await import("./email");
  const stats = await reportStats(site, period);
  const mail = reportEmail(c, site, stats, opts);
  await sendEmail({ to: c.email, ...mail });
  if (c.report_note) await db().from("clients").update({ report_note: null }).eq("id", c.id);
  if (stats.enquiries + stats.calls + (stats.insights.gbp?.calls ?? 0) === 0) {
    const { createTask, clientLabel } = await import("./clients");
    await createTask(c.id, `Quiet month for ${clientLabel(c)}: no enquiries or calls. Check the site and Google profile, then call them.`, new Date());
    await notifyAdmin(`Quiet month: ${clientLabel(c)}`, [`${clientLabel(c)} had no enquiries or phone taps in their last report period.`, `${env.appUrl}/admin/clients/${c.id}`]);
  }
  return stats;
}
