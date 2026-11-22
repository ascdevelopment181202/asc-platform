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
import { countryOf, EMERGENCY_AFTER_HOURS, TEMPLATE_HELP, templatesFor } from "@/lib/sms";
import { displayUk, forwardingCodes } from "@/lib/phone";
import { a2pStatus } from "@/lib/twilio";
import { saveBranding, saveReviewLocation } from "../../brand-actions";

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

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sms_ok?: string; sms_err?: string; brand_ok?: string; brand_err?: string }> }) {
  const sp = await searchParams;
  const { sms_ok: smsOk, sms_err: smsErr } = sp;
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
  const a2p = c.country === "US" && c.messaging_service_sid ? await a2pStatus(c.messaging_service_sid) : null;
  // Reviews and invoices at a glance (last 30 days for reviews, latest for documents).
  const since30 = isoDaysAgo(30);
  const [{ data: rJobs }, { data: rShared }, { data: rDocs }] = await Promise.all([
    db().from("jobs").select("rating, feedback, feedback_at, review_clicked_at, created_at, contacts(name)").eq("client_id", c.id).gte("created_at", since30).order("created_at", { ascending: false }).returns<{ rating: number | null; feedback: string | null; feedback_at: string | null; review_clicked_at: string | null; created_at: string; contacts: { name: string | null } | null }[]>(),
    db().from("review_ratings").select("rating, feedback, went_to_google, created_at").eq("client_id", c.id).gte("created_at", since30).order("created_at", { ascending: false }).returns<{ rating: number; feedback: string | null; went_to_google: boolean; created_at: string }[]>(),
    db().from("documents").select("id, kind, number, status, total_pence, currency, created_at").eq("client_id", c.id).order("created_at", { ascending: false }).limit(5).returns<{ id: string; kind: string; number: number; status: string; total_pence: number; currency: string; created_at: string }[]>(),
  ]);
  const ratings = [...(rJobs ?? []).map((j) => j.rating), ...(rShared ?? []).map((r) => r.rating)].filter((n): n is number => !!n);
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;
  const toGoogle = (rJobs ?? []).filter((j) => j.review_clicked_at).length + (rShared ?? []).filter((r) => r.went_to_google).length;
  const feedbackList = [
    ...(rJobs ?? []).filter((j) => j.feedback).map((j) => ({ at: j.feedback_at ?? j.created_at, who: j.contacts?.name ?? "Customer", rating: j.rating, text: j.feedback! })),
    ...(rShared ?? []).filter((r) => r.feedback).map((r) => ({ at: r.created_at, who: "Review page", rating: r.rating, text: r.feedback! })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
  const appBase = `${env.appUrl}/m/${c.dashboard_token}`;

  // How many phones have notifications on, so you can confirm on the setup call.
  const { count: pushPhones } = await db().from("push_subscriptions").select("id", { count: "exact", head: true }).eq("client_id", c.id);
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
  if (gConnected) {
    const [a, b] = await Promise.allSettled([site ? listSearchConsoleSites() : Promise.resolve([] as string[]), listBusinessLocations()]);
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

          <Card title="Branding (quotes, invoices, review page)">
            <form id="brand" action={saveBranding} className="space-y-2 text-sm">
              <input type="hidden" name="clientId" value={c.id} />
              {sp.brand_ok && <p className="rounded bg-green-50 p-2 text-green-800">Branding saved.</p>}
              {sp.brand_err && <p className="rounded bg-red-50 p-2 text-red-800">{sp.brand_err}</p>}
              <div className="flex items-center gap-3">
                {c.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.logo_url} alt="Logo" className="h-12 max-w-[160px] rounded border border-neutral-200 bg-white object-contain p-1" />
                ) : (
                  <span className="text-neutral-500">No logo yet</span>
                )}
                <input name="logo" type="file" accept="image/png,image/jpeg" className="text-xs" />
              </div>
              <label className="flex items-center gap-2">
                Brand colour <input name="brandColor" type="color" defaultValue={c.brand_color ?? "#2a78d6"} className="h-8 w-14" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input name="businessPhone" defaultValue={c.invoice_details?.businessPhone} placeholder="Business phone" className={input} />
                <input name="businessEmail" defaultValue={c.invoice_details?.businessEmail ?? c.email} placeholder="Business email" className={input} />
                <input name="website" defaultValue={c.invoice_details?.website ?? c.live_url ?? ""} placeholder="Website" className={input} />
                <input name="companyNumber" defaultValue={c.invoice_details?.companyNumber} placeholder="Company number" className={input} />
                <input name="vatNumber" defaultValue={c.invoice_details?.vatNumber} placeholder="VAT number" className={input} />
              </div>
              <textarea name="businessAddress" rows={2} defaultValue={c.invoice_details?.businessAddress} placeholder="Business address" className={`${input} w-full`} />
              <button className={btn}>Save branding</button>
            </form>
          </Card>

          {c.country === "US" && (() => {
            const a = (sub?.data ?? {}) as Record<string, string>;
            const legal = `${env.appUrl}/legal/${c.review_slug}`;
            const t = templatesFor(c);
            const fill = (x: string) => x.replace("{business}", clientLabel(c)).replace("{name}", "Sarah").replace("{link}", `${env.appUrl}/v/abc123def456`);
            const rows: [string, string][] = [
              ["Brand type", a.ein ? "Low-Volume Standard (they have an EIN)" : "Sole Proprietor (no EIN). Twilio texts a code to their own cell, they reply to confirm."],
              ["Legal business name", a.legalName || clientLabel(c)],
              ["EIN", a.ein || "None (Sole Proprietor)"],
              ["Business address", a.address || c.invoice_details?.businessAddress || "Missing: ask on the call"],
              ["Contact cell (for the code)", c.owner_mobile ?? "Missing"],
              ["Email", c.email],
              ["Website", c.live_url ?? c.invoice_details?.website ?? "Use their review page link below"],
              ["Campaign use case", "Customer Care"],
              ["Campaign description", `${clientLabel(c)} texts back customers whose calls were missed, replies to customer messages about quotes and jobs, and asks customers for a review after a completed job. No marketing.`],
              ["Sample message 1", fill(t.missed_call)],
              ["Sample message 2", fill(t.review)],
              ["How customers opt in", `Customers call or text the business number of ${clientLabel(c)}. If the call is missed, the customer receives one text reply. Customers who have a completed job receive a review request. Terms are published at ${legal}/terms.`],
              ["Privacy policy URL", `${legal}/privacy`],
              ["Terms URL", `${legal}/terms`],
              ["Opt-out / help keywords", "STOP, HELP (handled automatically by Twilio)"],
              ["Messaging Service to link", c.messaging_service_sid ?? "Click Set up phone first"],
            ];
            return (
              <Card title={`US texting registration (A2P 10DLC): ${a2p ?? (c.messaging_service_sid ? "not started" : "set up phone first")}`}>
                <p className="mb-2 text-xs text-neutral-600">
                  In Twilio go to <a className="underline" href="https://console.twilio.com/" target="_blank" rel="noreferrer">Messaging, Regulatory Compliance, A2P 10DLC</a>. Register the brand, then the campaign, then link the campaign to the Messaging Service. Copy each value below.
                </p>
                <dl className="divide-y divide-neutral-100 text-xs">
                  {rows.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-3 gap-2 py-1.5">
                      <dt className="font-medium text-neutral-600">{k}</dt>
                      <dd className="col-span-2 select-all break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            );
          })()}

          <Card title="Reviews and invoices">
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium">Review funnel</p>
                <p className="text-neutral-600">
                  Review page:{" "}
                  <a className="break-all underline" href={`${env.appUrl}/review/${c.review_slug}`} target="_blank" rel="noreferrer">{`${env.appUrl}/review/${c.review_slug}`}</a>
                </p>
                <p className="text-xs text-neutral-500">Every review text links to their funnel automatically. 4 to 5 stars go to Google, 1 to 3 stars come to them privately.</p>
                {!c.google_review_url && <p className="mt-1 rounded bg-amber-50 p-2 text-amber-900">No Google review link yet: happy customers can&apos;t be sent to Google until you add it below.</p>}
                <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                  <div className="rounded bg-neutral-50 p-2"><p className="text-lg font-semibold">{(rJobs ?? []).length}</p><p className="text-xs text-neutral-500">requests (30d)</p></div>
                  <div className="rounded bg-neutral-50 p-2"><p className="text-lg font-semibold">{ratings.length}</p><p className="text-xs text-neutral-500">ratings</p></div>
                  <div className="rounded bg-neutral-50 p-2"><p className="text-lg font-semibold">{avgRating ? `${avgRating}★` : "-"}</p><p className="text-xs text-neutral-500">average</p></div>
                  <div className="rounded bg-neutral-50 p-2"><p className="text-lg font-semibold">{toGoogle}</p><p className="text-xs text-neutral-500">sent to Google</p></div>
                </div>
                {feedbackList.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {feedbackList.map((f, i) => (
                      <li key={i} className="rounded bg-amber-50 p-2 text-xs text-amber-950">
                        <strong>{f.who}{f.rating ? ` (${f.rating}★)` : ""}:</strong> {f.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="font-medium">Google reviews in their app</p>
                {c.google_rating ? (
                  <p className="text-neutral-600">
                    {Number(c.google_rating).toFixed(1)}★ from {c.google_review_count} reviews{c.reviews_synced_at ? ` · checked ${fmt(c.reviews_synced_at)}` : ""}
                  </p>
                ) : (
                  <p className="text-neutral-600">Pick their Business Profile so new reviews show in their app, ping their phone, and can be replied to there.</p>
                )}
                {!gConnected ? (
                  <p className="mt-1 text-xs text-neutral-500">Connect Google on the dashboard first.</p>
                ) : gbpLocations ? (
                  <form action={saveReviewLocation} className="mt-2 flex gap-2">
                    <input type="hidden" name="clientId" value={c.id} />
                    <select name="location" defaultValue={c.gbp_location ? `${c.gbp_location}|${c.gbp_title ?? ""}` : site?.gbp_location ? `${site.gbp_location}|${site.gbp_title ?? ""}` : ""} className={input}>
                      <option value="">Not linked</option>
                      {gbpLocations.map((l) => (
                        <option key={l.name} value={`${l.name}|${l.title}`}>{l.title}{l.address ? `, ${l.address}` : ""}</option>
                      ))}
                    </select>
                    <button className={btnQuiet}>Save</button>
                  </form>
                ) : (
                  <p className="mt-1 text-xs text-red-700">{gError || "Couldn't list Business Profiles."}</p>
                )}
                {gbpLocations && gbpLocations.length === 0 && <p className="mt-1 text-xs text-neutral-500">No profiles visible. Ask them to add {env.googleManagerEmail} as a Manager.</p>}
              </div>
              <div>
                <p className="font-medium">Quotes and invoices</p>
                {(rDocs ?? []).length === 0 ? (
                  <p className="text-neutral-500">None yet.</p>
                ) : (
                  <ul className="divide-y divide-neutral-100">
                    {(rDocs ?? []).map((d) => (
                      <li key={d.id} className="flex items-center justify-between py-1.5">
                        <span className="capitalize">{d.kind} #{d.number} <span className="text-neutral-500">· {d.status}</span></span>
                        <span className="flex items-center gap-3">
                          <span>{new Intl.NumberFormat(d.currency === "USD" ? "en-US" : "en-GB", { style: "currency", currency: d.currency }).format(d.total_pence / 100)}</span>
                          <a className="text-blue-700 underline" href={`${appBase}/docs/${d.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <a className={btnQuiet} href={`${appBase}/docs/new?kind=quote`} target="_blank" rel="noreferrer">New quote</a>
                  <a className={btnQuiet} href={`${appBase}/docs/new?kind=invoice`} target="_blank" rel="noreferrer">New invoice</a>
                  <a className={btnQuiet} href={`${appBase}/docs`} target="_blank" rel="noreferrer">All in their app</a>
                </div>
              </div>
            </div>
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

          <div id="sms" />
          <Card title="Missed calls & reviews">
            {smsOk && <p className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{smsOk}</p>}
            {smsErr && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{smsErr}</p>}
            <div className="mb-3 space-y-1 text-sm">
              <p>
                Status: <strong className={c.sms_enabled ? "text-green-700" : "text-neutral-500"}>{c.sms_enabled ? "Texts on" : "Texts off"}</strong>
                {c.last_forwarded_call_at && <span className="text-neutral-500"> · last forwarded call {fmt(c.last_forwarded_call_at)}</span>}
              </p>
              <p className={pushPhones ? "text-green-700" : "text-amber-700"}>
                Notifications: {pushPhones ? `on for ${pushPhones} phone${pushPhones === 1 ? "" : "s"}` : "not turned on yet (they tap Turn on in the app, then Allow)"}
              </p>
              <p className="break-all text-xs text-neutral-600">
                Client app: <a className="underline" href={`${env.appUrl}/m/${c.dashboard_token}`}>{`${env.appUrl}/m/${c.dashboard_token}`}</a>
              </p>
              {c.twilio_number &&
                forwardingCodes(c.country === "US" ? "US" : "GB", c.twilio_number, c.mobile_carrier).map((g) => (
                  <div key={g.carrier} className="text-xs text-neutral-600">
                    <p className="font-medium">Forwarding codes ({g.carrier}):</p>
                    {g.steps.map((st) => (
                      <p key={st.code}>
                        <code>{st.code}</code> {st.label.toLowerCase()}
                      </p>
                    ))}
                    <p>
                      Off: <code>{g.off}</code>
                    </p>
                  </div>
                ))}
              {a2p && (
                <p className={`rounded p-2 text-xs ${a2p === "verified" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
                  US texting registration (A2P 10DLC): <strong>{a2p}</strong>.
                  {a2p !== "verified" && " Texts won't send until it's verified. In Twilio: Messaging, then Regulatory Compliance, then A2P 10DLC: register their brand, then a campaign linked to Messaging Service "}
                  {a2p !== "verified" && <code>{c.messaging_service_sid}</code>}
                </p>
              )}
            </div>
            {!c.twilio_number ? (
              <form action={setUpPhone} className="mb-3 rounded-lg bg-blue-50 p-3 text-sm">
                <input type="hidden" name="clientId" value={c.id} />
                <p className="mb-2">
                  One click: buys a {c.country === "US" ? "US local number near them (about $1.15/month) with its own Messaging Service" : "UK mobile number (about £1.89/month)"}, points it at the app, switches texts on, and {c.country === "US" ? "emails" : "texts and emails"} {c.owner_mobile ? displayUk(c.owner_mobile) : "the owner"} their app link and forwarding codes{c.country === "US" ? " (email only until their US texting registration is approved)" : ""}.
                </p>
                <label className="mb-2 flex items-center gap-2">
                  <input type="checkbox" name="quiet" /> Don&apos;t notify the client yet (buy and connect the number only)
                </label>
                <button className={`${btn} w-full`} disabled={!c.owner_mobile}>{c.owner_mobile ? "Set up phone" : "Needs the owner's mobile first"}</button>
              </form>
            ) : (
              <form action={resendPhoneWelcome} className="mb-3">
                <input type="hidden" name="clientId" value={c.id} />
                <button className={`${btnQuiet} w-full`}>Send app link and forwarding codes to the client</button>
              </form>
            )}
            <form action={saveSmsSettings} className="space-y-2 text-sm">
              <input type="hidden" name="clientId" value={c.id} />
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  Country
                  <select name="country" defaultValue={c.country} className={`${input} mt-1 w-full`}>
                    <option value="GB">UK</option>
                    <option value="US">US</option>
                  </select>
                </label>
                <label className="block">
                  Time zone
                  <select name="timezone" defaultValue={c.timezone} className={`${input} mt-1 w-full`}>
                    <option value="Europe/London">UK</option>
                    <option value="America/New_York">US Eastern</option>
                    <option value="America/Chicago">US Central (Dallas)</option>
                    <option value="America/Denver">US Mountain</option>
                    <option value="America/Phoenix">US Arizona</option>
                    <option value="America/Los_Angeles">US Pacific</option>
                  </select>
                </label>
              </div>
              {c.country === "US" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    Their carrier
                    <select name="mobile_carrier" defaultValue={c.mobile_carrier ?? ""} className={`${input} mt-1 w-full`}>
                      <option value="">Not sure</option>
                      <option>Verizon</option>
                      <option>AT&T</option>
                      <option>T-Mobile</option>
                      <option>Other</option>
                    </select>
                  </label>
                  <label className="block">
                    Messaging Service SID
                    <input name="messaging_service_sid" defaultValue={c.messaging_service_sid ?? ""} placeholder="MG..." className={`${input} mt-1 w-full`} />
                  </label>
                </div>
              )}
              {c.country !== "US" && <input type="hidden" name="messaging_service_sid" value="" />}
              <label className="block">Twilio number<input name="twilio_number" defaultValue={c.twilio_number ?? ""} placeholder={c.country === "US" ? "+1..." : "+447..."} className={`${input} mt-1 w-full`} /></label>
              <label className="block">Owner&apos;s mobile (gets replies, sends DONE)<input name="owner_mobile" defaultValue={c.owner_mobile ?? ""} placeholder={c.country === "US" ? "(214) 555-0123" : "07..."} className={`${input} mt-1 w-full`} /></label>
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
                  ["missed_call_template", "Missed call, open", templatesFor(c).missed_call],
                  ["missed_call_after_hours_template", "Missed call, closed", templatesFor(c).missed_call_after_hours],
                  ["review_template", "Review request", templatesFor(c).review],
                  ["review_followup_template", "Review reminder", templatesFor(c).review_followup],
                ] as const).map(([name, label, placeholder]) => (
                  <label key={name} className="mt-2 block text-xs">
                    {label}
                    <textarea name={name} rows={3} defaultValue={c[name] ?? ""} placeholder={placeholder} className={`${input} mt-1 w-full`} />
                  </label>
                ))}
                <p className="mt-2 text-xs text-neutral-500">
                  Emergency call-out version of &ldquo;Missed call, closed&rdquo; (paste it in to use it): <span className="select-all">{EMERGENCY_AFTER_HOURS[countryOf(c)]}</span>
                </p>
              </details>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="forward_replies" defaultChecked={c.forward_replies} /> Also text new customer messages to the owner&apos;s phone
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="sms_enabled" defaultChecked={c.sms_enabled} disabled={!c.twilio_number} /> Texts switched on{!c.twilio_number && " (switches on when you set up their phone)"}
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
