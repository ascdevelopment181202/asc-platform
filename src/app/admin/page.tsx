import Link from "next/link";
import { db, type Client, type Task } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { addClientManually, addClientQuietly, addTask, completeTask } from "./actions";
import { btn, btnQuiet, Countdown, fmt, input, StatusPill } from "./ui";
import { googleAccount } from "@/lib/google";
import { googleEnabled, seoEnv } from "@/lib/env";
import { listActions } from "@/lib/seo/store";
import { US_CARRIERS, US_TIMEZONES } from "@/lib/onboarding-fields";

export const dynamic = "force-dynamic";

const ORDER = ["building", "awaiting_form", "past_due", "live", "cancelled"];

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google: googleMsg } = await searchParams;
  const gAccount = googleEnabled() ? await googleAccount() : null;
  const [{ data: clients }, { data: tasks }] = await Promise.all([
    db().from("clients").select("*").order("paid_at", { ascending: false }).returns<Client[]>(),
    db().from("tasks").select("*").is("done_at", null).order("due_at", { ascending: true, nullsFirst: false }).returns<Task[]>(),
  ]);
  const seoOpen = seoEnv.on() ? await listActions({ statuses: ["new"], limit: 300 }).catch(() => []) : [];
  const all = (clients ?? []).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const byId = new Map(all.map((c) => [c.id, c]));
  const count = (s: string) => all.filter((c) => c.status === s).length;

  return (
    <div className="space-y-10">
      {googleMsg && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{googleMsg}</p>}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4">
        <div>
          <p className="text-sm font-medium">Google (Search Console and Business Profile)</p>
          <p className="text-xs text-neutral-500">
            {!googleEnabled()
              ? "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel to turn this on."
              : gAccount
                ? `Connected as ${gAccount.email ?? "your Google account"} on ${fmt(gAccount.connected_at)}. Rankings and profile numbers are on.`
                : "Not connected. Connect the Google account that manages your clients' Search Console and Business Profiles."}
          </p>
        </div>
        {googleEnabled() && (
          <a href="/admin/google/start" className={gAccount ? btnQuiet : btn}>{gAccount ? "Reconnect" : "Connect Google"}</a>
        )}
      </section>
      {seoEnv.on() && (
        <Link href="/admin/seo" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4 hover:bg-neutral-50">
          <div>
            <p className="text-sm font-medium">
              SEO: {seoOpen.length} to approve{seoOpen.some((a) => a.detail.alert) ? `, ${seoOpen.filter((a) => a.detail.alert).length} alert${seoOpen.filter((a) => a.detail.alert).length === 1 ? "" : "s"}` : ""}
            </p>
            <p className="text-xs text-neutral-500">{seoOpen[0] ? seoOpen[0].summary : "Nothing waiting. The next check runs at 5am."}</p>
          </div>
          <span className={btnQuiet}>Open the inbox</span>
        </Link>
      )}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Building" value={count("building")} />
        <Stat label="Awaiting form" value={count("awaiting_form")} />
        <Stat label="Live" value={count("live")} />
        <Stat label="Open tasks" value={tasks?.length ?? 0} />
      </section>

      <section>
        <h2 className="text-lg font-semibold">Tasks</h2>
        <div className="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {(tasks ?? []).length === 0 && <p className="p-4 text-sm text-neutral-500">Nothing open.</p>}
          {(tasks ?? []).map((t) => {
            const c = t.client_id ? byId.get(t.client_id) : undefined;
            return (
              <div key={t.id} className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-neutral-500">
                    {c && (
                      <Link className="underline" href={`/admin/clients/${c.id}`}>
                        {clientLabel(c)}
                      </Link>
                    )}
                    {t.due_at && <> · due {fmt(t.due_at)} · <Countdown due={t.due_at} /></>}
                  </p>
                </div>
                <form action={completeTask}>
                  <input type="hidden" name="taskId" value={t.id} />
                  <button className={btnQuiet}>Done</button>
                </form>
              </div>
            );
          })}
        </div>
        <form action={addTask} className="mt-3 flex flex-wrap gap-2">
          <input name="title" placeholder="New task" className={`${input} flex-1`} required />
          <input name="due" type="datetime-local" className={input} />
          <button className={btnQuiet}>Add</button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Clients</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-600">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Paid</th>
                <th className="px-4 py-3">Form in</th>
                <th className="px-4 py-3">Build deadline</th>
                <th className="px-4 py-3">Live site</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {all.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-neutral-500">
                    No clients yet. They appear here automatically when someone pays.
                  </td>
                </tr>
              )}
              {all.map((c) => (
                <tr key={c.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/clients/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                      {clientLabel(c)}
                    </Link>
                    <p className="text-xs text-neutral-500">{c.email}</p>
                  </td>
                  <td className="px-4 py-3"><StatusPill status={c.status} /></td>
                  <td className="px-4 py-3">{fmt(c.paid_at)}</td>
                  <td className="px-4 py-3">{fmt(c.form_submitted_at)}</td>
                  <td className="px-4 py-3">{c.status === "building" ? <Countdown due={c.build_due_at} /> : "-"}</td>
                  <td className="px-4 py-3">
                    {c.live_url ? <a className="text-blue-700 underline" href={c.live_url} target="_blank" rel="noreferrer">Open</a> : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Add a client manually</h2>
        <p className="mt-1 text-sm text-neutral-500">For clients who paid outside Stripe checkout. This sends the welcome email straight away.</p>
        <form action={addClientManually} className="mt-3 grid gap-2 sm:grid-cols-5">
          <input name="businessName" placeholder="Business name" className={input} />
          <input name="fullName" placeholder="Contact name" className={input} />
          <input name="email" type="email" placeholder="Email" className={input} required />
          <input name="phone" placeholder="Phone" className={input} />
          <button className={btn}>Add and send welcome</button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Add an existing client quietly</h2>
        <p className="mt-1 text-sm text-neutral-500">
          For clients you&apos;re setting up yourself. Nothing is sent to them: no welcome email, no form reminders. You set up their phone on their page and choose when they hear about it.
        </p>
        <form action={addClientQuietly} className="mt-3 grid gap-2 sm:grid-cols-3">
          <input name="businessName" placeholder="Business name" className={input} required />
          <input name="fullName" placeholder="Contact name" className={input} required />
          <input name="email" type="email" placeholder="Email" className={input} required />
          <input name="mobile" placeholder="Their mobile (07... or +1 for US)" className={input} required />
          <select name="country" defaultValue="GB" className={input}>
            <option value="GB">UK client</option>
            <option value="US">US client</option>
          </select>
          <select name="usTimezone" defaultValue="Eastern" className={input}>
            {Object.keys(US_TIMEZONES).map((k) => (
              <option key={k} value={k}>US time zone: {k}</option>
            ))}
          </select>
          <select name="carrier" defaultValue="" className={input}>
            <option value="">US carrier (if US)</option>
            {US_CARRIERS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <input name="liveUrl" type="url" placeholder="Live website (optional)" className={input} />
          <input name="reviewUrl" type="url" placeholder="Google review link (optional)" className={input} />
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input type="checkbox" name="emergency" /> They do emergency call-outs (after-hours text offers &ldquo;reply URGENT&rdquo;)
          </label>
          <button className={`${btn} sm:col-span-3`}>Add quietly</button>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
