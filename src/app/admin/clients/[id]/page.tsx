import Link from "next/link";
import { notFound } from "next/navigation";
import { ASSETS_BUCKET } from "@/lib/env";
import { db, type Client, type Task } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { formLink } from "@/lib/onboarding";
import { FIELD_LABELS } from "@/lib/onboarding-fields";
import { completeTask, markLive, resendWelcome, saveNotes } from "../../actions";
import { generateSiteAction, saveDomain, saveGoogleSettings, saveReportNote, sendReportNow, setPublished, writeSeoPagesAction } from "../../site-actions";
import { dashboardUrl, lastThirtyDays, rankLine, REPORT_DAYS, reportStats } from "@/lib/reports";
import { googleAccount, listBusinessLocations, listSearchConsoleSites, type GbpLocation } from "@/lib/google";
import { googleEnabled } from "@/lib/env";
import { allPaths } from "@/lib/seo-pages";
import { seoAiEnabled } from "@/lib/seo-ai";
import type { Site } from "@/lib/sites";
import { env } from "@/lib/env";
import { btn, btnQuiet, Countdown, fmt, input, StatusPill } from "../../ui";
import { resendPhoneWelcome, saveSmsSettings, sendTestText, setUpPhone } from "../../sms-actions";
import { DEFAULT_TEMPLATES, TEMPLATE_HELP } from "@/lib/sms";
import { displayUk } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Submission = { id: string; created_at: string; data: Record<string, unknown>; logo_path: string | null; photo_paths: string[] };
type Message = { id: string; kind: string; created_at: string };

