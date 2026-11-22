import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { audienceFrom, buildAudience, campaignAllowance, campaignBlocker, describeAudience, MAX_RECIPIENTS } from "@/lib/campaigns";
import { businessName, senderLine } from "@/lib/sms";
import { loadClient } from "../../data";
import { Flash, SubHeader } from "../../ui";
import { sendCampaign } from "../actions";
import { MessageEditor } from "./editor";

export const dynamic = "force-dynamic";

type SP = { who?: string; months?: string; tag?: string; err?: string };

/** New reactivation campaign: pick who, write (or pick) the message, check the preview, send. */
export default async function NewCampaign({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<SP> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const a = audienceFrom(sp);
  const [{ recipients, skippedRecent, skippedIgnored, skippedNoMobile }, blocked, { data: saved }, { data: tagRows }, allowance] = await Promise.all([
    buildAudience(c, a),
    campaignBlocker(c),
    db().from("campaign_templates").select("id, name, body").eq("client_id", c.id).order("created_at", { ascending: false }).limit(10).returns<{ id: string; name: string; body: string }[]>(),
    db().from("contacts").select("tags").eq("client_id", c.id).not("tags", "eq", "{}").limit(500).returns<{ tags: string[] }[]>(),
    campaignAllowance(c),
  ]);
  const tags = [...new Set((tagRows ?? []).flatMap((r) => r.tags))].sort().slice(0, 30);
  const n = recipients.length;
  const hours = Math.max(1, Math.ceil(n / 100));

  return (
    <div className="min-h-dvh bg-[#f4f5f7]">
      <SubHeader back={`/m/${token}/campaigns`} title="New campaign" />
      <Flash err={sp.err} />
      <div className="space-y-4 p-4">
        {blocked && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{blocked}</p>}
        <p className={`rounded-xl p-3 text-sm ${n > allowance.left ? "bg-amber-50 text-amber-900" : "bg-white text-neutral-700 shadow-sm"}`}>
          <strong>{allowance.left}</strong> of {allowance.limit} campaign texts left this month.
          {n > allowance.left ? " This audience is bigger than that: narrow it down, or ask ASC for more." : ""}
        </p>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold">1. Who to send it to</h2>
          <form className="mt-3 space-y-2">
            <select name="who" defaultValue={a.who} className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-base">
              <option value="lapsed">Customers I haven&apos;t heard from in a while</option>
              <option value="past">Everyone I&apos;ve done a job for</option>
              <option value="all">All my customers</option>
            </select>
            <div className="flex gap-2">
              <select name="months" defaultValue={String(a.months)} className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-3 text-base">
                <option value="3">Quiet for 3+ months</option>
                <option value="6">Quiet for 6+ months</option>
                <option value="12">Quiet for a year+</option>
                <option value="24">Quiet for 2 years+</option>
              </select>
              <select name="tag" defaultValue={a.tag} className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-3 text-base">
                <option value="">Any tag</option>
                {tags.map((t) => (
                  <option key={t} value={t}>#{t}</option>
                ))}
              </select>
            </div>
            <button className="w-full rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-medium text-neutral-800 active:bg-neutral-200">Update count</button>
          </form>
          <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
            <strong>{n}</strong> {n === 1 ? "customer" : "customers"}: {describeAudience(a)}.
            {a.who !== "lapsed" ? " (The months box only applies to “haven't heard from”.)" : ""}
            {skippedRecent ? ` ${skippedRecent} left out because they had a campaign text in the last 30 days.` : ""}
            {skippedIgnored ? ` ${skippedIgnored} left out because they didn't reply to your last two campaigns.` : ""}
            {skippedNoMobile ? ` ${skippedNoMobile} have no mobile number.` : ""}
          </p>
        </section>

        <form action={sendCampaign} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="who" value={a.who} />
          <input type="hidden" name="months" value={a.months} />
          <input type="hidden" name="tag" value={a.tag} />
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-semibold">2. Your message</h2>
            <MessageEditor sender={senderLine(c)} business={businessName(c)} sampleName={recipients[0]?.name ?? null} saved={saved ?? []} country={c.country === "US" ? "US" : "GB"} count={n} />
          </section>
          <section className="rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="font-semibold">3. Send</h2>
            <p className="mt-1 text-sm text-neutral-600">
              About 100 an hour, only between 9am and 7pm{n > 100 ? `, so this takes about ${hours} hours of sending time` : ""}. Replies come into your inbox like any other text. Anyone who replies STOP won&apos;t get texts again.
            </p>
            <label className="mt-3 flex items-start gap-3 text-sm">
              <input type="checkbox" name="confirm" className="mt-0.5 h-5 w-5" />
              <span>These are my customers and I&apos;m happy to text them this offer.</span>
            </label>
            <button disabled={!!blocked || !n || n > MAX_RECIPIENTS || n > allowance.left} className="mt-3 w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-base font-semibold text-white active:bg-[#1f62b3] disabled:opacity-50">
              Send to {n} {n === 1 ? "customer" : "customers"}
            </button>
          </section>
        </form>
      </div>
    </div>
  );
}
