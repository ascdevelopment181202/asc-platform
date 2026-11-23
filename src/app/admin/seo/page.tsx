import Link from "next/link";
import { notFound } from "next/navigation";
import { seoEnv } from "@/lib/env";
import { db } from "@/lib/supabase";
import { aiBlocked } from "@/lib/seo/ai";
import { DEMO_ID, demoView } from "@/lib/seo/demo";
import { isSafe } from "@/lib/seo/safe";
import { allSettings, globalPaused } from "@/lib/seo/store";
import { googleUpdates, trackRecord } from "@/lib/seo/strategist";
import type { ActionType, WeeklyReview } from "@/lib/seo/types";
import { TYPE_ORDER } from "@/lib/seo/types";
import { inboxItems, type InboxItem } from "@/lib/seo/view";
import { shotUrl } from "@/lib/seo/visual";
import { btn, btnQuiet } from "../ui";
import { approveAllSafe, setPaused } from "./actions";
import { InboxKeys } from "./client";
import { ActionCard, card, Msg, Pill } from "./ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 15;
const isManual = (i: InboxItem) => i.action.type === "Manual" || i.action.draft?.target === "manual";

export default async function SeoInbox({ searchParams }: { searchParams: Promise<{ msg?: string; client?: string; type?: string; demo?: string; open?: string }> }) {
  if (!seoEnv.on()) notFound();
  const sp = await searchParams;
  const [settings, paused, updates, track, blocked] = await Promise.all([allSettings(), globalPaused(), googleUpdates(), trackRecord(), aiBlocked(null)]);
  const first = await inboxItems();
  // The demo client shows until there's a real inbox to look at, or whenever it's asked for.
  const showDemo = sp.demo === "1" || (sp.demo !== "0" && first.items.length < 3);
  const { items: all, clients } = showDemo ? await inboxItems({ demo: true }) : first;

  const filtered = all.filter((i) => (!sp.client || i.action.client_id === sp.client) && (!sp.type || i.action.type === sp.type));
  filtered.sort((a, b) => Number(!!b.action.detail.alert) - Number(!!a.action.detail.alert) || b.action.score - a.action.score);
  const manual = filtered.filter(isManual);
  const main = filtered.filter((i) => !isManual(i));
  const shown = main.slice(0, MAX);
  const alerts = all.filter((i) => i.action.detail.alert);
  const safe = shown.filter((i) => !i.demo && i.action.status === "new" && isSafe(i.action));
  const minutes = Math.max(1, Math.round(shown.length * 0.5 + manual.reduce((n, i) => n + (i.action.draft?.minutes ?? 5), 0)));

  // This week's diagnosis for each client, shown above their items.
  const ids = [...new Set(shown.map((i) => i.action.client_id))];
  const { data: reviews } = ids.length ? await db().from("seo_plans").select("client_id, content, period").eq("kind", "weekly").in("client_id", ids.filter((x) => x !== DEMO_ID)).order("period", { ascending: false }).returns<{ client_id: string; content: WeeklyReview; period: string }[]>() : { data: [] };
  const review = new Map<string, WeeklyReview>();
  for (const r of reviews ?? []) if (!review.has(r.client_id)) review.set(r.client_id, r.content);
  if (ids.includes(DEMO_ID)) review.set(DEMO_ID, demoView().review!);

  // Screenshots are private files: sign a short-lived link for each one on screen.
  const shots: Record<string, string> = {};
  for (const i of shown) for (const s of i.action.apply?.visual?.shots ?? []) for (const p of [s.before, s.after]) if (p) shots[p] = (await shotUrl(p)) ?? "";

  const disconnected = settings.filter((s) => s.enabled && ((s.state.gsc && !s.state.gsc.ok) || (s.state.gbp && !s.state.gbp.ok)));
  const qs = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ client: sp.client, type: sp.type, demo: sp.demo, ...patch })) if (v) q.set(k, v);
    const s = q.toString();
    return `/admin/seo${s ? `?${s}` : ""}`;
  };
  const back = qs({});
  const nameOf = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <InboxKeys />
      <Msg msg={sp.msg} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">SEO inbox</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {main.length + manual.length === 0 ? "Nothing waiting. The next check runs at 5am." : `${main.length} to approve${alerts.length ? `, ${alerts.length} alert${alerts.length === 1 ? "" : "s"}` : ""}${manual.length ? `, ${manual.length} by hand` : ""}. About ${minutes} minute${minutes === 1 ? "" : "s"}.`}
            <span className="ml-2 text-xs text-neutral-400">Keys: j and k move, Enter opens, a approves, d dismisses.</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {safe.length > 0 && (
            <form action={approveAllSafe}>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="client" value={sp.client ?? ""} />
              <button className={btn}>Approve all safe ({safe.length})</button>
            </form>
          )}
          <Link href="/admin/seo/connections" className={btnQuiet}>Connections</Link>
          <Link href="/admin/seo/strategy" className={btnQuiet}>Strategy</Link>
          <form action={setPaused}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="paused" value={paused ? "0" : "1"} />
            <button className={paused ? btn : btnQuiet}>{paused ? "Resume all" : "Pause all"}</button>
          </form>
        </div>
      </div>

      {paused && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Everything is paused. Checks still run and the inbox still fills, but no change, post or pull request goes out until you press Resume all.</p>}
      {blocked && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{blocked}</p>}
      {!seoEnv.anthropicKey() && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The Claude API key isn&apos;t added yet, so the checks run but fixes that need writing wait. Add ANTHROPIC_API_KEY in Vercel. <Link href="/admin/seo/connections" className="underline">How</Link></p>}
      {disconnected.map((s) => (
        <p key={s.client_id} className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {nameOf.get(s.client_id) ?? "A client"}: {s.state.gsc && !s.state.gsc.ok ? "Search Console" : "Business Profile"} has disconnected. <Link href={`/admin/seo/${s.client_id}`} className="underline">See what to do</Link>
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-500">Client:</span>
        <Link href={qs({ client: undefined })} className={!sp.client ? "font-medium underline" : "text-neutral-600 hover:underline"}>All</Link>
        {clients.map((c) => <Link key={c.id} href={qs({ client: c.id })} className={sp.client === c.id ? "font-medium underline" : "text-neutral-600 hover:underline"}>{c.name}</Link>)}
        <span className="ml-3 text-neutral-500">Type:</span>
        <Link href={qs({ type: undefined })} className={!sp.type ? "font-medium underline" : "text-neutral-600 hover:underline"}>All</Link>
        {TYPE_ORDER.filter((t) => all.some((i) => i.action.type === t)).map((t: ActionType) => <Link key={t} href={qs({ type: t })} className={sp.type === t ? "font-medium underline" : "text-neutral-600 hover:underline"}>{t}</Link>)}
        <Link href={qs({ demo: showDemo ? "0" : "1" })} className="ml-auto text-xs text-neutral-500 underline">{showDemo ? "Hide the demo client" : "Show the demo client"}</Link>
      </div>

      {ids.map((id) => {
        const mine = shown.filter((i) => i.action.client_id === id);
        const r = review.get(id);
        return (
          <section key={id} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                <Link href={`/admin/seo/${id}`} className="hover:underline">{mine[0].clientName}</Link>
                {mine[0].demo && <span className="ml-2 align-middle"><Pill cls="bg-neutral-900 text-white">Demo: sample data</Pill></span>}
              </h2>
              <span className="text-xs text-neutral-500">This week&apos;s plan: {mine.length} item{mine.length === 1 ? "" : "s"}</span>
            </div>
            {r && <p className={`${card} p-3 text-sm text-neutral-700`}><span className="font-medium">This week: </span>{r.diagnosis}</p>}
            {mine.map((i) => <ActionCard key={i.action.id} a={i.action} clientName={i.clientName} country={i.country} demo={i.demo} back={back} track={track} updates={updates} open={sp.open === i.action.id} shots={shots} showClient={false} />)}
          </section>
        );
      })}
      {main.length > MAX && <p className="text-sm text-neutral-500">Showing the top {MAX} of {main.length}. Clear these and the next ones appear.</p>}

      {manual.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">By hand this week</h2>
            <span className="text-xs text-neutral-500">About {manual.reduce((n, i) => n + (i.action.draft?.minutes ?? 5), 0)} minutes in one sitting. Each has its steps, links and text ready to copy.</span>
          </div>
          {manual.slice(0, 12).map((i) => <ActionCard key={i.action.id} a={i.action} clientName={i.clientName} country={i.country} demo={i.demo} back={back} track={track} updates={updates} open={sp.open === i.action.id} />)}
        </section>
      )}
    </div>
  );
}
