import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { displayUk } from "@/lib/phone";
import { env } from "@/lib/env";
import { bulkUpload, jobDone } from "./actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; err?: string }> };

type CallRow = { id: string; created_at: string; from_number: string | null; text_sent: boolean; skipped_reason: string | null; contact_id: string | null; contacts: { name: string | null } | null };
type ReplyRow = { contact_id: string | null; body: string | null; created_at: string };
type JobRow = {
  id: string;
  created_at: string;
  source: string;
  review_clicked_at: string | null;
  cancelled_reason: string | null;
  contacts: { name: string | null; phone: string } | null;
  review_messages: { step: number; sent_at: string | null; cancelled_at: string | null }[];
};

const SKIP_LABELS: Record<string, string> = {
  withheld: "Withheld number, no text",
  landline: "Landline, no text",
  international: "International number, no text",
  repeat_caller: "Called again, already texted",
  opted_out: "Opted out of texts",
  sms_disabled: "Texts switched off",
  send_failed: "Text failed to send",
};

async function load(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const { data } = await db().from("clients").select("*").eq("dashboard_token", token).maybeSingle<Client>();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const c = await load(token);
  const name = c ? clientLabel(c) : "Dashboard";
  return {
    title: `${name} · Calls & reviews`,
    robots: { index: false, follow: false },
    manifest: `/m/${token}/manifest`,
    appleWebApp: { capable: true, title: "Calls & reviews", statusBarStyle: "default" },
    icons: { apple: "/api/app-icon?s=180", icon: "/api/app-icon?s=192" },
  };
}

export const viewport: Viewport = { themeColor: "#2a78d6", width: "device-width", initialScale: 1 };

