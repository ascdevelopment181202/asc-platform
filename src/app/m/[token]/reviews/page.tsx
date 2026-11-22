import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import { daysAgoIso, loadClient, shortWhen, unreadTotal } from "../data";
import { AppShell, Flash } from "../ui";
import { bulkUpload, jobDone } from "../actions";
import { ShareLink } from "./share-link";
import { env } from "@/lib/env";
import { brandOf } from "@/lib/brand";
import type { GoogleReview } from "@/lib/google-reviews";
import { refreshReviews, toggleAutoReview } from "./google-actions";

export const dynamic = "force-dynamic";

type JobRow = {
  id: string;
  created_at: string;
  source: string;
  review_clicked_at: string | null;
  rating: number | null;
  feedback_at: string | null;
  cancelled_reason: string | null;
  reviewed_at: string | null;
  contact_id: string;
  contacts: { name: string | null; phone: string } | null;
  review_messages: { step: number; sent_at: string | null; cancelled_at: string | null }[];
};

/** "Job done" button, the list of review requests, and the past-customer upload. */
export default async function Reviews({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const tz = c.timezone || "Europe/London";
  const [{ data: jobs }, unread, { data: gReviews }] = await Promise.all([
    db()
      .from("jobs")
      .select("id, created_at, source, review_clicked_at, rating, feedback_at, cancelled_reason, reviewed_at, contact_id, contacts(name, phone), review_messages(step, sent_at, cancelled_at)")
      .eq("client_id", c.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<JobRow[]>(),
    unreadTotal(c.id),
    db().from("google_reviews").select("*").eq("client_id", c.id).order("created_at", { ascending: false }).limit(20).returns<GoogleReview[]>(),
  ]);
  const reviews = gReviews ?? [];
  const monthAgo = daysAgoIso(30);
  const recentJobs = (jobs ?? []).filter((j) => j.created_at >= monthAgo);
  const askedMonth = recentJobs.length;
  const openedMonth = recentJobs.filter((j) => j.review_clicked_at || j.rating).length;
  const needReply = reviews.filter((r) => !r.reply).length;
  const ready = c.sms_enabled && !!c.twilio_number;

  return (
    <AppShell token={token} active="reviews" unread={unread} title="Reviews">
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4 p-4">
        {!ready && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Texts aren&apos;t switched on yet. ASC will let you know when everything is live.</p>}

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-amber-50 p-2">
              <p className="text-xl font-bold text-amber-700">{c.google_rating ? `${Number(c.google_rating).toFixed(1)}★` : "–"}</p>
              <p className="text-[11px] text-neutral-600">{c.google_review_count ?? 0} Google reviews</p>
            </div>
            <div className="rounded-xl bg-blue-50 p-2">
              <p className="text-xl font-bold text-blue-800">{askedMonth}</p>
              <p className="text-[11px] text-neutral-600">asked, last 30 days</p>
            </div>
            <div className="rounded-xl bg-green-50 p-2">
              <p className="text-xl font-bold text-green-800">{openedMonth}</p>
              <p className="text-[11px] text-neutral-600">opened the link</p>
            </div>
          </div>
          <Link href={`/m/${token}/today`} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#2a78d6] px-4 py-4 text-lg font-semibold text-white active:bg-[#1f62b3]">
            ✓ Job done? Ask for a review
          </Link>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href={`/m/${token}/reviews/qr`} className="rounded-xl bg-neutral-900 px-3 py-3 text-center text-sm font-semibold text-white active:bg-neutral-800">
              📱 Show QR
              <span className="block text-[11px] font-normal text-neutral-300">At the door, works best</span>
            </Link>
            <Link href={`/m/${token}/campaigns`} className="rounded-xl bg-white px-3 py-3 text-center text-sm font-semibold text-neutral-900 ring-1 ring-neutral-300 active:bg-neutral-50">
              📣 Win back customers
              <span className="block text-[11px] font-normal text-neutral-500">Text an offer</span>
            </Link>
          </div>
          <Link href={`/m/${token}/reviews/how`} className="mt-3 block text-center text-sm font-medium text-[#2a78d6]">How it works: triggers, timings and wording →</Link>
        </section>

        <section className="rounded-2xl bg-white shadow-sm">
          <div className="flex items-start justify-between gap-3 px-4 pt-4">
            <div>
              <h2 className="text-lg font-semibold">Your Google reviews</h2>
              {c.google_rating ? (
                <p className="text-sm text-neutral-600">
                  <span className="font-semibold text-amber-600">{Number(c.google_rating).toFixed(1)}★</span> from {c.google_review_count ?? reviews.length} review{(c.google_review_count ?? reviews.length) === 1 ? "" : "s"}
                  {needReply ? ` · ${needReply} waiting for a reply` : ""}
                </p>
              ) : (
                <p className="text-sm text-neutral-600">{c.gbp_location || reviews.length ? "Checking Google every 30 minutes." : "ASC is linking your Google profile. Your reviews will show here."}</p>
              )}
            </div>
            {(c.gbp_location || reviews.length > 0) && (
              <form action={refreshReviews}>
                <input type="hidden" name="token" value={token} />
                <button className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 active:bg-neutral-200">Refresh</button>
              </form>
            )}
          </div>
          {reviews.length > 0 && (
            <ul className="mt-2 divide-y divide-neutral-100">
              {reviews.map((r) => (
                <li key={r.id}>
                  <Link href={`/m/${token}/reviews/g/${r.id}`} className="flex items-start justify-between gap-3 px-4 py-3 active:bg-neutral-50">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <span className="text-amber-500">{"★".repeat(r.rating ?? 0)}</span> {r.reviewer_name ?? "A Google user"}
                        {!r.seen_at && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[#2a78d6] align-middle" />}
                      </p>
                      <p className="line-clamp-2 text-sm text-neutral-600">{r.comment ?? "Rating only"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${r.reply ? "bg-neutral-100 text-neutral-600" : "bg-blue-50 text-blue-800"}`}>{r.reply ? "Replied" : r.auto_reply_at ? "Reply queued" : "Reply"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="pb-2" />
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Ask someone not in the app</h2>
          <p className="mt-0.5 text-sm text-neutral-600">We&apos;ll text your customer asking for a Google review.</p>
          <form action={jobDone} className="mt-3 space-y-2">
            <input type="hidden" name="token" value={token} />
            <input name="name" placeholder="Customer's first name" autoComplete="off" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
            <input name="phone" type="tel" inputMode="tel" placeholder={c.country === "US" ? "Their cell number" : "Their mobile (07...)"} required autoComplete="off" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
            <input name="job" placeholder="What was the job? (optional, e.g. boiler service)" autoComplete="off" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
            {c.country === "US" && <input name="email" type="email" placeholder="Their email (optional, we'll email if we can't text)" autoComplete="off" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />}
            <button className="w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-base font-semibold text-white active:bg-[#1f62b3]">Job done, ask for a review</button>
          </form>
          <form action={toggleAutoReview} className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-neutral-50 p-3">
            <input type="hidden" name="token" value={token} />
            <span className="text-sm">
              <strong>Ask automatically when a booking ends</strong>
              <span className="block text-xs text-neutral-500">{c.auto_review_after_booking ? "On. We'll message you first so you can stop it." : "Off. You'll need to press Job done."}</span>
            </span>
            <button className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${c.auto_review_after_booking ? "bg-green-600 text-white" : "bg-neutral-200 text-neutral-700"}`}>{c.auto_review_after_booking ? "On" : "Off"}</button>
          </form>
          <p className="mt-3 text-xs text-neutral-500">
            It also happens when you mark a booking as done, move a customer to Job done, or mark their invoice as paid. Each customer is asked once at most every 6 months. We&apos;ll remind you at 6pm on days you had bookings, and every Friday.
          </p>
          {c.twilio_number && (
            <p className="mt-2 text-xs text-neutral-500">
              Or from your own phone, text <strong>DONE {c.country === "US" ? "2145550123" : "07700900123"} Sarah</strong> (their number and first name) to {displayPhone(c.twilio_number)}.
            </p>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Your review page</h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            Happy customers (4 or 5 stars) go straight to Google. Anyone less happy tells you privately first, so you can put it right. Every review text uses it automatically. Share the link anywhere else too: WhatsApp, email, a QR code on your van.
          </p>
          {!c.google_review_url && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Your Google review link isn&apos;t set yet. ASC will add it.</p>}
          <ShareLink url={`${env.appUrl}/review/${c.review_slug}`} business={brandOf(c).name} />
          <Link href={`/m/${token}/reviews/qr/print`} className="mt-2 block text-center text-sm font-medium text-[#2a78d6]">Print review cards or a van sticker →</Link>
        </section>

        <section className="rounded-2xl bg-white shadow-sm">
          <h2 className="px-4 pb-1 pt-4 font-semibold">Review requests</h2>
          {(jobs ?? []).length === 0 ? (
            <p className="px-4 pb-4 text-sm text-neutral-500">None yet. Tap &ldquo;Job done&rdquo; after each job.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {(jobs ?? []).map((j) => {
                const s = jobStatus(j);
                return (
                  <li key={j.id}>
                    <Link href={`/m/${token}/reviews/job/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-neutral-50">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{j.contacts?.name ?? displayPhone(j.contacts?.phone)}</p>
                        <p className="text-xs text-neutral-500">{shortWhen(j.created_at, tz, localeFor(c.country))}{j.source === "bulk" ? " · past customer" : ""}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${s.tone}`}>{s.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <details className="rounded-2xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">Ask past customers for reviews</summary>
          <p className="mt-2 text-sm text-neutral-600">
            Paste one customer per line (name and mobile), or upload a CSV from your contacts or job software. Each gets one text, no reminders. Only add real customers from the last few months.
          </p>
          <form action={bulkUpload} className="mt-3 space-y-2">
            <input type="hidden" name="token" value={token} />
            <textarea name="list" rows={5} placeholder={c.country === "US" ? "Sarah, (214) 555-0123\nMike Jones, (214) 555-0145" : "Sarah, 07700 900123\nMike Jones, 07700 900456"} className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-base" />
            <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" className="block w-full text-sm" />
            <button className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-base font-semibold text-white">Add customers</button>
          </form>
        </details>
      </div>
    </AppShell>
  );
}

function jobStatus(j: JobRow): { label: string; tone: string } {
  if (j.reviewed_at) return { label: "Reviewed on Google ✓", tone: "bg-green-100 text-green-800" };
  if (j.rating && j.rating >= 4) return { label: `${j.rating}★, sent to Google`, tone: "bg-green-100 text-green-800" };
  if (j.rating) return { label: `${j.rating}★${j.feedback_at ? ", left feedback" : ""}`, tone: "bg-amber-100 text-amber-900" };
  if (j.review_clicked_at) return { label: "Opened Google link", tone: "bg-green-100 text-green-800" };
  if (j.cancelled_reason === "opted_out") return { label: "Opted out", tone: "bg-neutral-100 text-neutral-600" };
  const sent = j.review_messages.filter((m) => m.sent_at).length;
  const pending = j.review_messages.some((m) => !m.sent_at && !m.cancelled_at);
  if (!sent && pending) return { label: "Scheduled", tone: "bg-blue-50 text-blue-800" };
  if (pending) return { label: `Sent ${sent}, reminder due`, tone: "bg-blue-50 text-blue-800" };
  if (!sent) return { label: "Stopped", tone: "bg-neutral-100 text-neutral-600" };
  return { label: sent === 1 ? "Sent" : `Sent ${sent} texts`, tone: "bg-neutral-100 text-neutral-700" };
}
