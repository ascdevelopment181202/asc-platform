/* eslint-disable @next/next/no-img-element -- screenshots are short-lived signed links, not site images */
import Link from "next/link";
import type { ReactNode } from "react";
import { gainLabel } from "@/lib/seo/value";
import type { ActionType, Connection, GoogleUpdate, SeoAction } from "@/lib/seo/types";
import type { TrackRecord } from "@/lib/seo/strategist";
import { btn, btnQuiet, input } from "../ui";
import { approve, dismiss, done, refreshPr, saveEdit, snooze, writeNow } from "./actions";
import { CopyButton } from "./client";

export const card = "rounded-xl border border-neutral-200 bg-white";

const TYPE_CLS: Record<ActionType, string> = {
  Profile: "bg-blue-100 text-blue-800",
  Reviews: "bg-amber-100 text-amber-800",
  Technical: "bg-neutral-200 text-neutral-700",
  Page: "bg-green-100 text-green-800",
  "AI search": "bg-purple-100 text-purple-800",
  Content: "bg-teal-100 text-teal-800",
  Manual: "bg-orange-100 text-orange-800",
};
export const Pill = ({ children, cls }: { children: ReactNode; cls: string }) => <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
export const TypeBadge = ({ type }: { type: ActionType }) => <Pill cls={TYPE_CLS[type]}>{type}</Pill>;

/** Plain-English hover text for the few technical words that can't be avoided. */
const TERMS: [RegExp, string][] = [
  [/\bimpressions?\b/i, "How many times the site was shown in Google's results."],
  [/\bclick rate\b/i, "Of the people who saw the result, the share who clicked it."],
  [/\bposition\b/i, "Where the site sits in Google's results. 1 is the top."],
  [/\bschema\b|\bstructured data\b/i, "A hidden label on the page that tells Google and AI tools the business's details in a form they can read."],
  [/\bllms\.txt\b/i, "A plain text summary of the business, written for AI tools."],
  [/\bsitemap\b/i, "A list of every page on the site, for search engines."],
  [/\brobots\.txt\b/i, "A small file that tells search engines and AI crawlers what they may read."],
  [/\bpull request\b/i, "A proposed change to the site's code. Nothing is live until it's merged."],
  [/\bcrawlers?\b/i, "The programs search engines and AI tools use to read websites."],
  [/\balt text\b/i, "A short description of an image, read by Google and by screen readers."],
  [/\bH1\b/, "The page's main heading."],
  [/\bIndexNow\b/, "A way to tell Bing straight away that a page has changed."],
];
export function Explain({ text }: { text: string }) {
  const used = new Set<number>();
  let parts: (string | React.JSX.Element)[] = [text];
  TERMS.forEach(([re, tip], n) => {
    parts = parts.flatMap((p, i): (string | React.JSX.Element)[] => {
      if (typeof p !== "string" || used.has(n)) return [p];
      const m = re.exec(p);
      if (!m) return [p];
      used.add(n);
      return [p.slice(0, m.index), <abbr key={`${n}-${i}`} title={tip} className="cursor-help underline decoration-dotted underline-offset-2">{m[0]}</abbr>, p.slice(m.index + m[0].length)];
    });
  });
  return <>{parts}</>;
}

export function Msg({ msg }: { msg?: string }) {
  return msg ? <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{msg}</p> : null;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className={`mt-1 text-xs ${tone === "good" ? "text-green-700" : tone === "bad" ? "text-red-600" : "text-neutral-500"}`}>{sub}</p>}
    </div>
  );
}

