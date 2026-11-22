import Link from "next/link";
import { notFound } from "next/navigation";
import { firstSendLabel, reviewOffsets, reviewSettings, reviewText, stepKind } from "@/lib/sms";
import { loadClient, unreadTotal } from "../../data";
import { AppShell, Flash } from "../../ui";
import { toggleTrigger } from "../google-actions";

export const dynamic = "force-dynamic";

const DAY = 86400_000;

/** Every trigger, the exact schedule and wording, and what stops it. Owners switch triggers on and off here. */
export default async function HowReviewsWork({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const unread = await unreadTotal(c.id);
  const s = reviewSettings(c);
  const offsets = reviewOffsets(s);
  const sample = { review_token: "example0000", job_label: "boiler service", source: "dashboard" as const };
  const when = (ms: number, i: number) =>
    i === 0 ? `${firstSendLabel(c).replace("in about ", "")} after the job is done` : ms % (30 * DAY) === 0 && ms >= 60 * DAY ? `${ms / (30 * DAY)} months later` : `${Math.round(ms / DAY)} days later`;

  const triggers: { key?: string; on: boolean; name: string; how: string }[] = [
    { key: "booking", on: c.auto_review_after_booking, name: "A booking ends", how: `Automatic. We send you a notification first, so you can stop it if the job isn't finished. The text goes ${firstSendLabel(c, true)} after the booking's end time.` },
    { key: "onPaid", on: s.onPaid, name: "You mark an invoice as paid", how: "The “Also ask for a review” box is ticked for you. Untick it to skip one." },
    { key: "onStage", on: s.onStage, name: "You move a customer to Job done", how: "On their customer page, under Job stage." },
    { on: true, name: "You tap Job done or Ask", how: "On the Reviews screen, in a conversation, on a customer, or from Today's customers." },
    { on: true, name: "You text DONE to your ASC number", how: "For example: DONE 07700900123 Sarah." },
    { on: true, name: "Your job software marks a job finished", how: "If ASC has connected Jobber, Tradify, Xero or similar for you." },
  ];

  return (
    <AppShell token={token} active="reviews" unread={unread} title="How review requests work">
      <Flash ok={sp.ok} />
      <div className="space-y-4 p-4">
        <Link href={`/m/${token}/reviews`} className="text-sm text-[#2a78d6]">← Reviews</Link>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">1. What starts a request</h2>
          <ul className="mt-2 divide-y divide-neutral-100">
            {triggers.map((t) => (
              <li key={t.name} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-sm text-neutral-600">{t.how}</p>
                </div>
                {t.key ? (
                  <form action={toggleTrigger}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="key" value={t.key} />
                    <button className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${t.on ? "bg-green-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>{t.on ? "On" : "Off"}</button>
                  </form>
                ) : (
                  <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1.5 text-sm text-neutral-600">Always</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">2. What your customer gets</h2>
          <p className="text-sm text-neutral-600">Up to {offsets.length} texts, only between 9am and 7pm. Example for a boiler service for Sarah:</p>
          <ol className="mt-3 space-y-3">
            {offsets.map((ms, i) => (
              <li key={i}>
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {i + 1}. {when(ms, i)}{stepKind(c, i + 1) === "later" ? " (final, gentle ask)" : ""}
                </p>
                <p className="mt-1 rounded-2xl rounded-bl-sm bg-neutral-100 p-3 text-sm">{reviewText(c, { name: "Sarah" }, sample, i + 1)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">3. What stops it</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700">
            <li>They tap the link and rate you (happy customers go on to Google, unhappy ones tell you privately).</li>
            <li>We spot their review on your Google profile.</li>
            <li>They reply STOP.</li>
            <li>You tap the request and choose &ldquo;don&apos;t send&rdquo;, or cancel their booking.</li>
          </ul>
          <p className="mt-3 text-sm text-neutral-600">Each customer is asked once every 6 months at most, so nobody gets pestered. Low ratings land on your Tasks as &ldquo;Call them&rdquo;, and you can ask again once it&apos;s sorted.</p>
        </section>
        <p className="text-center text-xs text-neutral-500">Want different timings or wording? Ask ASC.</p>
      </div>
    </AppShell>
  );
}
