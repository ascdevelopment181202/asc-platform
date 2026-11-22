import Link from "next/link";
import { gbp, KIND_LABEL, platformCosts, RATES, usageThisMonth, USD_TO_GBP, monthRange } from "@/lib/usage";

export const dynamic = "force-dynamic";

/** What the platform costs to run this month, from real usage: every client's texts, plus fixed costs. */
export default async function UsagePage() {
  const rows = await usageThisMonth();
  const { elapsed } = monthRange();
  const fixed = platformCosts();
  const fixedGbp = fixed.reduce((n, f) => n + f.usd, 0) * USD_TO_GBP;
  const texting = rows.reduce((n, r) => n + r.costGbp, 0);
  const projectedTexting = rows.reduce((n, r) => n + r.projectedGbp, 0);
  const live = rows.filter((r) => r.client.twilio_number);
  const perClient = live.length ? projectedTexting / live.length : 0;
  const kinds = [...new Set(rows.flatMap((r) => Object.keys(r.byKind)))];
  const byKind = Object.fromEntries(kinds.map((k) => [k, rows.reduce((n, r) => n + (r.byKind[k] ?? 0), 0)]));
  const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Costs and usage</h1>
        <p className="text-sm text-neutral-600">
          {month}, {Math.round(elapsed * 100)}% through the month. From real texts sent and received, at Twilio list prices (UK ${RATES.GB.out} a text sent, ${RATES.GB.in} received, ${RATES.GB.number} a number; $1 = £{USD_TO_GBP}).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="So far this month" value={gbp(texting + fixedGbp * elapsed)} sub="texting + share of fixed" />
        <Stat label="Projected month total" value={gbp(projectedTexting + fixedGbp)} sub={`${gbp(projectedTexting)} texting + ${gbp(fixedGbp)} fixed`} />
        <Stat label="Texting per live client" value={gbp(perClient)} sub={`projected, ${live.length} clients with a number`} />
        <Stat label="Fixed per live client" value={live.length ? gbp(fixedGbp / live.length) : "-"} sub="hosting, database, email" />
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white">
        <h2 className="border-b border-neutral-200 px-4 py-3 font-semibold">By client</h2>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2 text-right">Texts sent</th>
              <th className="px-4 py-2 text-right">Received</th>
              <th className="px-4 py-2">Biggest use</th>
              <th className="px-4 py-2 text-right">So far</th>
              <th className="px-4 py-2 text-right">Projected</th>
              <th className="px-4 py-2 text-right">Budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => {
              const top = Object.entries(r.byKind).sort((a, b) => b[1] - a[1])[0];
              const over = r.client.sms_budget_gbp != null && r.projectedGbp > Number(r.client.sms_budget_gbp);
              return (
                <tr key={r.client.id}>
                  <td className="px-4 py-2">
                    <Link href={`/admin/clients/${r.client.id}`} className="font-medium hover:underline">{r.client.business_name ?? "Unnamed"}</Link>
                    <span className="ml-1 text-xs text-neutral-500">{r.client.country}</span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.sentSegments}
                    {r.sentSegments !== r.sentTexts && <span className="text-xs text-amber-700"> ({r.sentTexts} texts)</span>}
                    {r.failed > 0 && <span className="block text-xs text-red-700">{r.failed} failed</span>}
                  </td>
                  <td className="px-4 py-2 text-right">{r.receivedSegments}</td>
                  <td className="px-4 py-2 text-neutral-600">{top ? `${KIND_LABEL[top[0]] ?? top[0]} (${top[1]})` : "-"}</td>
                  <td className="px-4 py-2 text-right">{gbp(r.costGbp)}</td>
                  <td className={`px-4 py-2 text-right font-medium ${over ? "text-red-700" : ""}`}>{gbp(r.projectedGbp)}</td>
                  <td className="px-4 py-2 text-right text-neutral-600">{r.client.sms_budget_gbp != null ? gbp(Number(r.client.sms_budget_gbp)) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-500">
          Texts sent counts billed segments (160 characters each). Projection = usage so far scaled to the whole month, plus the number fee. Set a budget on a client&apos;s page to get an email when they&apos;re heading over it.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold">What the texts were for</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {Object.entries(byKind)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <li key={k} className="flex justify-between">
                  <span>{KIND_LABEL[k] ?? k}</span>
                  <span className="text-neutral-600">{n} texts · {gbp(n * RATES.GB.out * USD_TO_GBP)}</span>
                </li>
              ))}
            {!kinds.length && <li className="text-neutral-500">No texts yet this month.</li>}
          </ul>
        </section>
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="font-semibold">Fixed monthly costs</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {fixed.map((f) => (
              <li key={f.name} className="flex justify-between">
                <span>{f.name}</span>
                <span className="text-neutral-600">{f.usd ? `$${f.usd} (${gbp(f.usd * USD_TO_GBP)})` : "free plan"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-neutral-500">Change these with COST_VERCEL_USD, COST_SUPABASE_USD and COST_RESEND_USD in Vercel when you change plan. US texting registration fees aren&apos;t included.</p>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="text-xs text-neutral-500">{sub}</p>
    </div>
  );
}