const MESSAGE_LABELS: Record<string, string> = {
  welcome_email: "Welcome email sent",
  admin_new_client: "You were notified of payment",
  chase_24: "24-hour chase email sent",
  chase_48: "48-hour chase email sent",
  chase_72_call: "72-hour call task created",
  form_received_email: "Form confirmation email sent",
  admin_form_submitted: "You were notified the form is in",
  build_due_soon: "12-hour build warning",
  build_overdue: "Build overdue alert",
  launch_email: "Launch email sent",
  day30_report: "Day-30 report task created",
};

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = db();
  const { data: c } = await supabase.from("clients").select("*").eq("id", id).maybeSingle<Client>();
  if (!c) notFound();

  type Enquiry = { id: string; created_at: string; name: string; phone: string | null; email: string | null; service: string | null; message: string | null };
  const [{ data: sub }, { data: messages }, { data: tasks }, { data: site }, { data: leads }] = await Promise.all([
    supabase.from("onboarding_submissions").select("*").eq("client_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle<Submission>(),
    supabase.from("client_messages").select("id, kind, created_at").eq("client_id", id).order("created_at").returns<Message[]>(),
    supabase.from("tasks").select("*").eq("client_id", id).is("done_at", null).returns<Task[]>(),
    supabase.from("sites").select("*").eq("client_id", id).maybeSingle<Site>(),
    supabase.from("enquiries").select("id, created_at, name, phone, email, service, message").eq("client_id", id).order("created_at", { ascending: false }).limit(50).returns<Enquiry[]>(),
  ]);
  type SmsRow = { id: string; created_at: string; to_number: string; kind: string; status: string; error: string | null };
  const { data: smsLog } = await supabase.from("sms_log").select("id, created_at, to_number, kind, status, error").eq("client_id", id).order("created_at", { ascending: false }).limit(8).returns<SmsRow[]>();
  const previewUrl = site ? `${env.appUrl}/s/${site.slug}` : null;
  const seoTotal = site ? allPaths(site.content).length - 1 : 0;
  const { count: seoWritten } = site
    ? await supabase.from("seo_pages").select("id", { count: "exact", head: true }).eq("site_id", site.id)
    : { count: 0 };

  const stats = site ? await reportStats(site, lastThirtyDays()) : null;
  const gConnected = googleEnabled() && !!(await googleAccount());
  let gscSites: string[] | null = null;
  let gbpLocations: GbpLocation[] | null = null;
  let gError = "";
  if (site && gConnected) {
    const [a, b] = await Promise.allSettled([listSearchConsoleSites(), listBusinessLocations()]);
    if (a.status === "fulfilled") gscSites = a.value;
    else gError += `Search Console: ${a.reason instanceof Error ? a.reason.message : a.reason}. `;
    if (b.status === "fulfilled") gbpLocations = b.value;
    else gError += `Business Profile: ${b.reason instanceof Error ? b.reason.message : b.reason}.`;
  }
  const period = REPORT_DAYS * 86400_000;
  const nextReport =
    c.launched_at && stats
      ? new Date(Date.parse(c.launched_at) + (Math.floor((stats.period.to.getTime() - 86400_000 - Date.parse(c.launched_at)) / period) + 1) * period)
      : null;

  const paths = sub ? [sub.logo_path, ...sub.photo_paths].filter((p): p is string => !!p) : [];
  const { data: signed } = paths.length
    ? await supabase.storage.from(ASSETS_BUCKET).createSignedUrls(paths, 3600)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlFor = (p: string) => signed?.find((s) => s.path === p)?.signedUrl ?? undefined;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-neutral-500 hover:underline">← All clients</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{clientLabel(c)}</h1>
          <StatusPill status={c.status} />
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          {c.full_name ?? "No name"} · {c.email} · {c.phone ?? "no phone"}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-4">
        <Fact label="Paid" value={fmt(c.paid_at)} />
        <Fact label="Form in" value={fmt(c.form_submitted_at)} />
        <Fact label="Build deadline" value={c.status === "building" ? <Countdown due={c.build_due_at} /> : fmt(c.build_due_at)} />
        <Fact label="Launched" value={fmt(c.launched_at)} />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Onboarding answers">
            {!sub ? (
              <div className="space-y-3 text-sm">
                <p className="text-neutral-600">Not submitted yet. Form link:</p>
                <code className="block break-all rounded-lg bg-neutral-100 p-3 text-xs">{formLink(c)}</code>
                <form action={resendWelcome}>
                  <input type="hidden" name="clientId" value={c.id} />
                  <button className={btnQuiet}>Resend welcome email</button>
                </form>
              </div>
            ) : (
              <dl className="divide-y divide-neutral-100 text-sm">
                {Object.entries(sub.data)
                  .filter(([, v]) => v !== "" && v !== false && v != null)
                  .map(([k, v]) => (
                    <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-3">
                      <dt className="text-neutral-500">{FIELD_LABELS[k] ?? k}</dt>
                      <dd className="whitespace-pre-wrap sm:col-span-2">{v === true ? "Yes" : String(v)}</dd>
                    </div>
                  ))}
              </dl>
            )}
          </Card>

          <Card title={`Leads from website (${leads?.length ?? 0})`}>
            {(leads ?? []).length === 0 ? (
              <p className="text-sm text-neutral-500">No enquiries yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm">
                {(leads ?? []).map((l) => (
                  <li key={l.id} className="py-2.5">
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{l.name}{l.service ? ` · ${l.service}` : ""}</span>
                      <span className="shrink-0 text-neutral-500">{fmt(l.created_at)}</span>
                    </div>
                    <p className="text-neutral-600">{[l.phone, l.email].filter(Boolean).join(" · ")}</p>
                    {l.message && <p className="mt-1 text-neutral-500">{l.message}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {paths.length > 0 && (
            <Card title={`Logo and photos (${paths.length})`}>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {paths.map((p) => {
                  const url = urlFor(p);
                  const isLogo = p === sub?.logo_path;
                  return (
                    <a key={p} href={url} target="_blank" rel="noreferrer" className="group block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="aspect-square w-full rounded-lg border border-neutral-200 bg-neutral-100 object-cover" />
                      <span className="mt-1 block text-xs text-neutral-500">{isLogo ? "Logo" : "Photo"} · download</span>
                    </a>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-neutral-500">Links expire after an hour. Reload the page for fresh ones.</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Website">
            {!sub ? (
              <p className="text-sm text-neutral-500">Available once the onboarding form is in.</p>
            ) : !site ? (
              <form action={generateSiteAction}>
                <input type="hidden" name="clientId" value={c.id} />
                <p className="mb-3 text-sm text-neutral-600">Builds their site from the form answers and photos.</p>
                <button className={`${btn} w-full`}>Generate site</button>
              </form>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className={site.published ? "font-medium text-green-700" : "font-medium text-amber-700"}>{site.published ? "Published" : "Draft"}</span>
                  <a href={previewUrl!} target="_blank" rel="noreferrer" className="text-blue-700 underline">Preview</a>
                </div>
                {site.domain && site.published && (
                  <a href={`https://${site.domain}`} target="_blank" rel="noreferrer" className="block break-all text-blue-700 underline">https://{site.domain}</a>
                )}
                <div className="flex gap-2">
                  <form action={generateSiteAction} className="flex-1">
                    <input type="hidden" name="clientId" value={c.id} />
                    <button className={`${btnQuiet} w-full`}>Rebuild</button>
                  </form>
                  <form action={setPublished} className="flex-1">
                    <input type="hidden" name="clientId" value={c.id} />
                    <input type="hidden" name="published" value={site.published ? "false" : "true"} />
                    <button className={`${site.published ? btnQuiet : btn} w-full`}>{site.published ? "Unpublish" : "Publish"}</button>
                  </form>
                </div>
                <div className="rounded-lg bg-neutral-50 p-3">
                  <p className="font-medium">SEO pages: {seoWritten ?? 0} of {seoTotal} written</p>
                  <p className="mt-1 text-xs text-neutral-500">Each service, area and service-in-area page gets its own copy written by Claude. Takes 1 to 2 minutes.</p>
                  {seoAiEnabled() ? (
                    <form action={writeSeoPagesAction} className="mt-2">
                      <input type="hidden" name="clientId" value={c.id} />
                      <input type="hidden" name="onlyMissing" value={(seoWritten ?? 0) > 0 ? "true" : "false"} />
                      <button className={`${btnQuiet} w-full`}>{(seoWritten ?? 0) === 0 ? "Write SEO pages" : (seoWritten ?? 0) < seoTotal ? "Write missing pages" : "All written"}</button>
                    </form>
                  ) : (
                    <p className="mt-2 text-xs text-amber-700">Add ANTHROPIC_API_KEY in Vercel to enable this.</p>
                  )}
                  {site.published && <a href={site.domain ? `https://${site.domain}/sitemap.xml` : `${previewUrl}/sitemap`} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-blue-700 underline">Sitemap</a>}
                </div>
                <form action={saveDomain} className="space-y-2">
                  <input type="hidden" name="clientId" value={c.id} />
                  <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">Custom domain</label>
                  <div className="flex gap-2">
                    <input name="domain" defaultValue={site.domain ?? ""} placeholder="smithplumbing.co.uk" className={`${input} min-w-0 flex-1`} />
                    <button className={btnQuiet}>Save</button>
                  </div>
                  <p className="text-xs text-neutral-500">Then add the domain to the asc-platform project in Vercel and point its DNS there.</p>
                </form>
              </div>
            )}
          </Card>

          {site && stats && (
            <Card title="Monthly report">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Enquiries" value={stats.enquiries} />
                <Stat label="Phone taps" value={stats.calls} />
                <Stat label="Visits" value={stats.visits} />
              </div>
              {stats.insights.gbp && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <Stat label="Google calls" value={stats.insights.gbp.calls} />
                  <Stat label="Directions" value={stats.insights.gbp.directions} />
                  <Stat label="Profile views" value={stats.insights.gbp.views} />
                </div>
              )}
              {stats.insights.search && stats.insights.search.rankings.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {stats.insights.search.rankings.slice(0, 5).map((r) => (
                    <li key={r.query} className="flex justify-between gap-2"><span className="truncate">{r.query}</span><span className="shrink-0 font-medium">{rankLine(r)}</span></li>
                  ))}
                </ul>
              )}
              <a href={dashboardUrl(c)} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-blue-700 underline">Client&apos;s live dashboard</a>
              <p className="mt-2 text-xs text-neutral-500">Last 30 days. {site.published ? "" : "Visits are only counted once the site is published. "}
                {nextReport ? `Next report sends automatically on ${fmt(nextReport.toISOString())}.` : "Reports start 30 days after you mark the client live."}
              </p>
              <form action={saveReportNote} className="mt-3 space-y-2">
                <input type="hidden" name="clientId" value={c.id} />
                <label className="block text-xs font-medium text-neutral-600">What we did this month (one per line, goes in the next report)</label>
                <textarea name="note" rows={3} defaultValue={c.report_note ?? ""} placeholder={"Added 3 new photos to the gallery\nPosted twice on your Google profile"} className={`${input} w-full`} />
                <button className={`${btnQuiet} w-full`}>Save note</button>
              </form>
              <div className="mt-2 flex gap-2">
                <a href={`/admin/clients/${c.id}/report`} target="_blank" rel="noreferrer" className={`${btnQuiet} flex-1 text-center`}>Preview</a>
                <form action={sendReportNow} className="flex-1">
                  <input type="hidden" name="clientId" value={c.id} />
                  <button className={`${btnQuiet} w-full`}>Send now</button>
                </form>
              </div>
            </Card>
          )}

          {site && (
            <Card title="Google">
              {!gConnected ? (
                <p className="text-sm text-neutral-500">Connect Google on the admin home page first. Then pick this client&apos;s Search Console site and Business Profile here.</p>
              ) : (
                <form action={saveGoogleSettings} className="space-y-3">
                  <input type="hidden" name="clientId" value={c.id} />
                  <label className="block text-xs font-medium text-neutral-600">
                    Search Console property
                    {gscSites ? (
                      <select name="gsc" defaultValue={site.gsc_property ?? ""} className={`${input} mt-1 w-full`}>
                        <option value="">Not linked</option>
                        {[...new Set([...(site.gsc_property ? [site.gsc_property] : []), ...gscSites])].map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    ) : (
                      <input name="gsc" defaultValue={site.gsc_property ?? (site.domain ? `sc-domain:${site.domain}` : "")} placeholder="sc-domain:example.co.uk" className={`${input} mt-1 w-full`} />
                    )}
                  </label>
                  <label className="block text-xs font-medium text-neutral-600">
                    Business Profile
                    {gbpLocations ? (
                      <select name="gbp" defaultValue={site.gbp_location ? `${site.gbp_location}|${site.gbp_title ?? ""}` : ""} className={`${input} mt-1 w-full`}>
                        <option value="">Not linked</option>
                        {site.gbp_location && !gbpLocations.some((l) => l.name === site.gbp_location) && (
                          <option value={`${site.gbp_location}|${site.gbp_title ?? ""}`}>{site.gbp_title ?? site.gbp_location}</option>
                        )}
                        {gbpLocations.map((l) => (
                          <option key={l.name} value={`${l.name}|${l.title}`}>{l.title} ({l.address})</option>
                        ))}
                      </select>
                    ) : (
                      <input name="gbp" defaultValue={site.gbp_location ? `${site.gbp_location}|${site.gbp_title ?? ""}` : ""} placeholder="locations/1234567890" className={`${input} mt-1 w-full`} />
                    )}
                  </label>
                  {gError && <p className="text-xs text-amber-700">{gError}</p>}
                  <button className={`${btnQuiet} w-full`}>Save</button>
                </form>
              )}
              {stats?.insights.errors.length ? <p className="mt-2 text-xs text-red-700">{stats.insights.errors.join(" ")}</p> : null}
            </Card>
          )}

          <Card title="Missed calls & reviews">
            <div className="mb-3 space-y-1 text-sm">
              <p>
                Status: <strong className={c.sms_enabled ? "text-green-700" : "text-neutral-500"}>{c.sms_enabled ? "Texts on" : "Texts off"}</strong>
                {c.last_forwarded_call_at && <span className="text-neutral-500"> · last forwarded call {fmt(c.last_forwarded_call_at)}</span>}
              </p>
              <p className="break-all text-xs text-neutral-600">
                Client app: <a className="underline" href={`${env.appUrl}/m/${c.dashboard_token}`}>{`${env.appUrl}/m/${c.dashboard_token}`}</a>
              </p>
              {c.twilio_number && (
                <p className="text-xs text-neutral-600">
                  Forwarding codes for their phone: <code>**61*{c.twilio_number}*11*20#</code> (no answer), <code>**67*{c.twilio_number}#</code> (busy), <code>**62*{c.twilio_number}#</code> (unreachable)
                </p>
              )}
            </div>
            {!c.twilio_number ? (
              <form action={setUpPhone} className="mb-3 rounded-lg bg-blue-50 p-3 text-sm">
                <input type="hidden" name="clientId" value={c.id} />
                <p className="mb-2">
                  One click: buys a UK mobile number (about £1.89/month), points it at the app, switches texts on, and texts and emails {c.owner_mobile ? displayUk(c.owner_mobile) : "the owner"} their app link and forwarding codes.
                </p>
                <button className={`${btn} w-full`} disabled={!c.owner_mobile}>{c.owner_mobile ? "Set up phone" : "Needs the owner's mobile first"}</button>
              </form>
            ) : (
              <form action={resendPhoneWelcome} className="mb-3">
                <input type="hidden" name="clientId" value={c.id} />
                <button className={`${btnQuiet} w-full`}>Resend app link and forwarding codes</button>
              </form>
            )}
            <form action={saveSmsSettings} className="space-y-2 text-sm">
              <input type="hidden" name="clientId" value={c.id} />
              <label className="block">Twilio number<input name="twilio_number" defaultValue={c.twilio_number ?? ""} placeholder="+447..." className={`${input} mt-1 w-full`} /></label>
              <label className="block">Owner&apos;s mobile (gets replies, sends DONE)<input name="owner_mobile" defaultValue={c.owner_mobile ?? ""} placeholder="07..." className={`${input} mt-1 w-full`} /></label>
              <label className="block">Google review link<input name="google_review_url" defaultValue={c.google_review_url ?? ""} placeholder="https://search.google.com/local/writereview?placeid=..." className={`${input} mt-1 w-full`} /></label>
              <fieldset className="flex flex-wrap items-center gap-2">
                <legend className="mb-1">Opening hours (picks the missed-call text)</legend>
                <input name="hours_start" type="time" defaultValue={c.business_hours?.start ?? "08:00"} className={input} />
                <span>to</span>
                <input name="hours_end" type="time" defaultValue={c.business_hours?.end ?? "18:00"} className={input} />
                <div className="flex flex-wrap gap-2 text-xs">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
                    <label key={d} className="flex items-center gap-1">
                      <input type="checkbox" name="hours_days" value={i + 1} defaultChecked={(c.business_hours?.days ?? [1, 2, 3, 4, 5, 6]).includes(i + 1)} />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
              <details>
                <summary className="cursor-pointer text-neutral-600">Text templates (leave blank for the defaults)</summary>
                <p className="mt-1 text-xs text-neutral-500">{TEMPLATE_HELP}</p>
                {([
                  ["missed_call_template", "Missed call, open", DEFAULT_TEMPLATES.missed_call],
                  ["missed_call_after_hours_template", "Missed call, closed", DEFAULT_TEMPLATES.missed_call_after_hours],
                  ["review_template", "Review request", DEFAULT_TEMPLATES.review],
                  ["review_followup_template", "Review reminder", DEFAULT_TEMPLATES.review_followup],
                ] as const).map(([name, label, placeholder]) => (
                  <label key={name} className="mt-2 block text-xs">
                    {label}
                    <textarea name={name} rows={3} defaultValue={c[name] ?? ""} placeholder={placeholder} className={`${input} mt-1 w-full`} />
                  </label>
                ))}
              </details>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="forward_replies" defaultChecked={c.forward_replies} /> Also text new customer messages to the owner&apos;s phone
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="sms_enabled" defaultChecked={c.sms_enabled} /> Texts switched on
              </label>
              <button className={`${btn} w-full`}>Save</button>
            </form>
            {c.twilio_number && c.owner_mobile && (
              <form action={sendTestText} className="mt-2">
                <input type="hidden" name="clientId" value={c.id} />
                <button className={`${btnQuiet} w-full`}>Send test text to {displayUk(c.owner_mobile)}</button>
              </form>
            )}
            {(smsLog ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-xs">
                {(smsLog ?? []).map((m) => (
                  <li key={m.id} className="flex justify-between gap-2">
                    <span>{m.kind.replace("_", " ")} to {displayUk(m.to_number)}</span>
                    <span className={m.status === "failed" || m.status === "undelivered" ? "text-red-700" : "text-neutral-500"} title={m.error ?? undefined}>{m.status} · {fmt(m.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Go live">
            <form action={markLive} className="space-y-3 text-sm">
              <input type="hidden" name="clientId" value={c.id} />
              <input name="liveUrl" defaultValue={c.live_url ?? ""} placeholder="https://..." className={`${input} w-full`} required />
              <label className="flex items-center gap-2">
                <input type="checkbox" name="sendEmail" defaultChecked={!c.launched_at} /> Send the launch email
              </label>
              <button className={`${btn} w-full`}>{c.launched_at ? "Update live URL" : "Mark live"}</button>
            </form>
          </Card>

          <Card title="Open tasks">
            {(tasks ?? []).length === 0 && <p className="text-sm text-neutral-500">None.</p>}
            {(tasks ?? []).map((t) => (
              <form key={t.id} action={completeTask} className="flex items-start justify-between gap-3 py-2 text-sm">
                <input type="hidden" name="taskId" value={t.id} />
                <span>{t.title}</span>
                <button className={btnQuiet}>Done</button>
              </form>
            ))}
          </Card>

          <Card title="Timeline">
            <ul className="space-y-2 text-sm">
              {(messages ?? []).map((m) => (
                <li key={m.id} className="flex justify-between gap-3">
                  <span>{(MESSAGE_LABELS[m.kind] ?? (m.kind.startsWith("report_manual") ? "Report sent manually" : m.kind.startsWith("report_") ? `Monthly report ${m.kind.slice(7)} sent` : undefined)) ?? (m.kind.startsWith("welcome_resent") ? "Welcome email resent" : m.kind)}</span>
                  <span className="shrink-0 text-neutral-500">{fmt(m.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Notes">
            <form action={saveNotes} className="space-y-2">
              <input type="hidden" name="clientId" value={c.id} />
              <textarea name="notes" rows={5} defaultValue={c.notes ?? ""} className={`${input} w-full`} />
              <button className={btnQuiet}>Save notes</button>
            </form>
          </Card>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-2">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}
