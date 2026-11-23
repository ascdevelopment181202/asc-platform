import Link from "next/link";
import { notFound } from "next/navigation";
import { seoEnv } from "@/lib/env";
import { aiSpend } from "@/lib/seo/ai";
import { placesUsed } from "@/lib/seo/places";
import { globalPaused, kvGet } from "@/lib/seo/store";
import { getPlaybook, googleUpdates, trackRecord } from "@/lib/seo/strategist";
import { btn, btnQuiet, input } from "../../ui";
import { clearProposal, savePlaybook, setPaused } from "../actions";
import { card, Msg, Stat } from "../ui";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { title_rewrite: "Title and description rewrites", meta_fix: "Title and description fixes", answer_block: "Answer blocks", new_page: "New town pages", cost_guide: "Cost guides", page_refresh: "Page refreshes", page_boost: "Page boosts", gbp_description: "Profile descriptions", gbp_post: "Profile posts", gbp_utm: "Profile link tags", schema_local: "Business schema", faq_schema: "FAQ markup", launch_check: "Launch checks" };

export default async function Strategy({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  if (!seoEnv.on()) notFound();
  const { msg } = await searchParams;
  const [playbook, proposal, updates, track, paused, spend, places] = await Promise.all([getPlaybook(), kvGet<{ quarter: string; text: string; sources?: { url: string; title?: string }[] }>("playbook_proposal"), googleUpdates(), trackRecord(), globalPaused(), aiSpend(null), placesUsed()]);
  const rows = Object.entries(track).sort((a, b) => b[1].total - a[1].total);
  return (
    <div className="space-y-6">
      <Msg msg={msg} />
      <div>
        <p className="text-xs text-neutral-500"><Link href="/admin/seo" className="underline">SEO inbox</Link></p>
        <h1 className="mt-1 text-2xl font-semibold">Strategy</h1>
        <p className="mt-1 text-sm text-neutral-600">The playbook the strategist follows, what has worked so far, Google&apos;s updates, and the spending limits.</p>
      </div>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="AI spend this month" value={`£${spend.spent.toFixed(2)}`} sub={`Hard stop at £${spend.cap} across all clients`} />
        <Stat label="Google Places calls" value={places} sub="Paused at 900 a month, inside the free allowance" />
        <Stat label="Changes measured" value={rows.reduce((n, [, r]) => n + r.total, 0)} sub="Across every client" />
        <form action={setPaused} className={`${card} flex flex-col justify-between p-4`}>
          <input type="hidden" name="back" value="/admin/seo/strategy" /><input type="hidden" name="paused" value={paused ? "0" : "1"} />
          <p className="text-xs text-neutral-500">One switch for everything</p>
          <p className="text-sm">{paused ? "Paused: nothing is being applied for any client." : "Running."}</p>
          <button className={paused ? btn : btnQuiet}>{paused ? "Resume all" : "Pause all changes"}</button>
        </form>
      </section>

      {proposal?.text && (
        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">Suggested playbook updates ({proposal.quarter})</h2>
          <p className="text-xs text-neutral-500">Researched from what changed in local SEO and AI search this quarter. Copy what you agree with into the playbook below, then mark it reviewed.</p>
          <pre className="whitespace-pre-wrap font-sans text-sm">{proposal.text}</pre>
          {proposal.sources && proposal.sources.length > 0 && <p className="text-xs text-neutral-500">Sources: {proposal.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="mr-2 underline">{s.title ?? s.url}</a>)}</p>}
          <form action={clearProposal}><input type="hidden" name="back" value="/admin/seo/strategy" /><button className={btnQuiet}>Mark reviewed</button></form>
        </section>
      )}

      <form action={savePlaybook} className={`${card} space-y-3 p-4`}>
        <input type="hidden" name="back" value="/admin/seo/strategy" />
        <h2 className="font-semibold">Playbook</h2>
        <p className="text-xs text-neutral-500">The strategist reads this before writing every 90-day plan. Edit it to change how it thinks. Every quarter it researches what changed and suggests updates here for you to approve.</p>
        <textarea name="text" rows={18} defaultValue={playbook.text} className={`${input} w-full`} />
        <button className={btn}>Save playbook</button>
      </form>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <h2 className="font-semibold">What has worked</h2>
          <p className="text-xs text-neutral-500">Every change is measured 28 days after it goes live, against the rest of the site. Proven fixes are suggested to other clients in the same trade first.</p>
          {rows.length ? <table className="mt-3 w-full text-sm"><tbody>{rows.map(([k, r]) => <tr key={k} className="border-t border-neutral-100"><td className="py-1.5">{KIND[k] ?? k.replace(/_/g, " ")}</td><td className="py-1.5 text-right">{r.worked} of {r.total} worked</td></tr>)}</tbody></table> : <p className="mt-3 text-sm text-neutral-500">Nothing measured yet. The first results arrive about a month after the first approvals.</p>}
        </div>
        <div className={`${card} p-4`}>
          <h2 className="font-semibold">Google&apos;s confirmed ranking updates</h2>
          <p className="text-xs text-neutral-500">Marked on every chart as a dashed line. A drop across a whole site in the same week as an update isn&apos;t treated as that client&apos;s problem.</p>
          {updates.length ? <ul className="mt-3 text-sm">{[...updates].reverse().slice(0, 10).map((u) => <li key={u.date + u.name} className="flex justify-between border-t border-neutral-100 py-1.5"><span>{u.name}</span><span className="text-neutral-500">{u.date}</span></li>)}</ul> : <p className="mt-3 text-sm text-neutral-500">None loaded yet. They&apos;re read from Google&apos;s Search Status Dashboard once a day.</p>}
        </div>
      </section>
    </div>
  );
}
