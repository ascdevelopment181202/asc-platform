import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { seoEnv } from "@/lib/env";
import { db } from "@/lib/supabase";
import { ensureSettings } from "@/lib/seo/store";
import { DEMO_ID } from "@/lib/seo/demo";
import type { SeoAction } from "@/lib/seo/types";
import { loadView, type ClientView } from "@/lib/seo/view";
import { shotUrl } from "@/lib/seo/visual";
import { money } from "@/lib/seo/value";
import { btn, btnQuiet, fmt, input } from "../../ui";
import { draftWeekly, runNow, saveCitation, saveSettings, setEnabled, setPaused, undo } from "../actions";
import { AutoRefresh, CopyButton } from "../client";
import { ActionCard, card, ConnStrip, Msg, Pill, Spark, Stat, Tabs } from "../ui";

export const dynamic = "force-dynamic";
// "Run a full check" and the first audit carry on after the response, inside this limit.
export const maxDuration = 300;

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "keywords", label: "Keywords" },
  { key: "pages", label: "Pages" },
  { key: "content", label: "Content" },
  { key: "profile", label: "Business Profile" },
  { key: "competitors", label: "Competitors" },
  { key: "ai", label: "AI visibility" },
  { key: "citations", label: "Citations and links" },
  { key: "results", label: "Results" },
  { key: "changes", label: "Changes" },
  { key: "settings", label: "Settings" },
];

const isOpen = (a: SeoAction) => ["new", "approved", "failed"].includes(a.status);
const pos = (n: number | null | undefined) => (n ? n.toFixed(1).replace(/\.0$/, "") : "-");
const th = "px-3 py-2 text-left text-xs font-medium text-neutral-500";
const td = "px-3 py-2 text-sm";
const change = (now: number, before: number) => (before ? `${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)}% vs the 4 weeks before` : "No earlier data");

export default async function ClientSeo({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ tab?: string; msg?: string; open?: string }> }) {
  if (!seoEnv.on()) notFound();
  const { clientId } = await params;
  const sp = await searchParams;
  if (clientId !== DEMO_ID) {
    const { data: c } = await db().from("clients").select("id").eq("id", clientId).maybeSingle();
    if (!c) notFound();
    const s = await ensureSettings(clientId);
    if (!s.setup_done_at) redirect(`/admin/seo/${clientId}/setup`);
  }
  const v = await loadView(clientId);
  if (!v) notFound();
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const base = `/admin/seo/${clientId}`;
  const back = `${base}?tab=${tab}`;
  const open = v.actions.filter(isOpen);
  const country = v.settings.config.country ?? "GB";
  const shots: Record<string, string> = {};
  for (const a of open) for (const s of a.apply?.visual?.shots ?? []) for (const p of [s.before, s.after]) if (p && !v.demo) shots[p] = (await shotUrl(p)) ?? "";
  const cards = (list: SeoAction[], empty: string) => (list.length ? <div className="space-y-3">{list.map((a) => <ActionCard key={a.id} a={a} clientName={v.name} country={country} demo={v.demo} back={back} track={v.track} updates={v.updates} open={sp.open === a.id} shots={shots} showClient={false} />)}</div> : <p className="text-sm text-neutral-500">{empty}</p>);
  const st = v.settings.state;

  return (
    <div className="space-y-6">
      {st.progress && !v.demo && <AutoRefresh seconds={8} />}
      <Msg msg={sp.msg} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-neutral-500"><Link href="/admin/seo" className="underline">SEO inbox</Link> / {v.demo ? "Demo" : <Link href={`/admin/clients/${clientId}`} className="underline">Client page</Link>}</p>
          <h1 className="mt-1 text-2xl font-semibold">{v.name}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {v.settings.config.domain ? <a href={`https://${v.settings.config.domain}`} target="_blank" rel="noreferrer" className="underline">{v.settings.config.domain}</a> : "No site set"} · {v.settings.config.trade ?? "trade not set"}
            {v.demo && <span className="ml-2"><Pill cls="bg-neutral-900 text-white">Demo: sample data, nothing here is real</Pill></span>}
            {!v.settings.enabled && <span className="ml-2"><Pill cls="bg-neutral-200 text-neutral-700">Off</Pill></span>}
            {v.settings.paused && <span className="ml-2"><Pill cls="bg-amber-100 text-amber-800">Paused</Pill></span>}
          </p>
        </div>
        {!v.demo && (
          <div className="flex flex-wrap gap-2">
            <form action={runNow}><input type="hidden" name="clientId" value={clientId} /><input type="hidden" name="back" value={back} /><button className={btnQuiet}>Run a full check now</button></form>
            <form action={setPaused}><input type="hidden" name="clientId" value={clientId} /><input type="hidden" name="back" value={back} /><input type="hidden" name="paused" value={v.settings.paused ? "0" : "1"} /><button className={btnQuiet}>{v.settings.paused ? "Resume" : "Pause"}</button></form>
            <Link href={`${base}/setup`} className={btnQuiet}>Set up again</Link>
          </div>
        )}
      </div>
      {st.progress && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Working: {st.progress} This page refreshes itself.</p>}
      {st.lastError && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{st.lastError}</p>}
      <ConnStrip connections={v.connections} />
      <Tabs base={base} current={tab} tabs={TABS.map((t) => ({ ...t, count: t.key === "content" ? open.filter(isContent).length : t.key === "profile" ? open.filter((a) => a.type === "Profile" || a.type === "Reviews").length : undefined }))} />

      {tab === "overview" && <Overview v={v} open={open} cards={cards} />}
      {tab === "keywords" && <Keywords v={v} />}
      {tab === "pages" && <Pages v={v} open={open} cards={cards} />}
      {tab === "content" && cards(open.filter(isContent), "No drafts waiting. New ones are written each morning.")}
      {tab === "profile" && <Profile v={v} open={open} cards={cards} />}
      {tab === "competitors" && <Competitors v={v} open={open} cards={cards} />}
      {tab === "ai" && <Ai v={v} open={open} cards={cards} />}
      {tab === "citations" && <Citations v={v} open={open} cards={cards} back={back} />}
      {tab === "results" && <Results v={v} country={country} back={back} />}
      {tab === "changes" && <Changes v={v} back={back} />}
      {tab === "settings" && <Settings v={v} back={back} />}
    </div>
  );
}