/** The client's phone dashboard for missed call texts and review requests. Built to be added to the home screen. */
export default async function CallsDashboard({ params, searchParams }: Props) {
  const { token } = await params;
  const { ok, err } = await searchParams;
  const c = await load(token);
  if (!c) notFound();

  const tz = c.timezone || "Europe/London";
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const supabase = db();

  const [caught, replies, asked, clicked, { data: calls }, { data: recentReplies }, { data: jobs }] = await Promise.all([
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("client_id", c.id).eq("text_sent", true).gte("created_at", monthStart),
    supabase.from("replies").select("id", { count: "exact", head: true }).eq("client_id", c.id).gte("created_at", monthStart),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("client_id", c.id).gte("created_at", monthStart),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("client_id", c.id).gte("created_at", monthStart).not("review_clicked_at", "is", null),
    supabase.from("calls").select("id, created_at, from_number, text_sent, skipped_reason, contact_id, contacts(name)").eq("client_id", c.id).order("created_at", { ascending: false }).limit(25).returns<CallRow[]>(),
    supabase.from("replies").select("contact_id, body, created_at").eq("client_id", c.id).order("created_at", { ascending: false }).limit(200).returns<ReplyRow[]>(),
    supabase.from("jobs").select("id, created_at, source, review_clicked_at, cancelled_reason, contacts(name, phone), review_messages(step, sent_at, cancelled_at)").eq("client_id", c.id).order("created_at", { ascending: false }).limit(25).returns<JobRow[]>(),
  ]);

  const replyAfter = (call: CallRow) =>
    (recentReplies ?? []).filter((r) => r.contact_id && r.contact_id === call.contact_id && r.created_at >= call.created_at).at(-1);

  const when = (iso: string) => {
    const d = new Date(iso);
    const sameDay = d.toLocaleDateString("en-GB", { timeZone: tz }) === now.toLocaleDateString("en-GB", { timeZone: tz });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    return sameDay ? `Today ${time}` : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: tz })}, ${time}`;
  };

  const ready = c.sms_enabled && !!c.twilio_number;
  const monthName = now.toLocaleDateString("en-GB", { month: "long", timeZone: tz });

  return (
    <div id="top" className="min-h-screen bg-[#f6f6f4] pb-10 text-neutral-900">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-4 py-3">
          <p className="font-semibold leading-tight">{clientLabel(c)}</p>
          <p className="text-xs text-neutral-500">Missed calls and reviews</p>
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        {ok && <p className="rounded-xl bg-green-50 p-3 text-sm text-green-900" role="status">{ok}</p>}
        {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-900" role="alert">{err}</p>}
        {!ready && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Texts aren&apos;t switched on yet. ASC will let you know when everything is live.</p>}

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Finished a job?</h2>
          <p className="mt-0.5 text-sm text-neutral-600">We&apos;ll text your customer asking for a Google review.</p>
          <form action={jobDone} className="mt-3 space-y-2">
            <input type="hidden" name="token" value={token} />
            <input name="name" placeholder="Customer's first name" autoComplete="off" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
            <input name="phone" type="tel" inputMode="tel" placeholder="Their mobile (07...)" required autoComplete="off" className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base" />
            <button className="w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-base font-semibold text-white active:bg-[#1f62b3]">Job done, ask for a review</button>
          </form>
          {c.twilio_number && (
            <p className="mt-3 text-xs text-neutral-500">
              Or text <strong>DONE 07700900123 Sarah</strong> to {displayUk(c.twilio_number)} from your phone.
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-neutral-600">{monthName} so far</h2>
          <div className="grid grid-cols-2 gap-2">
            <Tile value={caught.count ?? 0} label="Missed calls texted back" />
            <Tile value={replies.count ?? 0} label="Customer replies" />
            <Tile value={asked.count ?? 0} label="Review requests" />
            <Tile value={clicked.count ?? 0} label="Opened the review link" />
          </div>
        </section>

        <Panel title="Missed calls">
          {(calls ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">No missed calls yet. When someone calls and you can&apos;t answer, they&apos;ll show up here.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {(calls ?? []).map((call) => {
                const reply = replyAfter(call);
                const number = call.from_number;
                return (
                  <li key={call.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{call.contacts?.name ?? displayUk(number)}</p>
                        <p className="text-xs text-neutral-500">
                          {when(call.created_at)} · {call.text_sent ? "Texted back" : (SKIP_LABELS[call.skipped_reason ?? ""] ?? "No text")}
                        </p>
                        {reply && <p className="mt-1 rounded-lg bg-neutral-100 px-2 py-1 text-sm">&ldquo;{reply.body}&rdquo;</p>}
                      </div>
                      {number?.startsWith("+") && (
                        <div className="flex shrink-0 gap-1.5">
                          <a href={`tel:${number}`} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium">Call</a>
                          <a href={`sms:${number}`} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium">Text</a>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Review requests">
          {(jobs ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">None yet. Tap &ldquo;Job done&rdquo; above after each job.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {(jobs ?? []).map((j) => (
                <li key={j.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{j.contacts?.name ?? displayUk(j.contacts?.phone)}</p>
                    <p className="text-xs text-neutral-500">{when(j.created_at)}{j.source === "bulk" ? " · past customer" : ""}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${jobStatus(j).tone}`}>{jobStatus(j).label}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <details className="rounded-2xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">Ask past customers for reviews</summary>
          <p className="mt-2 text-sm text-neutral-600">
            Paste one customer per line (name and mobile), or upload a CSV from your contacts or job software. Each gets one text, no reminders. Only add real customers from the last few months.
          </p>
          <form action={bulkUpload} className="mt-3 space-y-2">
            <input type="hidden" name="token" value={token} />
            <textarea name="list" rows={5} placeholder={"Sarah, 07700 900123\nMike Jones, 07700 900456"} className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-base" />
            <input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" className="block w-full text-sm" />
            <button className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-base font-semibold text-white">Add customers</button>
          </form>
        </details>

        <details className="rounded-2xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">Put this on your home screen</summary>
          <ul className="mt-2 space-y-1.5 text-sm text-neutral-700">
            <li><strong>iPhone:</strong> open this page in Safari, tap the Share button, then &ldquo;Add to Home Screen&rdquo;.</li>
            <li><strong>Android:</strong> open in Chrome, tap the three dots, then &ldquo;Add to Home screen&rdquo; or &ldquo;Install app&rdquo;.</li>
          </ul>
        </details>

        <footer className="pt-2 text-center text-xs text-neutral-500">
          Looked after by ASC Development. Questions? Call or text {env.contactPhone}.
        </footer>
      </main>
    </div>
  );
}

function jobStatus(j: JobRow): { label: string; tone: string } {
  if (j.review_clicked_at) return { label: "Opened link", tone: "bg-green-100 text-green-800" };
  if (j.cancelled_reason === "opted_out") return { label: "Opted out", tone: "bg-neutral-100 text-neutral-600" };
  const sent = j.review_messages.filter((m) => m.sent_at).length;
  const pending = j.review_messages.some((m) => !m.sent_at && !m.cancelled_at);
  if (!sent && pending) return { label: "Scheduled", tone: "bg-blue-50 text-blue-800" };
  if (pending) return { label: `Sent ${sent}, reminder due`, tone: "bg-blue-50 text-blue-800" };
  if (!sent) return { label: "Stopped", tone: "bg-neutral-100 text-neutral-600" };
  return { label: sent === 1 ? "Sent" : `Sent ${sent} texts`, tone: "bg-neutral-100 text-neutral-700" };
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-3xl font-semibold tracking-tight">{value.toLocaleString("en-GB")}</p>
      <p className="mt-0.5 text-xs text-neutral-600">{label}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="mb-1 font-semibold">{title}</h2>
      {children}
    </section>
  );
}
