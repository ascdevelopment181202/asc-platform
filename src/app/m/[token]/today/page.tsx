import Link from "next/link";
import { notFound } from "next/navigation";
import { displayPhone } from "@/lib/phone";
import { todaysCustomers } from "@/lib/today";
import { loadClient, unreadTotal } from "../data";
import { AppShell, Avatar, Flash } from "../ui";
import { askFromToday } from "../crm-actions";
import { jobDone } from "../actions";

export const dynamic = "force-dynamic";

/** Everyone they dealt with today, one tap each to ask for a review. Opened from the 6pm notification. */
export default async function Today({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const [rows, unread] = await Promise.all([todaysCustomers(c), unreadTotal(c.id)]);
  const back = `/m/${token}/today`;
  const toAsk = rows.filter((r) => !r.asked);

  return (
    <AppShell token={token} active="more" unread={unread} title="Today's customers">
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4 p-4">
        <p className="text-sm text-neutral-600">
          {toAsk.length ? "Tap Ask for anyone whose job is finished. We'll text them in about 2 hours." : rows.length ? "Everyone from today has been asked. Nice work." : "Nobody in the app today yet. Add anyone below."}
        </p>
        {rows.length > 0 && (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white shadow-sm">
            {rows.map((r) => (
              <li key={r.contact.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={r.contact.name} phone={r.contact.phone} />
                <Link href={`/m/${token}/contacts/${r.contact.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.contact.name ?? displayPhone(r.contact.phone)}</p>
                  <p className="truncate text-xs text-neutral-500">{r.why}</p>
                </Link>
                {r.asked ? (
                  <Link href={`/m/${token}/reviews/job/${r.asked.jobId}`} className="shrink-0 rounded-full bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800">Asked ✓</Link>
                ) : (
                  <form action={askFromToday}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="contactId" value={r.contact.id} />
                    <input type="hidden" name="label" value={r.label ?? ""} />
                    <input type="hidden" name="appointmentId" value={r.appointmentId ?? ""} />
                    <input type="hidden" name="back" value={back} />
                    <button className="shrink-0 rounded-full bg-[#2a78d6] px-4 py-2 text-sm font-semibold text-white active:bg-[#1f62b3]">Ask</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Someone else?</h2>
          <p className="mt-0.5 text-sm text-neutral-600">A job you sorted by phone, WhatsApp or at the door.</p>
          <form action={jobDone} className="mt-3 space-y-2">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="back" value={back} />
            <div className="flex gap-2">
              <input name="name" placeholder="First name" autoComplete="off" className="w-2/5 min-w-0 rounded-xl border border-neutral-300 px-3 py-3 text-base" />
              <input name="phone" type="tel" inputMode="tel" required placeholder={c.country === "US" ? "Cell number" : "Mobile (07...)"} autoComplete="off" className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-3 text-base" />
            </div>
            <input name="job" placeholder="What was the job? (optional)" autoComplete="off" className="w-full rounded-xl border border-neutral-300 px-3 py-3 text-base" />
            <button className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-base font-semibold text-white">Ask for a review</button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
