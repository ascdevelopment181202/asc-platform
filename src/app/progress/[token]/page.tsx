import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { seoEnv } from "@/lib/env";
import { buildReport, clientForReportToken } from "@/lib/seo/client-report";
import { DEMO_ID } from "@/lib/seo/demo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your weekly progress", robots: { index: false, follow: false } };

/** A client's private progress page. No login: the link itself is the key. Shows only client-friendly numbers. */
export default async function ProgressPage({ params }: { params: Promise<{ token: string }> }) {
  if (!seoEnv.on()) notFound();
  const { token } = await params;
  const clientId = token === "demo" ? DEMO_ID : await clientForReportToken(token);
  if (!clientId) notFound();
  const r = await buildReport(clientId);
  if (!r) notFound();
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <p className="text-sm text-neutral-500">Weekly progress{token === "demo" ? " · sample data" : ""}</p>
          <h1 className="mt-1 text-3xl font-semibold">{r.name}</h1>
          <p className="mt-1 text-sm text-neutral-600">For {r.period}. Figures compare the last 4 weeks with the 4 weeks before.</p>
        </header>

        {r.sections.map((s) => (
          <section key={s.key} className="rounded-2xl border border-neutral-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{s.title}</p>
            <p className="mt-1 text-xl font-semibold">{s.headline}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-neutral-700">
              {s.lines.map((l) => <li key={l} className="flex gap-2"><span aria-hidden className="text-neutral-400">•</span><span>{l}</span></li>)}
            </ul>
            {s.chart && <Bars label={s.chart.label} points={s.chart.points} />}
          </section>
        ))}
        {!r.sections.length && <section className="rounded-2xl border border-neutral-200 bg-white p-5 text-sm text-neutral-600">We&apos;re getting everything connected. Your first numbers will show here within a week or two.</section>}

        {r.done.length > 0 && (
          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">What we did this week</p>
            <ul className="mt-3 space-y-1.5 text-sm">{r.done.map((d) => <li key={d} className="flex gap-2"><span aria-hidden className="text-green-600">✓</span><span>{d}</span></li>)}</ul>
          </section>
        )}
        {r.next.length > 0 && (
          <section className="rounded-2xl border border-neutral-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Coming next</p>
            <ul className="mt-3 space-y-1.5 text-sm text-neutral-700">{r.next.map((d) => <li key={d} className="flex gap-2"><span aria-hidden className="text-neutral-400">→</span><span>{d}</span></li>)}</ul>
          </section>
        )}
        <footer className="pt-2 text-center text-xs text-neutral-500">Prepared for {r.name} by ASC Development · ascdev.tech</footer>
      </div>
    </main>
  );
}

function Bars({ label, points }: { label: string; points: { week: string; value: number }[] }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const short = (w: string) => new Date(`${w}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <figure className="mt-4">
      <figcaption className="text-xs text-neutral-500">{label}</figcaption>
      <div className="mt-2 flex h-24 items-end gap-1.5" role="img" aria-label={`${label}: ${points.map((p) => `${short(p.week)} ${p.value}`).join(", ")}`}>
        {points.map((p) => (
          <div key={p.week} className="flex h-full flex-1 flex-col justify-end" title={`Week of ${short(p.week)}: ${p.value}`}>
            <span className="mb-0.5 text-center text-[10px] text-neutral-500">{p.value}</span>
            <div className="rounded-t bg-neutral-900" style={{ height: `${Math.max(3, (p.value / max) * 78)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400"><span>{short(points[0].week)}</span><span>{short(points[points.length - 1].week)}</span></div>
    </figure>
  );
}
