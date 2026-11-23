import Link from "next/link";
import { notFound } from "next/navigation";
import { googleEnabled, seoEnv } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { googleAccount } from "@/lib/google";
import type { BingStats } from "@/lib/seo/bing";
import { connectionsFor } from "@/lib/seo/connections";
import { trackingSeen } from "@/lib/seo/results";
import { allSettings, getLatest } from "@/lib/seo/store";
import type { Connection } from "@/lib/seo/types";
import { card, ConnStrip } from "../ui";

export const dynamic = "force-dynamic";

// The connections that block the most value come first.
const WEIGHT: Record<string, number> = { gbp: 5, gsc: 5, anthropic: 4, site: 3, googlekey: 3, tracking: 2, bing: 1, gemini: 0, openai: 0 };
const dot: Record<Connection["state"], string> = { ok: "bg-green-500", partial: "bg-amber-500", missing: "bg-red-500" };

export default async function Connections() {
  if (!seoEnv.on()) notFound();
  const [settings, { data: clients }, account] = await Promise.all([allSettings(), db().from("clients").select("*").in("status", ["live", "building", "past_due"]).returns<Client[]>(), googleEnabled() ? googleAccount() : Promise.resolve(null)]);
  const byId = new Map(settings.map((s) => [s.client_id, s]));
  const rows = await Promise.all((clients ?? []).map(async (c) => {
    const s = byId.get(c.id);
    if (!s?.setup_done_at) return { c, conns: null as Connection[] | null, missing: 99 };
    const conns = connectionsFor(s, c.first_name ?? clientLabel(c), { tracking: await trackingSeen(c.id), bing: !!(await getLatest<BingStats>(c.id, "bing")), google: !!account });
    return { c, conns, missing: conns.reduce((n, x) => n + (x.state === "ok" ? 0 : (WEIGHT[x.key] ?? 0) * (x.state === "missing" ? 2 : 1)), 0) };
  }));
  rows.sort((a, b) => (a.conns ? 0 : 1) - (b.conns ? 0 : 1) || b.missing - a.missing);
  const cols = rows.find((r) => r.conns)?.conns ?? [];
  const perClient = cols.filter((x) => ["gbp", "gsc", "site", "tracking", "bing"].includes(x.key));
  const platform = cols.filter((x) => !["gbp", "gsc", "site", "tracking", "bing"].includes(x.key));
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-neutral-500"><Link href="/admin/seo" className="underline">SEO inbox</Link></p>
        <h1 className="mt-1 text-2xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-neutral-600">Green works, amber half works, red is missing. Clients with the most valuable gaps are first. Click a client for what each connection unlocks, the steps, and a message to send them.</p>
      </div>
      {platform.length > 0 && (
        <section className={`${card} space-y-2 p-4`}>
          <h2 className="font-semibold">For every client</h2>
          <ConnStrip connections={platform} />
        </section>
      )}
      <section className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead><tr><th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">Client</th>{perClient.map((x) => <th key={x.key} className="px-3 py-2 text-left text-xs font-medium text-neutral-500">{x.label.replace(/ \(.*\)/, "")}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map(({ c, conns }) => (
              <tr key={c.id} className="border-t border-neutral-100">
                <td className="px-4 py-3 font-medium">{clientLabel(c)}</td>
                {conns ? perClient.map((col) => {
                  const x = conns.find((k) => k.key === col.key)!;
                  return <td key={col.key} className="px-3 py-3"><span title={x.detail} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${dot[x.state]}`} />{x.state === "ok" ? "Connected" : x.state === "partial" ? "Partly" : "Missing"}</span></td>;
                }) : <td colSpan={Math.max(1, perClient.length)} className="px-3 py-3 text-neutral-500">SEO not set up yet</td>}
                <td className="px-4 py-3 text-right">{conns ? <Link href={`/admin/seo/${c.id}`} className="underline">Open</Link> : <Link href={`/admin/seo/${c.id}/setup`} className="underline">Set up SEO</Link>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td className="p-4 text-neutral-500">No active clients.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