const isContent = (a: SeoAction) => a.type === "Content" || ["answer_block", "gbp_post", "weather_post", "seasonal_post", "page_refresh", "page_boost"].includes(a.kind);
type Cards = (list: SeoAction[], empty: string) => React.ReactNode;

function Overview({ v, open, cards }: { v: ClientView; open: SeoAction[]; cards: Cards }) {
  const w = v.weeks;
  const sum = (rows: typeof w, k: "clicks" | "impressions" | "calls" | "directions") => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const cur = w.slice(-4);
  const prev = w.slice(-8, -4);
  const st = v.settings.state;
  const wins = v.actions.filter((a) => a.status === "applied").sort((a, b) => (b.applied_at ?? "").localeCompare(a.applied_at ?? "")).sort((a, b) => Number(b.result?.verdict === "worked") - Number(a.result?.verdict === "worked")).slice(0, 5);
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = v.changes.filter((c) => c.created_at.startsWith(month)).length;
  const b = st.baseline;
  const tone = (now: number, before: number) => (before ? (now >= before ? "good" : "bad") : undefined);
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="SEO health" value={`${v.score}/100`} sub={`${open.length} open item${open.length === 1 ? "" : "s"}`} />
        <Stat label="Clicks from Google, 4 weeks" value={sum(cur, "clicks")} sub={change(sum(cur, "clicks"), sum(prev, "clicks"))} tone={tone(sum(cur, "clicks"), sum(prev, "clicks"))} />
        <Stat label="Times shown on Google" value={sum(cur, "impressions").toLocaleString("en-GB")} sub={change(sum(cur, "impressions"), sum(prev, "impressions"))} tone={tone(sum(cur, "impressions"), sum(prev, "impressions"))} />
        <Stat label="Calls from the profile" value={sum(cur, "calls")} sub={change(sum(cur, "calls"), sum(prev, "calls"))} tone={tone(sum(cur, "calls"), sum(prev, "calls"))} />
        <Stat label="Direction requests" value={sum(cur, "directions")} sub={change(sum(cur, "directions"), sum(prev, "directions"))} tone={tone(sum(cur, "directions"), sum(prev, "directions"))} />
      </section>
      {st.gsc?.tooEarly && <p className="rounded-lg bg-neutral-100 p-3 text-sm text-neutral-700">Too early to tell: the site has very little search data so far, so page-level suggestions wait until there&apos;s enough to trust. Profile, review and site checks run as normal.</p>}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}><Spark points={w.map((x) => ({ week: x.week, value: x.clicks }))} updates={v.updates} label="Clicks from Google" height={80} /></div>
        <div className={`${card} p-4`}><Spark points={w.map((x) => ({ week: x.week, value: x.calls ?? 0 }))} label="Calls from the Business Profile" height={80} /></div>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">90-day plan {!v.plan.written && <span className="text-xs font-normal text-neutral-500">(starter plan until the strategist writes one)</span>}</h2>
          <p className="text-sm text-neutral-700">{v.plan.plan.summary}</p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">{v.plan.plan.goals.map((g) => <li key={g.goal}><span className="font-medium">{g.goal}.</span> {g.why} <span className="text-neutral-500">Measured by: {g.measure}.</span></li>)}</ol>
          <p className="text-sm"><span className="font-medium">Priorities:</span> {v.plan.plan.priorities.join(" · ")}</p>
          <p className="text-sm text-neutral-600"><span className="font-medium">Not doing:</span> {v.plan.plan.stop.join(" · ")}</p>
        </div>
        <div className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">This week</h2>
          {v.review ? <><p className="text-sm text-neutral-700">{v.review.diagnosis}</p><ol className="list-decimal space-y-1 pl-5 text-sm">{v.review.plan.map((p) => <li key={p}>{p}</li>)}</ol></> : <p className="text-sm text-neutral-500">The first weekly review is written on the next Monday run.</p>}
          <h2 className="pt-2 font-semibold">Since setup</h2>
          {b ? (
            <table className="w-full text-sm"><tbody>
              {b.clicks !== undefined && <tr className="border-t border-neutral-100"><td className="py-1 text-neutral-600">Clicks a month</td><td className="py-1 text-right">{b.clicks} → <span className="font-medium">{sum(cur, "clicks")}</span></td></tr>}
              {b.calls !== undefined && <tr className="border-t border-neutral-100"><td className="py-1 text-neutral-600">Profile calls a month</td><td className="py-1 text-right">{b.calls} → <span className="font-medium">{sum(cur, "calls")}</span></td></tr>}
              {b.reviews !== undefined && <tr className="border-t border-neutral-100"><td className="py-1 text-neutral-600">Google reviews</td><td className="py-1 text-right">{b.reviews} → <span className="font-medium">{v.reviewCount ?? "-"}</span></td></tr>}
              {b.aiAsked !== undefined && <tr className="border-t border-neutral-100"><td className="py-1 text-neutral-600">Named in AI answers</td><td className="py-1 text-right">{b.aiNamed} of {b.aiAsked} at setup</td></tr>}
            </tbody></table>
          ) : <p className="text-sm text-neutral-500">The baseline is taken on the first full check.</p>}
          <p className="text-xs text-neutral-500">Baseline taken {b ? fmt(b.at) : "-"}. {thisMonth} change{thisMonth === 1 ? "" : "s"} made this month.{st.brand ? ` ${st.brand.brandClicks} of the last 28 days' clicks were people searching the business by name; ${st.brand.otherClicks} were new searchers.` : ""}</p>
        </div>
      </section>
      <section className={`${card} p-4`}>
        <h2 className="font-semibold">Last 5 wins</h2>
        {wins.length ? <ul className="mt-2 divide-y divide-neutral-100 text-sm">{wins.map((a) => <li key={a.id} className="py-2"><span className="font-medium">{a.summary}</span> <span className="text-neutral-500">{a.result ? a.result.text : `Went live ${fmt(a.applied_at)}. Measured after 28 days.`}</span></li>)}</ul> : <p className="mt-2 text-sm text-neutral-500">Nothing applied yet. Approve items in the inbox and they show here with their results.</p>}
      </section>
      <section className={`${card} p-4 text-sm text-neutral-700`}>
        <h2 className="font-semibold text-neutral-900">Site health</h2>
        <p className="mt-2">{st.health ? `${st.health.up ? "Up" : "DOWN"}${st.health.tlsDaysLeft != null ? ` · certificate valid for ${st.health.tlsDaysLeft} days` : ""}${st.health.domainDaysLeft != null ? ` · domain renews in ${st.health.domainDaysLeft} days` : ""}${st.speed?.mobile != null ? ` · mobile speed ${st.speed.mobile}/100` : ""}. Checked ${fmt(st.health.checkedAt ?? null)}.` : "Not checked yet."} {st.lastRunAt && `Last full run ${fmt(st.lastRunAt)}.`}</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Top of this client&apos;s list</h2>
        {cards(open.slice(0, 5), "Nothing waiting for this client.")}
      </section>
    </div>
  );
}

