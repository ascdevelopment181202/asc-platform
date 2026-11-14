import { notFound } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { lastDays, rankLine, reportStats, type ReportStats } from "@/lib/reports";
import type { Site } from "@/lib/sites";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your website dashboard", robots: { index: false, follow: false } };

const BLUE = "#2a78d6";
const RANGES = [30, 90] as const;

const nf = (n: number) => n.toLocaleString("en-GB");
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Each client's private live dashboard. The token in the link is the only key. */
export default async function Dashboard({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ d?: string }> }) {
  const { token } = await params;
  const { d } = await searchParams;
  const days = RANGES.includes(Number(d) as 30 | 90) ? Number(d) : 30;
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const { data: c } = await db().from("clients").select("*").eq("dashboard_token", token).maybeSingle<Client>();
  if (!c) notFound();
  const { data: site } = await db().from("sites").select("*").eq("client_id", c.id).maybeSingle<Site>();
  if (!site) notFound();
  const s = await reportStats(site, lastDays(days));
  const g = s.insights.gbp;
  const search = s.insights.search;
  const liveUrl = site.domain ? `https://${site.domain}` : (c.live_url ?? `${env.appUrl}/s/${site.slug}`);
  const leads = s.enquiries + s.calls + (g?.calls ?? 0);
  const prevLeads = s.previous ? s.previous.enquiries + s.previous.calls + (g?.previous?.calls ?? 0) : null;

  return (
    <div className="min-h-screen bg-[#f6f6f4] text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            {site.content.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.content.logoUrl} alt="" className="h-9 w-auto" />
            )}
            <div>
              <p className="font-semibold">{site.content.businessName}</p>
              <a href={liveUrl} className="text-xs text-neutral-500 hover:underline">{liveUrl.replace(/^https?:\/\//, "")}</a>
            </div>
          </div>
          <nav className="flex rounded-lg border border-neutral-200 p-0.5 text-sm" aria-label="Date range">
            {RANGES.map((r) => (
              <a key={r} href={`?d=${r}`} aria-current={r === days ? "page" : undefined} className={`rounded-md px-3 py-1 ${r === days ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                Last {r} days
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-5 py-6">
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-neutral-500">New enquiries and phone taps, last {days} days</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight">{nf(leads)}</p>
          {prevLeads !== null && <p className="mt-1 text-sm text-neutral-600">{delta(leads, prevLeads)} on the {days} days before</p>}
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile label="Enquiry forms" value={s.enquiries} prev={s.previous?.enquiries} />
          <Tile label="Taps on your number (website)" value={s.calls} prev={s.previous?.calls} />
          <Tile label="Website visits" value={s.visits} prev={s.previous?.visits} />
          {g && (
            <>
              <Tile label="Calls from Google profile" value={g.calls} prev={g.previous?.calls} />
              <Tile label="Direction requests" value={g.directions} prev={g.previous?.directions} />
              <Tile label="Views on Google Search and Maps" value={g.views} prev={g.previous?.views} />
            </>
          )}
        </section>

        <Panel title="Website visits per day">
          <Bars data={s.dailyVisits.map((x) => ({ day: x.day, value: x.views }))} unit="visit" />
        </Panel>

        {g && g.daily.length > 0 && (
          <Panel title="Google profile views per day">
            <Bars data={g.daily.map((x) => ({ day: x.day, value: x.views }))} unit="view" />
          </Panel>
        )}

        {search && (
          <Panel title="Where you show up on Google">
            <p className="text-sm text-neutral-600">
              First page for <strong className="text-neutral-900">{search.topTen}</strong> {search.topTen === 1 ? "search" : "searches"}
              {search.previous && ` (${search.previous.topTen} before)`}. You appeared in results {nf(search.impressions)} times and got {nf(search.clicks)} clicks.
            </p>
            {search.rankings.length > 0 ? (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="py-2 font-medium">Search</th>
                    <th className="py-2 font-medium">Your position</th>
                    <th className="hidden py-2 text-right font-medium sm:table-cell">Times shown</th>
                  </tr>
                </thead>
                <tbody>
                  {search.rankings.map((r) => (
                    <tr key={r.query} className="border-b border-neutral-100 last:border-0">
                      <td className="py-2 pr-3">{r.query}</td>
                      <td className="py-2 pr-3 font-medium">{rankLine(r)}</td>
                      <td className="hidden py-2 text-right text-neutral-600 sm:table-cell">{nf(r.impressions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-sm text-neutral-500">Not enough searches yet to show positions. New sites usually take a few weeks.</p>
            )}
            <p className="mt-3 text-xs text-neutral-500">Position is your average place in Google results for that search. #1 to #10 is the first page.</p>
          </Panel>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Panel title="Latest enquiries">
            {s.recent.length ? (
              <ul className="divide-y divide-neutral-100 text-sm">
                {s.recent.map((e, i) => (
                  <li key={i} className="flex justify-between gap-3 py-2">
                    <span>{e.name}{e.service && <span className="text-neutral-500">, {e.service}</span>}</span>
                    <span className="shrink-0 text-neutral-500">{shortDay(e.created_at.slice(0, 10))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">No enquiry forms in this period yet.</p>
            )}
          </Panel>
          <Panel title="How people found your website">
            <Sources s={s} />
          </Panel>
        </div>

        {s.topPages.length > 0 && (
          <Panel title="Most visited pages">
            <ul className="divide-y divide-neutral-100 text-sm">
              {s.topPages.map((t) => (
                <li key={t.label} className="flex justify-between gap-3 py-2"><span>{t.label}</span><span className="text-neutral-600">{nf(t.views)}</span></li>
              ))}
            </ul>
          </Panel>
        )}

        <footer className="pb-6 pt-2 text-center text-xs text-neutral-500">
          Looked after by ASC Development. Questions or changes? Call or text {env.contactPhone}.
        </footer>
      </main>
    </div>
  );
}

function delta(now: number, before: number) {
  if (now === before) return "Same as";
  const diff = now - before;
  return `${diff > 0 ? "Up" : "Down"} ${nf(Math.abs(diff))} from ${nf(before)}`;
}

function Tile({ label, value, prev }: { label: string; value: number; prev?: number }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-2xl font-semibold">{nf(value)}</p>
      <p className="mt-0.5 text-xs text-neutral-600">{label}</p>
      {prev !== undefined && <p className="mt-1 text-xs text-neutral-400">{nf(prev)} before</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Single-series daily bar chart: thin bars, rounded tops, 2px gaps, hover tooltip per bar. */
function Bars({ data, unit }: { data: { day: string; value: number }[]; unit: string }) {
  if (!data.length) return <p className="text-sm text-neutral-500">No data yet.</p>;
  const W = 720, H = 160, top = 8, bottom = 22, left = 28;
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const slot = (W - left) / data.length;
  const bw = Math.max(2, slot - 2);
  const y = (v: number) => top + (H - top - bottom) * (1 - v / nice);
  const ticks = [0, nice / 2, nice].filter((t, i, a) => a.indexOf(t) === i && Number.isInteger(t));
  const labelEvery = Math.ceil(data.length / 6);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${unit}s per day`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="#e7e6e2" strokeWidth={1} />
            <text x={left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#8a8984">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * slot + 1;
          const h = Math.max(0, H - bottom - y(d.value));
          return (
            <g key={d.day} className="group">
              <rect x={left + i * slot} y={top} width={slot} height={H - top - bottom} fill="transparent" />
              {h > 0 && <path d={roundTop(x, H - bottom - h, bw, h, Math.min(4, bw / 2, h))} fill={BLUE} className="opacity-90 group-hover:opacity-100" />}
              <title>{`${shortDay(d.day)}: ${nf(d.value)} ${d.value === 1 ? unit : `${unit}s`}`}</title>
              {i % labelEvery === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#8a8984">{shortDay(d.day)}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {data.map((d) => `${shortDay(d.day)}: ${d.value}`).join(", ")}
      </figcaption>
    </figure>
  );
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Sources({ s }: { s: ReportStats }) {
  const rows = [
    ["Google and other search engines", s.sources.search],
    ["Typed your address or a saved link", s.sources.direct],
    ["Social media", s.sources.social],
    ["Other websites", s.sources.other],
  ] as const;
  const total = rows.reduce((n, r) => n + r[1], 0);
  if (!total) return <p className="text-sm text-neutral-500">No visits counted yet.</p>;
  return (
    <ul className="space-y-3 text-sm">
      {rows.map(([label, n]) => (
        <li key={label}>
          <div className="flex justify-between"><span>{label}</span><span className="text-neutral-600">{Math.round((n / total) * 100)}%</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-neutral-100">
            <div className="h-1.5 rounded-full" style={{ width: `${(n / total) * 100}%`, background: BLUE }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
