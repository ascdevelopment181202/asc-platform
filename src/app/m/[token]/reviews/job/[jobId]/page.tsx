import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import { reviewText, type Contact, type Job } from "@/lib/sms";
import { fullWhen, loadClient, unreadTotal } from "../../../data";
import { AppShell, Flash, quietBtn } from "../../../ui";
import { stopRequest } from "../../google-actions";

export const dynamic = "force-dynamic";

/** One review request: what will be sent, when, and a big button to stop it. */
export default async function RequestPage({ params, searchParams }: { params: Promise<{ token: string; jobId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token, jobId } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const { data: job } = await db().from("jobs").select("*").eq("id", jobId).eq("client_id", c.id).maybeSingle<Job>();
  if (!job) notFound();
  const [{ data: contact }, { data: msgs }, unread] = await Promise.all([
    db().from("contacts").select("*").eq("id", job.contact_id).single<Contact>(),
    db().from("review_messages").select("step, send_at, sent_at, cancelled_at").eq("job_id", job.id).order("step").returns<{ step: number; send_at: string; sent_at: string | null; cancelled_at: string | null }[]>(),
    unreadTotal(c.id),
  ]);
  const tz = c.timezone || "Europe/London";
  const locale = localeFor(c.country);
  const next = (msgs ?? []).find((m) => !m.sent_at && !m.cancelled_at);
  const anySent = (msgs ?? []).some((m) => m.sent_at);
  const who = contact?.name ?? displayPhone(contact?.phone);

  return (
    <AppShell token={token} active="reviews" unread={unread} title="Review request">
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4 p-4">
        <Link href={`/m/${token}/reviews`} className="text-sm text-[#2a78d6]">← Reviews</Link>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-sm text-neutral-500">For</p>
          <Link href={`/m/${token}/contacts/${job.contact_id}`} className="text-lg font-semibold">{who}</Link>
          {job.cancelled_at ? (
            <p className="mt-3 rounded-xl bg-neutral-100 p-3 text-sm text-neutral-700">Stopped. Nothing more will be sent.</p>
          ) : next ? (
            <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
              {anySent ? "Next reminder" : "Goes out"} <strong>{fullWhen(next.send_at, tz, locale)}</strong>
              {" "}(between 9am and 7pm only).
            </p>
          ) : (
            <p className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-900">{job.review_clicked_at ? "They've opened your review link. 🎉" : "All sent."}</p>
          )}
          {contact && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">The text</p>
              <p className="mt-1 rounded-2xl rounded-br-sm bg-[#2a78d6] p-3 text-sm text-white">{reviewText(c, contact, job, anySent ? 2 : 1)}</p>
            </div>
          )}
        </section>
        {!job.cancelled_at && next && (
          <form action={stopRequest}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="back" value={`/m/${token}/reviews/job/${job.id}`} />
            <button className={`${quietBtn} !text-red-700`}>{anySent ? "Stop the reminders" : "Job not done yet, don't send"}</button>
          </form>
        )}
      </div>
    </AppShell>
  );
}