function Keywords({ v }: { v: ClientView }) {
  const cfg = v.settings.config;
  const rows = v.queries?.rows ?? [];
  const stem = (s: string) => s.toLowerCase().replace(/(ing|s|es)$/, "");
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3).map(stem);
  const paths = v.pages.map((p) => p.path.toLowerCase());
  const plan = (cfg.services ?? []).flatMap((service) => (cfg.towns ?? []).map((town) => {
    const sw = words(service);
    const hits = rows.filter((r) => r.key.toLowerCase().includes(town.toLowerCase()) && sw.some((x) => r.key.toLowerCase().includes(x)));
    const best = hits.sort((a, b) => b.impressions - a.impressions)[0];
    const slugTown = town.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const page = paths.find((p) => p.includes(slugTown) && sw.some((x) => p.includes(x))) ?? best?.page;
    return { service, town, clicks: hits.reduce((n, r) => n + r.clicks, 0), impressions: hits.reduce((n, r) => n + r.impressions, 0), position: best?.position ?? null, page, own: !!paths.find((p) => p.includes(slugTown) && sw.some((x) => p.includes(x))) };
  }));
  const near = (p: number | null) => p !== null && p >= 5 && p <= 15;
  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">Keyword plan: every service in every town <span className="text-xs font-normal text-neutral-500">{v.queries ? `(${v.queries.period})` : ""}</span></h2>
        {plan.length ? (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><th className={th}>Service</th><th className={th}>Town</th><th className={th}>Page</th><th className={th}>Clicks</th><th className={th}>Shown</th><th className={th}>Position</th></tr></thead>
            <tbody>{plan.sort((a, b) => b.impressions - a.impressions).map((r) => (
              <tr key={`${r.service}-${r.town}`} className={`border-t border-neutral-100 ${near(r.position) ? "bg-amber-50" : ""}`}>
                <td className={td}>{r.service}</td><td className={td}>{r.town}</td>
                <td className={td}>{r.own ? r.page : r.page ? <span className="text-neutral-500">{r.page} <Pill cls="bg-orange-100 text-orange-800">no page of its own</Pill></span> : <Pill cls="bg-red-100 text-red-800">No page</Pill>}</td>
                <td className={td}>{r.clicks}</td><td className={td}>{r.impressions}</td><td className={td}>{pos(r.position)}{near(r.position) && <span className="ml-2 text-xs text-amber-800">close to the top</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="p-4 text-sm text-neutral-500">Add services and towns under Settings to build the plan.</p>}
      </section>
      <section className={card}>
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">Searches the site shows for <span className="text-xs font-normal text-neutral-500">Highlighted rows sit at positions 5 to 15: the quickest wins.</span></h2>
        {rows.length ? (
          <div className="max-h-[32rem] overflow-auto"><table className="w-full">
            <thead><tr><th className={th}>Search</th><th className={th}>Page</th><th className={th}>Clicks</th><th className={th}>Shown</th><th className={th}>Position</th><th className={th}>Was</th></tr></thead>
            <tbody>{rows.slice(0, 150).map((r) => <tr key={r.key} className={`border-t border-neutral-100 ${near(r.position) ? "bg-amber-50" : ""}`}><td className={td}>{r.key}</td><td className={`${td} text-neutral-500`}>{r.page ?? "-"}</td><td className={td}>{r.clicks}</td><td className={td}>{r.impressions}</td><td className={td}>{pos(r.position)}</td><td className={`${td} text-neutral-500`}>{pos(r.prevPosition)}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="p-4 text-sm text-neutral-500">No Search Console data yet. Connect Search Console (the badge above shows how). Once connected it brings up to 16 months of history.</p>}
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <h2 className="font-semibold">Words people used to find the Business Profile</h2>
          {v.gbpKeywords.length ? <ul className="mt-2 text-sm">{v.gbpKeywords.slice(0, 15).map((k) => <li key={k.keyword} className="flex justify-between border-t border-neutral-100 py-1"><span>{k.keyword}</span><span className="text-neutral-500">{k.impressions}</span></li>)}</ul> : <p className="mt-2 text-sm text-neutral-500">Not connected, or no data yet. Google reports these monthly.</p>}
        </div>
        <div className={`${card} p-4`}>
          <h2 className="font-semibold">Bing</h2>
          {v.bing ? <><p className="mt-2 text-sm text-neutral-600">{v.bing.clicks} clicks and {v.bing.impressions} impressions in the last 28 days.</p><ul className="mt-2 text-sm">{v.bing.queries.slice(0, 10).map((k) => <li key={k.query} className="flex justify-between border-t border-neutral-100 py-1"><span>{k.query}</span><span className="text-neutral-500">{k.clicks} clicks · position {pos(k.position)}</span></li>)}</ul></> : <p className="mt-2 text-sm text-neutral-500">Not connected. The Bing badge above shows how. ChatGPT search leans on Bing.</p>}
        </div>
      </section>
    </div>
  );
}

function Pages({ v, open, cards }: { v: ClientView; open: SeoAction[]; cards: Cards }) {
  const traffic = new Map((v.pageRows?.rows ?? []).map((r) => [r.key, r]));
  const issues = (path: string) => open.filter((a) => (a.draft?.page ?? a.detail.evidence.page) === path);
  const all = [...new Set([...v.pages.map((p) => p.path), ...traffic.keys()])];
  const meta = new Map(v.pages.map((p) => [p.path, p]));
  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">Every page <span className="text-xs font-normal text-neutral-500">{v.pageRows?.period ?? ""}</span></h2>
        {all.length ? (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><th className={th}>Page</th><th className={th}>Title</th><th className={th}>Clicks</th><th className={th}>Before</th><th className={th}>Shown</th><th className={th}>Position</th><th className={th}>To fix</th></tr></thead>
            <tbody>{all.sort((a, b) => (traffic.get(b)?.clicks ?? 0) - (traffic.get(a)?.clicks ?? 0)).map((path) => {
              const t = traffic.get(path);
              const m = meta.get(path);
              const is = issues(path);
              return <tr key={path} className="border-t border-neutral-100"><td className={td}>{path}</td><td className={`${td} max-w-xs truncate text-neutral-600`}>{m?.title || <span className="text-red-600">No title</span>}</td><td className={td}>{t?.clicks ?? 0}</td><td className={`${td} text-neutral-500`}>{t?.prevClicks ?? 0}</td><td className={td}>{t?.impressions ?? 0}</td><td className={td}>{pos(t?.position)}</td><td className={td}>{is.length ? <a href={`#${is[0].id}`} className="underline">{is.length} pending</a> : <span className="text-neutral-400">-</span>}</td></tr>;
            })}</tbody>
          </table></div>
        ) : <p className="p-4 text-sm text-neutral-500">The site hasn&apos;t been read yet. Press Run a full check now.</p>}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pages to create</h2>
        <p className="text-sm text-neutral-600">At most 3 new pages go live on a site each week, and each needs something real from that town: a job, a photo or a review.</p>
        {cards(open.filter((a) => ["new_page", "cost_guide", "comparison"].includes(a.kind)), "No gaps found. Every service and town in the plan has a page.")}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Fixes to existing pages</h2>
        {cards(open.filter((a) => (a.type === "Page" || a.type === "Technical" || a.type === "AI search") && a.draft?.target !== "manual"), "Nothing to fix right now.")}
      </section>
    </div>
  );
}

function Profile({ v, open, cards }: { v: ClientView; open: SeoAction[]; cards: Cards }) {
  const p = v.settings.state.gbp?.profile;
  const gbp = v.settings.state.gbp;
  const row = (label: string, value: React.ReactNode, ok: boolean) => <tr className="border-t border-neutral-100"><td className="py-2 pr-3 text-neutral-600">{label}</td><td className="py-2">{value}</td><td className="py-2 text-right">{ok ? <Pill cls="bg-green-100 text-green-800">Good</Pill> : <Pill cls="bg-amber-100 text-amber-800">To do</Pill>}</td></tr>;
  const days = p?.lastPostAt ? Math.round((new Date().getTime() - Date.parse(p.lastPostAt)) / 86_400_000) : null;
  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <h2 className="font-semibold">Profile check</h2>
          {p ? (
            <table className="mt-2 w-full text-sm"><tbody>
              {row("Main category", p.primaryCategory ?? "-", !!p.primaryCategory)}
              {row("Other categories", (p.categories ?? []).join(", ") || "None", (p.categories ?? []).length >= 2)}
              {row("Description", p.description ? `${p.description.length} of 750 characters` : "None", (p.description ?? "").length >= 250)}
              {row("Opening hours", p.hasHours ? "Set" : "Missing", !!p.hasHours)}
              {row("Services listed", String(p.services ?? 0), (p.services ?? 0) > 0)}
              {row("Service area", `${(p.serviceAreas ?? []).length} of 20 places`, (p.serviceAreas ?? []).length >= Math.min(5, (v.settings.config.towns ?? []).length))}
              {row("Last post", days === null ? "Never" : `${days} days ago`, days !== null && days <= 7)}
              {row("Editing from here", gbp?.write ? "Allowed" : "Not allowed yet", !!gbp?.write)}
            </tbody></table>
          ) : <p className="mt-2 text-sm text-neutral-500">{gbp?.error ?? "Not connected yet. The Business Profile badge above shows what to send the client."} Until then, profile items arrive as guided tasks.</p>}
          <p className="mt-3 text-xs text-neutral-500">Photos: add 2 to 3 real job photos a month. Fresh photos of local work are one of the strongest signals for trades. The business name and address are never changed from here, and a change of main category always asks first: those can trigger Google re-verification.</p>
        </div>
        <div className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">Reviews against competitors</h2>
          <p className="text-2xl font-semibold">{v.reviewCount ?? v.pace.ours} <span className="text-sm font-normal text-neutral-500">reviews{v.rating ? `, ${v.rating} stars` : ""}</span></p>
          <p className="text-sm text-neutral-700">{v.pace.text}</p>
          {v.pace.leader && v.pace.gap > 0 && <p className="rounded-lg bg-neutral-50 p-3 text-sm"><span className="font-medium">Target: {v.pace.perWeek} new review{v.pace.perWeek === 1 ? "" : "s"} a week.</span> {v.pace.last90} came in over the last 90 days.</p>}
          <Spark points={v.weeks.map((w) => ({ week: w.week, value: w.calls ?? 0 }))} label="Calls from the profile" />
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Profile and review items</h2>
        {cards(open.filter((a) => a.type === "Profile" || a.type === "Reviews"), "Nothing waiting on the profile.")}
      </section>
    </div>
  );
}

function Competitors({ v, open, cards }: { v: ClientView; open: SeoAction[]; cards: Cards }) {
  const mine = v.settings.state.gbp?.profile;
  const theirs = [...new Set(v.competitors.flatMap((c) => c.top.filter((t) => !t.isClient).map((t) => t.category ?? "")).filter(Boolean))];
  const missing = theirs.filter((c) => c !== mine?.primaryCategory && !(mine?.categories ?? []).includes(c));
  return (
    <div className="space-y-6">
      {!v.competitors.length && <p className="text-sm text-neutral-500">No competitor check yet. It runs weekly once the Google API key is added (the badge above shows how). It stays inside Google&apos;s free monthly allowance.</p>}
      {missing.length > 0 && <p className={`${card} p-4 text-sm`}><span className="font-medium">What they have that this client doesn&apos;t: </span>categories {missing.join(", ")}. Only add ones that are true for this business.</p>}
      {v.competitors.map((c) => {
        const hist = v.ranks.filter((r) => r.query === c.query);
        return (
          <section key={c.query} className={card}>
            <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">&quot;{c.query}&quot; on Google Maps <span className="text-xs font-normal text-neutral-500">checked {c.checkedOn} · this client: {c.clientRank ? `position ${c.clientRank}` : "not in the top 10"}{hist.length > 1 ? ` · was ${hist[0].client_rank ?? "outside"} on ${hist[0].checked_on}` : ""}</span></h2>
            <table className="w-full">
              <thead><tr><th className={th}>#</th><th className={th}>Business</th><th className={th}>Reviews</th><th className={th}>Stars</th><th className={th}>Category</th></tr></thead>
              <tbody>{c.top.slice(0, 8).map((t, i) => <tr key={t.placeId} className={`border-t border-neutral-100 ${t.isClient ? "bg-green-50 font-medium" : ""}`}><td className={td}>{i + 1}</td><td className={td}>{t.name}{t.isClient ? " (this client)" : ""}</td><td className={td}>{t.reviews ?? "-"}</td><td className={td}>{t.rating ?? "-"}</td><td className={`${td} text-neutral-600`}>{t.category ?? "-"}</td></tr>)}</tbody>
            </table>
          </section>
        );
      })}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What to do about it</h2>
        {cards(open.filter((a) => ["map_rank", "spam_competitor", "review_pace", "gbp_categories"].includes(a.kind)), "Nothing to act on here right now.")}
      </section>
      <p className="text-xs text-neutral-500">Competitors&apos; names and ratings are fetched fresh each week and only the latest check is kept, in line with Google&apos;s terms. The client&apos;s own position is kept as history.</p>
    </div>
  );
}

function Ai({ v, open, cards }: { v: ClientView; open: SeoAction[]; cards: Cards }) {
  const days = [...new Set(v.aiChecks.map((c) => c.checked_on))].sort();
  const latest = v.aiChecks.filter((c) => c.checked_on === days[days.length - 1]);
  const share = (rows: typeof latest) => (rows.length ? Math.round((rows.filter((c) => c.named).length / rows.length) * 100) : 0);
  const onlyClaude = latest.length > 0 && latest.every((c) => c.provider === "claude");
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Named in AI answers" value={latest.length ? `${latest.filter((c) => c.named).length} of ${latest.length}` : "-"} sub={latest.length ? `Checked ${days[days.length - 1]}` : "Not checked yet"} />
        {["gemini", "chatgpt", "perplexity", "claude"].filter((p) => latest.some((c) => c.provider === p)).map((p) => <Stat key={p} label={p === "gemini" ? "Gemini (Google's AI)" : p === "chatgpt" ? "ChatGPT" : p === "perplexity" ? "Perplexity" : "Claude"} value={`${share(latest.filter((c) => c.provider === p))}%`} sub="of answers name the business" />)}
      </section>
      {onlyClaude && <p className="rounded-lg bg-neutral-100 p-3 text-sm text-neutral-700">Claude only: these checks use Claude&apos;s web search until Gemini and ChatGPT keys are added. It&apos;s a fair guide, but each AI tool leans on different sources.</p>}
      {days.length > 1 && <div className={`${card} p-4`}><Spark points={days.map((d) => ({ week: d, value: share(v.aiChecks.filter((c) => c.checked_on === d)) }))} label="Share of AI answers naming the business (%)" /></div>}
      {!latest.length && <p className="text-sm text-neutral-500">The first check runs on the next weekly run. It asks each connected AI tool the questions a customer would, and records whether the business is named and which sites the answer leaned on.</p>}
      {latest.length > 0 && (
        <section className={card}>
          <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">Latest answers</h2>
          <div className="divide-y divide-neutral-100">{latest.map((c, i) => (
            <details key={i} className="p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm"><Pill cls={c.named ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>{c.named ? "Named" : "Not named"}</Pill><span className="text-neutral-500">{c.provider}</span><span>{c.question}</span></summary>
              <p className="mt-2 text-sm text-neutral-700">{c.excerpt}</p>
              {c.sources.length > 0 && <p className="mt-2 text-xs text-neutral-500">Sources it leaned on: {c.sources.map((s, j) => <a key={j} href={s.url} target="_blank" rel="noreferrer" className="mr-2 underline">{s.title ?? new URL(s.url).hostname}</a>)}</p>}
            </details>
          ))}</div>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What to fix</h2>
        {cards(open.filter((a) => a.type === "AI search"), "Nothing to fix for AI search right now.")}
      </section>
    </div>
  );
}

function Citations({ v, open, cards, back }: { v: ClientView; open: SeoAction[]; cards: Cards; back: string }) {
  const rows = new Map(v.citations.map((c) => [c.directory, c]));
  return (
    <div className="space-y-6">
      <section className={`${card} p-4`}>
        <h2 className="font-semibold">The details to use everywhere</h2>
        <p className="mt-1 text-sm text-neutral-600">Same name, address and phone on every listing. Copy each field straight into the directory&apos;s form.</p>
        <div className="mt-3 divide-y divide-neutral-100">{v.copy.map((c) => <div key={c.label} className="flex items-start justify-between gap-3 py-2 text-sm"><div><p className="text-xs text-neutral-500">{c.label}</p><p>{c.value}</p></div><CopyButton text={c.value} /></div>)}</div>
        {!v.copy.length && <p className="mt-2 text-sm text-neutral-500">Fill in the fact sheet under Settings first.</p>}
      </section>
      <section className={card}>
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">Directory checklist <span className="text-xs font-normal text-neutral-500">{v.citations.filter((c) => c.status === "listed").length} of {v.directories.length} listed</span></h2>
        <div className="divide-y divide-neutral-100">{v.directories.map((d) => {
          const r = rows.get(d.key);
          return (
            <form key={d.key} action={saveCitation} className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <input type="hidden" name="clientId" value={v.clientId} /><input type="hidden" name="directory" value={d.key} /><input type="hidden" name="back" value={back} />
              <div className="min-w-0 flex-1"><p className="font-medium"><a href={d.url} target="_blank" rel="noreferrer" className="underline">{d.name}</a> {r?.status === "listed" && <Pill cls="bg-green-100 text-green-800">Listed</Pill>}</p><p className="text-xs text-neutral-500">{d.why}</p></div>
              <input name="url" defaultValue={r?.url ?? ""} placeholder="Listing address (optional)" className={`${input} w-56`} />
              <select name="status" defaultValue={r?.status ?? "todo"} className={input}><option value="todo">To do</option><option value="listed">Listed</option><option value="skip">Skip</option></select>
              <button className={btnQuiet}>Save</button>
            </form>
          );
        })}</div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Local links and mentions</h2>
        <p className="text-sm text-neutral-600">Found each month with web search. Each has a short email ready to copy. Nothing is ever sent automatically.</p>
        {cards(open.filter((a) => ["link_outreach", "mention_link", "forum_reply", "citations", "ai_visibility"].includes(a.kind)), "No link ideas yet. The monthly search needs the Claude API key.")}
      </section>
    </div>
  );
}

function Results({ v, country, back }: { v: ClientView; country: "GB" | "US"; back: string }) {
  const r = v.results;
  const leads = (m: (typeof r)[number]) => m.profileCalls + m.siteCalls + m.forms + m.enquiries;
  const job = v.settings.config.jobValueGbp;
  return (
    <div className="space-y-6">
      <section className={`${card} flex flex-wrap items-center justify-between gap-3 p-4`}>
        <div className="min-w-0">
          <h2 className="font-semibold">The client&apos;s progress page</h2>
          <p className="text-sm text-neutral-600">A private page in plain words: calls, reviews, Maps, search, AI search, what was done and what&apos;s next. No login needed. Email it, text it, or open it on a call.</p>
          <p className="mt-1 truncate text-xs text-neutral-500">{v.reportUrl}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={v.reportUrl} target="_blank" rel="noreferrer" className={btnQuiet}>Open it</a>
          <CopyButton text={v.reportUrl} label="Copy link" />
          <form action={draftWeekly}><input type="hidden" name="clientId" value={v.clientId} /><input type="hidden" name="back" value={back} /><button className={btn}>Draft this week&apos;s email</button></form>
        </div>
      </section>
      <section className={`${card} p-4`}><Spark points={r.map((m) => ({ week: m.month, value: leads(m) }))} label="Leads from Google and the website each month" height={80} /></section>
      <section className={card}>
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">Leads by month</h2>
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr><th className={th}>Month</th><th className={th}>Profile calls</th><th className={th}>Directions</th><th className={th}>Profile to website</th><th className={th}>Website call taps</th><th className={th}>Website forms</th><th className={th}>Platform enquiries</th><th className={th}>Calls to ASC number</th><th className={th}>Visits from AI tools</th><th className={th}>Leads</th></tr></thead>
          <tbody>{[...r].reverse().map((m) => <tr key={m.month} className="border-t border-neutral-100"><td className={td}>{new Date(`${m.month}-15`).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</td><td className={td}>{m.profileCalls}</td><td className={td}>{m.directions}</td><td className={td}>{m.profileWebsite}</td><td className={td}>{m.siteCalls}</td><td className={td}>{m.forms}</td><td className={td}>{m.enquiries}</td><td className={td}>{m.ascCalls}</td><td className={td}>{m.aiVisits}</td><td className={`${td} font-semibold`}>{leads(m)}</td></tr>)}</tbody>
        </table></div>
      </section>
      <p className="text-xs text-neutral-500">Leads = calls from the Business Profile + call taps and forms on the website + enquiries through the platform. Calls to the ASC number are shown beside them, not added in, because many of those callers also tapped the profile or the site. Website and AI figures need the tracking script.{job ? ` At an average job of ${money(job, country)}, last month's ${r.length > 1 ? leads(r[r.length - 2]) : 0} leads would be worth about ${money((r.length > 1 ? leads(r[r.length - 2]) : 0) * job * (v.settings.config.closeRate ?? 0.33), country)} if ${Math.round((v.settings.config.closeRate ?? 0.33) * 100)}% became jobs.` : ""}</p>
    </div>
  );
}

function Changes({ v, back }: { v: ClientView; back: string }) {
  const byId = new Map(v.actions.map((a) => [a.id, a]));
  const measured = v.actions.filter((a) => a.result && a.result.verdict !== "too early");
  const worked = measured.filter((a) => a.result!.verdict === "worked").length;
  const show = (x: unknown) => (x == null ? "" : typeof x === "string" ? x : JSON.stringify(x, null, 1).replace(/[{}[\]"]/g, "").trim());
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{v.changes.length} change{v.changes.length === 1 ? "" : "s"} made. {measured.length ? `${worked} of ${measured.length} measured so far worked.` : "None measured yet: each is checked 28 days after it goes live."}</p>
      <section className={`${card} divide-y divide-neutral-100`}>
        {!v.changes.length && <p className="p-4 text-sm text-neutral-500">Nothing has been changed yet.</p>}
        {v.changes.map((c) => {
          const a = c.action_id ? byId.get(c.action_id) : undefined;
          return (
            <details key={c.id} className="p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 text-sm">
                <span><span className="text-neutral-500">{fmt(c.created_at)}</span> · <span className="font-medium">{c.summary}</span> {c.auto && <Pill cls="bg-neutral-200 text-neutral-700">Auto</Pill>} {c.undone_at && <Pill cls="bg-red-100 text-red-800">Undone</Pill>} {a?.result && <Pill cls={a.result.verdict === "worked" ? "bg-green-100 text-green-800" : a.result.verdict === "worse" ? "bg-red-100 text-red-800" : "bg-neutral-200 text-neutral-700"}>{a.result.verdict}</Pill>}</span>
                {!c.undone_at && <form action={undo}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="back" value={back} /><button className={btnQuiet}>Undo</button></form>}
              </summary>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div><p className="text-xs text-neutral-500">Before</p><pre className="whitespace-pre-wrap rounded-lg bg-red-50 p-2 font-sans text-xs">{show(c.before) || "(nothing)"}</pre></div>
                <div><p className="text-xs text-neutral-500">After</p><pre className="whitespace-pre-wrap rounded-lg bg-green-50 p-2 font-sans text-xs">{show(c.after) || "(see the item)"}</pre></div>
              </div>
              {a?.result && <p className="mt-2 text-sm text-neutral-700">{a.result.text}</p>}
            </details>
          );
        })}
      </section>
    </div>
  );
}

function Settings({ v, back }: { v: ClientView; back: string }) {
  const c = v.settings.config;
  const f = c.facts ?? {};
  const label = "block text-xs font-medium text-neutral-600";
  const field = `${input} mt-1 w-full`;
  const tracking = `<script defer src="${seoEnv.appUrl()}/seo-t.js" data-t="${v.settings.tracking_token}"></script>`;
  return (
    <div className="space-y-6">
      {!v.demo && (
        <form action={setEnabled} className={`${card} flex flex-wrap items-center justify-between gap-3 p-4`}>
          <input type="hidden" name="clientId" value={v.clientId} /><input type="hidden" name="back" value={back} /><input type="hidden" name="enabled" value={v.settings.enabled ? "0" : "1"} />
          <p className="text-sm"><span className="font-medium">The autopilot is {v.settings.enabled ? "on" : "off"} for this client.</span> {v.settings.enabled ? "It checks every morning from 5am." : "Nothing runs until it's switched on."}</p>
          <button className={v.settings.enabled ? btnQuiet : btn}>{v.settings.enabled ? "Switch off" : "Switch on"}</button>
        </form>
      )}
      <form action={saveSettings} className="space-y-6">
        <input type="hidden" name="clientId" value={v.clientId} /><input type="hidden" name="back" value={back} />
        <section className={`${card} grid gap-4 p-4 sm:grid-cols-2`}>
          <h2 className="font-semibold sm:col-span-2">Site</h2>
          <label className={label}>Domain<input name="domain" defaultValue={c.domain ?? ""} className={field} /></label>
          <label className={label}>Site type<select name="siteType" defaultValue={c.siteType ?? "other"} className={field}><option value="vercel">Own Vercel project (GitHub repo)</option><option value="hosted">Hosted on the ASC platform</option><option value="wordpress">WordPress</option><option value="other">Other (change lists)</option></select></label>
          <label className={label}>GitHub repo (owner/name)<input name="githubRepo" defaultValue={c.githubRepo ?? ""} placeholder="ascdevelopment181202/site-repo" className={field} /></label>
          <label className={label}>Monthly AI budget (£)<input name="aiBudgetGbp" type="number" step="0.5" min="0" defaultValue={c.aiBudgetGbp ?? 3} className={field} /><span className="mt-1 block font-normal text-neutral-500">£{v.spend.spent.toFixed(2)} used this month.</span></label>
          <label className={label}>WordPress address<input name="wpUrl" defaultValue={c.wpUrl ?? ""} className={field} /></label>
          <label className={label}>WordPress username<input name="wpUser" defaultValue={c.wpUser ?? ""} className={field} /></label>
          <label className={label}>WordPress application password {c.wpPasswordEnc && <span className="font-normal text-green-700">(saved)</span>}<input name="wpPassword" type="password" autoComplete="new-password" placeholder={c.wpPasswordEnc ? "Leave blank to keep" : ""} className={field} /></label>
        </section>
        <section className={`${card} grid gap-4 p-4 sm:grid-cols-2`}>
          <h2 className="font-semibold sm:col-span-2">Plan</h2>
          <label className={label}>Trade<input name="trade" defaultValue={c.trade ?? ""} placeholder="driveways" className={field} /></label>
          <label className={label}>Average job value (£)<input name="jobValueGbp" type="number" defaultValue={c.jobValueGbp ?? ""} placeholder="Typical for the trade until set" className={field} /></label>
          <label className={label}>Services, one per line<textarea name="services" rows={6} defaultValue={(c.services ?? []).join("\n")} className={field} /></label>
          <label className={label}>Towns, one per line, most important first<textarea name="towns" rows={6} defaultValue={(c.towns ?? []).join("\n")} className={field} /></label>
          <label className={label}>Brand terms (searches that are just the business name)<input name="brandTerms" defaultValue={(c.brandTerms ?? []).join(", ")} className={field} /></label>
          <label className={label}>Competitors to ignore<input name="ignoreCompetitors" defaultValue={(c.ignoreCompetitors ?? []).join(", ")} className={field} /></label>
          <label className={label}>Enquiries that become jobs (%), blank for 1 in 3<input name="closeRatePct" type="number" step="1" defaultValue={c.closeRate ? Math.round(c.closeRate * 100) : ""} className={field} /></label>
          <label className={label}>Enquiry rate (%), blank to use tracking<input name="enquiryRatePct" type="number" step="0.1" defaultValue={c.enquiryRate ? c.enquiryRate * 100 : ""} className={field} /></label>
          <label className={label}>Profiles elsewhere (Facebook, Checkatrade, Yell...), one address per line<textarea name="profiles" rows={3} defaultValue={Object.values(c.profiles ?? {}).join("\n")} className={field} /></label>
        </section>
        <section className={`${card} grid gap-4 p-4 sm:grid-cols-2`}>
          <div className="sm:col-span-2"><h2 className="font-semibold">Fact sheet</h2><p className="text-xs text-neutral-500">The AI may only state what&apos;s written here. Anything missing is left as a gap for you, never made up.</p></div>
          <label className={label}>Business name<input name="businessName" defaultValue={f.businessName ?? ""} className={field} /></label>
          <label className={label}>Phone<input name="phone" defaultValue={f.phone ?? ""} className={field} /></label>
          <label className={label}>Email<input name="email" defaultValue={f.email ?? ""} className={field} /></label>
          <label className={label}>Address<input name="address" defaultValue={f.address ?? ""} className={field} /></label>
          <label className={label}>Years trading<input name="yearsTrading" defaultValue={f.yearsTrading ?? ""} placeholder="Trading since 2009" className={field} /></label>
          <label className={label}>Accreditations<input name="accreditations" defaultValue={(f.accreditations ?? []).join(", ")} placeholder="Gas Safe, Checkatrade" className={field} /></label>
          <label className={label}>Guarantees<input name="guarantees" defaultValue={f.guarantees ?? ""} className={field} /></label>
          <label className={label}>Price ranges<input name="priceRanges" defaultValue={f.priceRanges ?? ""} placeholder="Block paving from £95 per m²" className={field} /></label>
          <label className={label}>Team<input name="team" defaultValue={f.team ?? ""} className={field} /></label>
          <label className={`${label} sm:col-span-2`}>About (one or two sentences, in their words)<textarea name="about" rows={2} defaultValue={f.about ?? ""} className={field} /></label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="confirmed" defaultChecked={!!f.confirmed} /> I&apos;ve checked these facts are right</label>
        </section>
        <section className={`${card} space-y-2 p-4`}>
          <h2 className="font-semibold">Apply without asking</h2>
          <p className="text-xs text-neutral-500">Off by default. Only these four safe kinds can ever apply on their own, and website changes still have to pass the preview build and the visual check. Everything else always waits for Approve.</p>
          {([["titles", "Page titles and descriptions"], ["schema", "Structured data"], ["faq", "Answer blocks and FAQs"], ["posts", "Weekly Business Profile posts"]] as const).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`auto:${k}`} defaultChecked={!!c.autoApply?.[k]} /> {l}</label>)}
        </section>
        <section className={`${card} space-y-2 p-4`}>
          <h2 className="font-semibold">Emails to the client</h2>
          <p className="text-xs text-neutral-500">Plain, short updates in the client&apos;s language. They never show this dashboard. Each lands in the inbox as a draft with a Send button.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="weeklyReport" defaultChecked={c.weeklyReport !== false} /> Draft a weekly progress email every Monday</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="weeklyReportAuto" defaultChecked={!!c.weeklyReportAuto} /> Send the weekly email without asking me first</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clientReport" defaultChecked={!!c.clientReport} /> Draft a monthly results email</label>
        </section>
        <button className={btn}>Save settings</button>
      </form>
      <section className={`${card} space-y-2 p-4 text-sm`}>
        <h2 className="font-semibold">Tracking script</h2>
        <p className="text-neutral-600">The launch check adds this for you. For a site edited by hand, paste it before the closing body tag on every page.</p>
        <pre className="overflow-x-auto rounded-lg bg-neutral-50 p-2 text-xs">{tracking}</pre>
        <CopyButton text={tracking} />
      </section>
    </div>
  );
}