/** A small line chart with Google's confirmed ranking updates marked as dashed lines. */
export function Spark({ points, updates = [], height = 64, label }: { points: { week: string; value: number }[]; updates?: GoogleUpdate[]; height?: number; label?: string }) {
  if (points.length < 2) return <p className="text-xs text-neutral-500">Not enough history for a chart yet.</p>;
  const W = 560;
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i: number) => (i / (points.length - 1)) * (W - 8) + 4;
  const y = (v: number) => height - 6 - (v / max) * (height - 14);
  const first = Date.parse(points[0].week);
  const last = Date.parse(points[points.length - 1].week) + 7 * 86_400_000;
  const marks = updates.filter((u) => Date.parse(u.date) >= first && Date.parse(u.date) <= last);
  return (
    <figure>
      {label && <figcaption className="mb-1 text-xs text-neutral-500">{label}, last {points.length} weeks</figcaption>}
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={label ?? "Trend"}>
        {marks.map((u) => {
          const px = ((Date.parse(u.date) - first) / (last - first)) * (W - 8) + 4;
          return (
            <g key={u.date}>
              <line x1={px} x2={px} y1={2} y2={height - 2} stroke="#f59e0b" strokeDasharray="3 3" />
              <title>{`Google ${u.name}, ${u.date}`}</title>
            </g>
          );
        })}
        <polyline fill="none" stroke="#171717" strokeWidth="2" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
        {points.map((p, i) => (
          <circle key={p.week} cx={x(i)} cy={y(p.value)} r="2.5" fill="#171717">
            <title>{`Week of ${p.week}: ${p.value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[11px] text-neutral-500">
        <span>{points[0].week}: {points[0].value}</span>
        {marks.length > 0 && <span className="text-amber-700">Dashed line: a confirmed Google update</span>}
        <span>{points[points.length - 1].week}: {points[points.length - 1].value}</span>
      </div>
    </figure>
  );
}

/** Word-level before and after: removed words struck through in red, added words in green. */
export function Diff({ before, after }: { before: string; after: string }) {
  if (!before) return <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900 whitespace-pre-wrap">{after}</p>;
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  if (a.length * b.length > 250_000) return <div className="space-y-2 text-sm"><p className="rounded-lg bg-red-50 p-3 text-red-900 line-through">{before}</p><p className="rounded-lg bg-green-50 p-3 text-green-900">{after}</p></div>;
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: ReactNode[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(a[i++]);
      j++;
    }
    else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) out.push(<ins key={k++} className="rounded bg-green-100 text-green-900 no-underline">{b[j++]}</ins>);
    else out.push(<del key={k++} className="rounded bg-red-100 text-red-800">{a[i++]}</del>);
  }
  return <p className="rounded-lg border border-neutral-200 p-3 text-sm leading-relaxed whitespace-pre-wrap">{out}</p>;
}

const dot: Record<Connection["state"], string> = { ok: "bg-green-500", partial: "bg-amber-500", missing: "bg-red-500" };

/** One badge per connection. Green works, amber half works, red is missing. Click for what it unlocks and how to connect it. */
export function ConnStrip({ connections }: { connections: Connection[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {connections.map((c) => (
        <details key={c.key} className="group relative">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs hover:bg-neutral-100">
            <span className={`h-2 w-2 rounded-full ${dot[c.state]}`} aria-hidden />
            {c.label}
          </summary>
          <div className="absolute left-0 z-10 mt-2 w-[26rem] max-w-[90vw] space-y-2 rounded-xl border border-neutral-200 bg-white p-4 text-sm shadow-lg">
            <p className="font-medium">{c.label}: {c.state === "ok" ? "connected" : c.state === "partial" ? "partly working" : "not connected"}</p>
            <p className="text-neutral-600">{c.unlocks}</p>
            {c.detail && <p className="text-neutral-600">{c.detail}</p>}
            {c.state !== "ok" && (
              <>
                <ol className="list-decimal space-y-1 pl-5 text-neutral-700">{c.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                {c.message && (
                  <div className="rounded-lg bg-neutral-50 p-2">
                    <pre className="whitespace-pre-wrap font-sans text-xs text-neutral-700">{c.message}</pre>
                    <div className="mt-2"><CopyButton text={c.message} label="Copy this" /></div>
                  </div>
                )}
              </>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

export function Tabs({ base, tabs, current }: { base: string; tabs: { key: string; label: string; count?: number }[]; current: string }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
      {tabs.map((t) => (
        <Link key={t.key} href={`${base}?tab=${t.key}`} className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm ${current === t.key ? "border-neutral-900 font-medium" : "border-transparent text-neutral-600 hover:bg-neutral-100"}`}>
          {t.label}
          {t.count ? <span className="ml-1.5 rounded-full bg-neutral-200 px-1.5 text-xs">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

const h3 = "text-xs font-semibold uppercase tracking-wide text-neutral-500";
const Hidden = ({ id, back }: { id: string; back: string }) => (
  <>
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="back" value={back} />
  </>
);

function approveLabel(a: SeoAction): string {
  const d = a.draft;
  if (a.status === "approved" && a.apply?.mode === "list") return "Mark done";
  if (!d) return "Got it";
  if (d.target === "manual") return "Mark done";
  if (d.target === "email") return "Send";
  if (d.target === "review") return "Post reply";
  return "Approve";
}

/**
 * One inbox item. Collapsed: what, the gain, confidence, effort, goal, and the buttons.
 * Expanded: what changes, why, how it turns into money, track record, links, and what happens after.
 */
export function ActionCard({ a, clientName, country, demo, back, track, updates, open, shots, showClient = true }: { a: SeoAction; clientName: string; country: "GB" | "US"; demo?: boolean; back: string; track: TrackRecord; updates: GoogleUpdate[]; open?: boolean; shots?: Record<string, string>; showClient?: boolean }) {
  const d = a.draft;
  const det = a.detail;
  const ev = det.evidence;
  const rec = track[a.kind];
  const waiting = !!d?.needsAi;
  const listMode = a.status === "approved" && a.apply?.mode === "list";
  const pending = a.status === "approved" && a.apply?.mode === "pr";
  const editable = !!d && !waiting && (!!d.fields?.length || !!d.html) && a.status === "new";
  return (
    <details data-seo-item id={a.id} open={open} className={`${card} ${det.alert ? "border-red-300" : ""} scroll-mt-4`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {showClient && <Link href={`/admin/seo/${a.client_id}`} className="font-medium text-neutral-900 underline">{clientName}</Link>}
            <TypeBadge type={a.type} />
            {demo && <Pill cls="bg-neutral-900 text-white">Demo</Pill>}
            {det.alert && <Pill cls="bg-red-100 text-red-800">Alert</Pill>}
            {waiting && <Pill cls="bg-neutral-100 text-neutral-600">Waiting to be written</Pill>}
            {pending && <Pill cls="bg-blue-100 text-blue-800">Approved, going live</Pill>}
            {listMode && <Pill cls="bg-amber-100 text-amber-800">Change list ready</Pill>}
            {a.status === "failed" && <Pill cls="bg-red-100 text-red-800">Failed</Pill>}
            {a.apply?.visual && !a.apply.visual.ok && <Pill cls="bg-amber-100 text-amber-800">Needs a look</Pill>}
          </div>
          <p className="mt-1.5 text-sm font-medium"><Explain text={a.summary} /></p>
          <p className="mt-1 text-xs text-neutral-600">
            <span className="font-medium text-green-700">{gainLabel(det, country)}</span> · Confidence: {det.confidence} · {det.effort}
            {a.goal && <> · Goal: {a.goal}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {waiting ? (
            <form action={writeNow}><Hidden id={a.id} back={back} /><button className={btn}>Write it now</button></form>
          ) : (
            <form action={approve}><Hidden id={a.id} back={back} /><button data-approve className={btn}>{approveLabel(a)}</button></form>
          )}
          {a.apply?.previewUrl ? <a href={a.apply.previewUrl} target="_blank" rel="noreferrer" className={btnQuiet}>Preview</a> : <a href={`#${a.id}`} className={btnQuiet}>{editable ? "Edit" : "Preview"}</a>}
          <form action={snooze}><Hidden id={a.id} back={back} /><button className={btnQuiet}>Snooze</button></form>
          <form action={dismiss}><Hidden id={a.id} back={back} /><button data-dismiss className={btnQuiet}>Dismiss</button></form>
        </div>
      </summary>

      <div className="space-y-5 border-t border-neutral-200 p-4 text-sm">
        <section className="space-y-2">
          <h3 className={h3}>1. What changes</h3>
          {waiting && <p className="text-neutral-600">The AI hasn&apos;t written this one yet. It writes the top few each morning within the budget, or press Write it now.</p>}
          {!d && <p className="text-neutral-600">Nothing is changed by this item. It&apos;s here so you know. Press Got it once you&apos;ve seen it.</p>}
          {d?.page && d.page !== "*" && <p className="text-xs text-neutral-500">Page: {d.page}</p>}
          {(d?.fields ?? []).filter((f) => f.after).map((f) => (
            <div key={f.name}>
              <p className="mb-1 text-xs font-medium text-neutral-600">{f.label}{f.before ? "" : " (new)"}</p>
              <Diff before={f.before} after={f.after} />
            </div>
          ))}
          {d?.html && (
            <details className="rounded-lg border border-neutral-200">
              <summary className="cursor-pointer p-2 text-xs font-medium text-neutral-600">Content to add ({d.html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length} words)</summary>
              <div className="max-h-80 overflow-auto border-t border-neutral-200 p-3 text-sm [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-medium [&_p]:mt-1">
                <pre className="whitespace-pre-wrap font-sans">{d.html.replace(/<script[\s\S]*?<\/script>/gi, "\n[structured data]\n").replace(/<\/(h[1-6]|p|section)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()}</pre>
              </div>
            </details>
          )}
          {(d?.files ?? []).map((f) => (
            <details key={f.path} className="rounded-lg border border-neutral-200">
              <summary className="cursor-pointer p-2 text-xs font-medium text-neutral-600">New file: /{f.path}</summary>
              <pre className="max-h-64 overflow-auto border-t border-neutral-200 p-3 text-xs whitespace-pre-wrap">{f.content}</pre>
            </details>
          ))}
          {(d?.blocks ?? []).map((b) => (
            <details key={b.label} className="rounded-lg border border-neutral-200">
              <summary className="cursor-pointer p-2 text-xs font-medium text-neutral-600">{b.label} ({b.page === "*" ? "every page" : b.page === "/" ? "home page" : b.page})</summary>
              <pre className="max-h-64 overflow-auto border-t border-neutral-200 p-3 text-xs whitespace-pre-wrap">{b.html}</pre>
            </details>
          ))}
          {d?.steps && (
            <div>
              <p className="mb-1 text-xs text-neutral-500">By hand{d.minutes ? `, about ${d.minutes} minutes` : ""}:</p>
              <ol className="list-decimal space-y-2 pl-5">
                {d.steps.map((s, i) => (
                  <li key={i}>
                    {s.text} {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="underline">Open</a>}
                    {s.copy && (
                      <div className="mt-1 rounded-lg bg-neutral-50 p-2">
                        <pre className="whitespace-pre-wrap font-sans text-xs">{s.copy}</pre>
                        <div className="mt-1"><CopyButton text={s.copy} /></div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {d?.note && d.target === "site" && <p className="rounded-lg bg-amber-50 p-3 text-amber-900 whitespace-pre-wrap">{d.note}</p>}
          {d?.note && d.target === "manual" && <p className="text-neutral-600">{d.note}</p>}
          {a.apply?.changeList && (
            <div className="rounded-lg bg-neutral-50 p-3">
              <p className="mb-1 text-xs font-medium text-neutral-600">Change list: paste this into Claude Design or send it to whoever edits the site, then press Mark done.</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{a.apply.changeList}</pre>
              <div className="mt-2 flex gap-2">
                <CopyButton text={a.apply.changeList} label="Copy change list" />
                <form action={done}><Hidden id={a.id} back={back} /><button className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">Mark done</button></form>
              </div>
            </div>
          )}
          {a.apply?.prUrl && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
              <a href={a.apply.prUrl} target="_blank" rel="noreferrer" className="underline">Pull request #{a.apply.prNumber}</a>
              <span>· Preview build: {a.apply.build === "ok" ? "passed" : a.apply.build === "failed" ? "failed" : "building"}</span>
              <form action={refreshPr}><Hidden id={a.id} back={back} /><button className="underline">Check again</button></form>
            </div>
          )}
          {a.apply?.visual && <p className={`rounded-lg p-3 ${a.apply.visual.ok ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>Visual check: {a.apply.visual.note}</p>}
          {(a.apply?.visual?.shots ?? []).map((s) => (
            <div key={s.label} className="grid gap-2 sm:grid-cols-2">
              {s.before && shots?.[s.before] && <figure><figcaption className="text-xs text-neutral-500">{s.label}, before</figcaption><img src={shots[s.before]} alt={`${s.label} before`} className="max-h-96 w-full rounded-lg border border-neutral-200 object-cover object-top" /></figure>}
              {shots?.[s.after ?? ""] && <figure><figcaption className="text-xs text-neutral-500">{s.label}, after</figcaption><img src={shots[s.after!]} alt={`${s.label} after`} className="max-h-96 w-full rounded-lg border border-neutral-200 object-cover object-top" /></figure>}
            </div>
          ))}
          {a.apply?.error && <p className="rounded-lg bg-red-50 p-3 text-red-800">{a.apply.error}</p>}
          {editable && (
            <details className="rounded-lg border border-neutral-200">
              <summary className="cursor-pointer p-2 text-xs font-medium text-neutral-600">Edit before approving</summary>
              <form action={saveEdit} className="space-y-2 border-t border-neutral-200 p-3">
                <Hidden id={a.id} back={back} />
                {(d.fields ?? []).map((f) => (
                  <label key={f.name} className="block text-xs text-neutral-600">{f.label}<textarea name={`field:${f.name}`} defaultValue={f.after} rows={f.after.length > 120 ? 5 : 2} className={`${input} mt-1 w-full`} /></label>
                ))}
                {d.html && <label className="block text-xs text-neutral-600">Content (HTML)<textarea name="html" defaultValue={d.html} rows={10} className={`${input} mt-1 w-full font-mono text-xs`} /></label>}
                <button className={btnQuiet}>Save edit</button>
              </form>
            </details>
          )}
        </section>

        <section className="space-y-2">
          <h3 className={h3}>2. Why</h3>
          <p><Explain text={ev.why} /></p>
          {ev.numbers && ev.numbers.length > 0 && (
            <table className="w-full text-xs">
              <tbody>{ev.numbers.map((n) => <tr key={n.label} className="border-t border-neutral-100"><td className="py-1 pr-3 text-neutral-600">{n.label}</td><td className="py-1 text-right font-medium">{n.value}</td></tr>)}</tbody>
            </table>
          )}
          {ev.series && <Spark points={ev.series.points} updates={updates} label={ev.series.label} />}
          {ev.competitor && <p className="rounded-lg bg-neutral-50 p-3 text-neutral-700">Competitors: {ev.competitor}</p>}
        </section>

        <section className="space-y-2">
          <h3 className={h3}>3. How it turns into results</h3>
          <ol className="flex flex-wrap items-stretch gap-2">
            {det.chain.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                {i > 0 && <span className="text-neutral-400" aria-hidden>→</span>}
                <span className={`rounded-lg border px-3 py-2 ${c.assumed ? "border-dashed border-neutral-300" : "border-neutral-200"}`}>
                  {c.value === "estimate" ? (
                    <span className="font-medium">{c.label} (estimate)</span>
                  ) : (
                    <>
                      <span className="block text-xs text-neutral-500">{c.label}{c.assumed && !/typical|estimate/i.test(c.label) ? " (estimate)" : ""}</span>
                      <span className="font-medium">{c.value}</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-neutral-500">Dashed boxes are estimates. They become this client&apos;s own numbers as tracking and the fact sheet fill in.</p>
        </section>

        <section className="space-y-1">
          <h3 className={h3}>4. Track record and risk</h3>
          <p>{rec && rec.total > 0 ? `This kind of change has worked ${rec.worked} of the ${rec.total} times it's been measured across clients.` : "No measured results for this kind of change yet. The first ones are measured 28 days after they go live."}</p>
          <p>Risk: {det.risk}. {det.undoable ? "Can be undone in one click from the Changes tab." : "Can't be undone automatically."}{det.autoOk ? " A safe kind: can be set to apply on its own in Settings." : ""}</p>
        </section>

        {det.links && det.links.length > 0 && (
          <section className="space-y-1">
            <h3 className={h3}>5. Links</h3>
            <p className="flex flex-wrap gap-3">{det.links.map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="underline">{l.label}</a>)}</p>
          </section>
        )}

        <section className="space-y-1">
          <h3 className={h3}>6. After applying</h3>
          {a.result ? <p><span className="font-medium">{a.result.verdict === "worked" ? "Worked." : a.result.verdict === "worse" ? "Did worse." : a.result.verdict === "no change" ? "No clear change." : "Too early to tell."}</span> {a.result.text}</p> : <p className="text-neutral-600">{det.gain.clicks || det.gain.calls ? "Measured 28 days after it goes live, against the 28 days before and against the rest of the site. The result is added here." : "Nothing to measure for this one."}</p>}
        </section>

        {a.status !== "applied" && a.status !== "done" && (
          <form action={dismiss} className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
            <Hidden id={a.id} back={back} />
            Dismiss because:
            {["not relevant", "wrong", "later", "client said no"].map((r) => <button key={r} name="reason" value={r} className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100">{r}</button>)}
          </form>
        )}
      </div>
    </details>
  );
}
