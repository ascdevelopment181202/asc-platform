import Link from "next/link";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { a2pStatus } from "@/lib/twilio";
import { StatusPill } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guide | ASC Admin", robots: { index: false } };

const ONBOARDING_LINK = "https://buy.stripe.com/8x24gz0GKaoPgVg0zs9Ve0n";
const SOP_DOC = "https://docs.google.com/document/d/1Ku6mBbXYeJwhFhkGTwAmWNnWMAQMs9Nh2uDdPqkCnQs/edit";

type Check = { ok: boolean | null; label: string };
type Row = { c: Client; checks: Check[]; next: string; done: boolean; a2p: string | null };

/** Works out where each client is in setup, and the one thing to do next. */
function assess(c: Client, phones: number, calls: number, a2p: string | null): Row {
  const us = c.country === "US";
  const checks: Check[] = [
    { ok: !!c.form_submitted_at, label: "Form" },
    { ok: !!c.owner_mobile, label: "Mobile" },
    { ok: !!c.twilio_number, label: "Number" },
    { ok: us ? a2p === "verified" : null, label: "US reg" },
    { ok: !!c.google_review_url, label: "Review link" },
    { ok: !!c.logo_url, label: "Logo" },
    { ok: phones > 0, label: "Alerts" },
    { ok: calls > 0, label: "Forwarding" },
  ];
  let next = "Live: nothing to do";
  if (c.status === "cancelled") next = "Cancelled: release their number in Twilio if you haven't";
  else if (c.status === "past_due") next = "Payment failed: chase them";
  else if (!c.form_submitted_at) next = "Waiting for their onboarding form (reminders are automatic)";
  else if (!c.owner_mobile) next = "Add their mobile on their page";
  else if (!c.twilio_number) next = us ? "Click Set up phone, then do the US registration" : "Click Set up phone";
  else if (us && a2p !== "verified") next = a2p && a2p !== "not registered" ? `US registration ${a2p}: wait for approval` : "Do the US registration (card on their page)";
  else if (!c.google_review_url) next = "Add their Google review link";
  else if (!c.logo_url) next = "Add their logo (Branding card)";
  else if (!phones) next = "Setup call: they still need to turn on notifications";
  else if (!calls) next = "Setup call: forwarding not confirmed (no missed call received yet)";
  return { c, checks, next, done: next.startsWith("Live"), a2p };
}

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-6 rounded-xl border border-neutral-200 bg-white p-5">
    <h2 className="mb-3 text-lg font-semibold">{title}</h2>
    <div className="space-y-3 text-sm leading-relaxed text-neutral-800 [&_li]:ml-5 [&_ol>li]:list-decimal [&_ul>li]:list-disc">{children}</div>
  </section>
);

const Tag = ({ you }: { you?: boolean }) => (
  <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${you ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-800"}`}>{you ? "YOU" : "AUTO"}</span>
);

export default async function Guide() {
  const supabase = db();
  const [{ data: clients }, { data: subs }, { data: calls }] = await Promise.all([
    supabase.from("clients").select("*").order("paid_at", { ascending: false }).returns<Client[]>(),
    supabase.from("push_subscriptions").select("client_id").returns<{ client_id: string }[]>(),
    supabase.from("calls").select("client_id").limit(10000).returns<{ client_id: string }[]>(),
  ]);
  const count = (rows: { client_id: string }[] | null) => (rows ?? []).reduce<Record<string, number>>((m, r) => ((m[r.client_id] = (m[r.client_id] ?? 0) + 1), m), {});
  const phones = count(subs);
  const callCount = count(calls);
  const a2p = Object.fromEntries(
    await Promise.all(
      (clients ?? [])
        .filter((c) => c.country === "US" && c.messaging_service_sid)
        .map(async (c) => [c.id, await a2pStatus(c.messaging_service_sid!).catch(() => "unknown")] as const),
    ),
  );
  const rows = (clients ?? []).filter((c) => c.status !== "cancelled").map((c) => assess(c, phones[c.id] ?? 0, callCount[c.id] ?? 0, a2p[c.id] ?? null));
  const todo = rows.filter((r) => !r.done);

  const nav = [
    ["status", "Live status"],
    ["flow", "How it fits together"],
    ["uk", "UK client: call playbook"],
    ["us", "US client: call playbook"],
    ["admin", "Your admin pages"],
    ["app", "The client's app"],
    ["auto", "What runs automatically"],
    ["links", "Key links"],
    ["fix", "When something's wrong"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Guide</h1>
          <p className="text-sm text-neutral-500">Where every client is, what to do next, and how the platform works.</p>
        </div>
        <a href={SOP_DOC} target="_blank" rel="noreferrer" className="rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
          Open the SOP doc
        </a>
      </div>

      <nav className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-2 bg-neutral-50/95 px-1 py-2 backdrop-blur">
        {nav.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-100">
            {label}
          </a>
        ))}
      </nav>

      <Section id="status" title={`Live status: ${todo.length ? `${todo.length} client${todo.length === 1 ? "" : "s"} need${todo.length === 1 ? "s" : ""} something` : "everyone is live"}`}>
        <p className="text-neutral-600">Green is done, red is missing, grey doesn&apos;t apply. &ldquo;Forwarding&rdquo; turns green once their first missed call reaches the platform.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Client</th>
                {rows[0]?.checks.map((ch) => (
                  <th key={ch.label} className="px-1 py-2 text-center font-medium">{ch.label}</th>
                ))}
                <th className="py-2 pl-3 font-medium">Next step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.c.id} className={r.done ? "" : "bg-amber-50/40"}>
                  <td className="py-2 pr-3">
                    <Link href={`/admin/clients/${r.c.id}`} className="font-medium underline">{clientLabel(r.c)}</Link>
                    <span className="ml-1 text-neutral-500">{r.c.country === "US" ? "US" : "UK"}</span>
                    <div className="mt-0.5"><StatusPill status={r.c.status} /></div>
                  </td>
                  {r.checks.map((ch) => (
                    <td key={ch.label} className="px-1 py-2 text-center">
                      <span className={`inline-block h-3 w-3 rounded-full ${ch.ok === null ? "bg-neutral-200" : ch.ok ? "bg-green-500" : "bg-red-400"}`} title={ch.label} />
                    </td>
                  ))}
                  <td className={`py-2 pl-3 ${r.done ? "text-green-700" : "font-medium text-amber-900"}`}>{r.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="flow" title="How it fits together">
        <ol>
          <li><strong>They pay</strong> through the onboarding link <Tag />. This creates them on your dashboard and emails the onboarding form. Paid another way? <em>Add client manually</em> (sends the form) or <em>Add an existing client quietly</em> (sends nothing).</li>
          <li><strong>They fill in the form</strong> <Tag />. Saves their mobile, hours, review link, logo and (US) registration details. Reminders at 24h and 48h, and you&apos;re emailed at 72h.</li>
          <li><strong>Their number is bought</strong>. UK: automatic as soon as the form is in <Tag />, you get a &ldquo;Phone live&rdquo; email. US: you click <em>Set up phone</em> <Tag you />, then do the US registration <Tag you />.</li>
          <li><strong>You check their page</strong> <Tag you />: review link, logo and colour, hours, emergency call-outs.</li>
          <li><strong>The setup call</strong> <Tag you />: forwarding code, app on the home screen, notifications on, live test.</li>
          <li><strong>Live</strong> <Tag />: missed calls get texted back, replies land in their app, &ldquo;Job done&rdquo; sends review requests through their review funnel, quotes and invoices go out branded.</li>
        </ol>
      </Section>

      <Section id="uk" title="UK client: call playbook">
        <p className="font-medium">Before the call</p>
        <ul>
          <li>Live status above shows them at <em>Setup call</em> (number bought, review link and logo in).</li>
          <li>On their page: hours are right, emergency version of the after-hours text pasted in if they do call-outs.</li>
          <li>Open their client app link on your own phone so you can describe what they&apos;ll see.</li>
          <li>Have their ASC number and forwarding code ready (both on their page, under Missed calls &amp; reviews).</li>
        </ul>
        <p className="font-medium">Questions to ask</p>
        <ul>
          <li>Which number do customers ring you on: your mobile or a landline? (Forwarding goes on that phone.)</li>
          <li>iPhone or Android? (Changes the home screen steps.)</li>
          <li>What hours do you work? Do you do emergency call-outs?</li>
          <li>Roughly how many past customers could we ask for a review? (Upload them in the app&apos;s Reviews screen.)</li>
          <li>Do you want card payment or bank details on your invoices? (They add these under More, Business details.)</li>
        </ul>
        <p className="font-medium">On the call</p>
        <ol>
          <li>If you added them quietly, click <em>Send app link and forwarding codes</em> now.</li>
          <li>Forwarding: keypad, dial <code>**61*</code>ASC number<code>*11*20#</code>, press call, wait for &ldquo;activated&rdquo;. Only this first code matters.</li>
          <li>App: open the link (Safari on iPhone), Share, Add to Home Screen, open it from the icon.</li>
          <li>Notifications: tap Turn on, then Allow. Their page should now say &ldquo;Notifications: on&rdquo;.</li>
          <li>Live test: ring their mobile from yours, don&apos;t let them answer. You get the text, they get the notification.</li>
          <li>Show them Job done (review request) and their review page link, and the Quotes tab.</li>
        </ol>
        <p className="font-medium">After the call</p>
        <ul>
          <li>Live status should show them as Live (Forwarding goes green after the test call).</li>
          <li>Upload 5 to 10 past customers in their Reviews screen to get the first reviews in.</li>
          <li>If you get a &ldquo;Check call forwarding&rdquo; email later, their forwarding has gone off: ask them to dial the code again.</li>
        </ul>
      </Section>

      <Section id="us" title="US client: call playbook">
        <p>Same as the UK playbook, plus the texting registration. Do the registration as early as possible: approval usually takes a few days, and texts to their customers can be blocked until it&apos;s verified (missed calls still show in their app).</p>
        <p className="font-medium">Before the call</p>
        <ul>
          <li>Click <em>Set up phone</em> on their page (buys a local number and their Messaging Service; the welcome goes by email only).</li>
          <li>Open the <em>US texting registration</em> card on their page: every value for the Twilio forms is there, including their privacy and terms links.</li>
          <li>If they have an EIN, submit the brand (Low-Volume Standard) and campaign before the call.</li>
        </ul>
        <p className="font-medium">Questions to ask</p>
        <ul>
          <li>Do you have an EIN? What&apos;s your legal business name and address?</li>
          <li>Which carrier are you on: Verizon, AT&amp;T or T-Mobile? (Different forwarding code.)</li>
          <li>Plus the UK questions: which number customers ring, iPhone or Android, hours, emergency call-outs.</li>
        </ul>
        <p className="font-medium">On the call</p>
        <ol>
          <li>No EIN: register the Sole Proprietor brand while you&apos;re on the call. Twilio texts a code to their cell and they reply straight away.</li>
          <li>Forwarding: Verizon <code>*71</code> + 10-digit ASC number (off: <code>*73</code>). AT&amp;T or T-Mobile <code>**61*1</code> + ASC number + <code>#</code> (off: <code>##004#</code>).</li>
          <li>App, notifications and live test as for the UK.</li>
        </ol>
        <p className="font-medium">After the call</p>
        <ul>
          <li>Submit the campaign if you haven&apos;t, linked to their Messaging Service.</li>
          <li>Watch Live status: &ldquo;US reg&rdquo; turns green once Twilio verifies it. Then test again: the auto-text should now arrive.</li>
        </ul>
      </Section>

      <Section id="admin" title="Your admin pages">
        <p><strong>Dashboard</strong> (ASC Platform, top left): every client with status, payment date, form, build deadline and live site; your task list; add clients manually or quietly.</p>
        <p><strong>A client&apos;s page</strong>, card by card:</p>
        <ul>
          <li><strong>Onboarding</strong>: their form answers, uploads and the emails they&apos;ve been sent. Resend welcome email if they lost the form.</li>
          <li><strong>Branding</strong>: logo, colour and business details used on their quotes, invoices, review page and legal pages.</li>
          <li><strong>US texting registration</strong> (US only): copy-ready values for the Twilio forms and the approval status.</li>
          <li><strong>Reviews and invoices</strong>: their review page link, 30-day review stats, private feedback from unhappy customers, latest quotes and invoices with PDFs, and shortcuts to create new ones in their app.</li>
          <li><strong>Missed calls &amp; reviews</strong>: status (texts on, notifications on), their app link, forwarding codes, Set up phone, send the app link, settings (number, mobile, review link, hours, text templates) and the text log.</li>
          <li><strong>Website</strong>: generate and publish their site, domain, SEO pages, Google connections and monthly reports.</li>
        </ul>
      </Section>

      <Section id="app" title="The client's app">
        <ul>
          <li><strong>Inbox</strong>: every conversation, missed calls and replies, with templates and private notes.</li>
          <li><strong>Contacts</strong>: customers, with their history.</li>
          <li><strong>Calendar</strong>: bookings, plus their public booking link.</li>
          <li><strong>Jobs</strong>: a simple pipeline from enquiry to done.</li>
          <li><strong>More</strong>: Reviews (Job done button, their review page link to share, past-customer upload), Quotes &amp; invoices, Results, Business details and branding, templates, booking settings, notifications.</li>
        </ul>
        <p><strong>Review funnel</strong>: the link in every review text, and their shareable review page, ask for a star rating. 4 or 5 stars go to Google. 1 to 3 stars send private feedback to their inbox with a notification. A Google link is always visible (UK rules on review gating).</p>
        <p><strong>Quotes and invoices</strong>: created in the app, sent by text, accepted online, turned into invoices, marked paid. Every one is branded with a PDF.</p>
      </Section>

      <Section id="auto" title="What runs automatically">
        <ul>
          <li>Missed call: text back within seconds (open-hours or closed version), notification to the client, conversation in their inbox.</li>
          <li>Review requests: first text within 5 minutes of Job done or a booking ending, reminders 10 and 20 days later, and one gentle ask after 3 months. Only 9am to 7pm. Stops when they open the link, rate, leave a Google review, reply STOP, or the owner stops it. Each client&apos;s timings are editable under Review autopilot; the owner sees them in the app under Reviews, How review requests work.</li>
          <li>Triggers: a booking ending, Mark as paid, moving a customer to Job done (each switchable), plus Job done / Ask buttons, texting DONE, Today&apos;s customers and the job-software link.</li>
          <li>6pm on work days: one notification listing today&apos;s customers, one tap each to ask. Fridays even if it was quiet.</li>
          <li>Email instead of text when the customer has an email and we can&apos;t text (US before registration, or a failed text).</li>
          <li>1 to 3 stars: a &ldquo;call them to put it right&rdquo; task due within the hour, then an &ldquo;ask again&rdquo; button once it&apos;s sorted.</li>
          <li>5 stars: a thank-you text a few hours later asking for referrals.</li>
          <li>Google reviews: checked every 30 minutes, new ones pinged to the owner, 4 to 5 stars replied to automatically after a day, 5 star reviews shown on their website.</li>
          <li>Campaigns: owners text an offer to past customers from the app (Campaigns). About 100 texts an hour, 9am to 7pm, STOP added automatically, nobody gets two campaigns within 30 days. US clients need their registration approved first.</li>
          <li>Monday 9am: last week&apos;s reviews and how close they are to their competitor.</li>
          <li>Booking reminders: the day before each appointment (text). Confirmations, moves, cancellations, quotes and invoices go by email when the customer has an email address, otherwise by text.</li>
          <li>Missed calls: one auto-text per caller per day, none if the customer has texted the business in the last day. Numbers that keep failing are marked and not texted again.</li>
          <li>Owner alerts: a notification on their phone; if notifications are off, an email (texting the owner is opt-in per client).</li>
          <li>Costs: admin, Costs shows every client&apos;s real texts and cost this month, with a projection. Set a monthly budget on a client&apos;s page and you&apos;re emailed at 80% and 100%. Campaign texts are capped per client per month (300 by default).</li>
          <li>Onboarding chasers: 24h and 48h emails to the client, an email to you at 72h.</li>
          <li>Build deadline alerts: 12 hours before and when overdue.</li>
          <li>Forwarding check: an email to you if a client has had no forwarded calls for 7 days.</li>
          <li>Monthly website report to live clients.</li>
          <li>Twilio usage alert: an email to chavanayush802@gmail.com if spend passes £20 in a month.</li>
        </ul>
      </Section>

      <Section id="links" title="Key links">
        <ul>
          <li>Onboarding payment link (the only one that starts onboarding): <a className="underline" href={ONBOARDING_LINK} target="_blank" rel="noreferrer">{ONBOARDING_LINK.replace("https://", "")}</a></li>
          <li>SOP doc (UK onboarding): <a className="underline" href={SOP_DOC} target="_blank" rel="noreferrer">Google Doc</a></li>
          <li>Twilio: <a className="underline" href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noreferrer">phone numbers</a>, <a className="underline" href="https://console.twilio.com/us1/billing/usage/triggers" target="_blank" rel="noreferrer">usage alert</a></li>
          <li>Stripe: <a className="underline" href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">dashboard</a></li>
          <li>Code and deploys: <a className="underline" href="https://github.com/ascdevelopment181202/asc-platform" target="_blank" rel="noreferrer">GitHub</a>, <a className="underline" href="https://vercel.com" target="_blank" rel="noreferrer">Vercel</a></li>
        </ul>
      </Section>

      <Section id="fix" title="When something's wrong">
        <ul>
          <li><strong>Test call, no text</strong>: forwarding isn&apos;t on. They dial the code again. Test from your phone, not theirs.</li>
          <li><strong>Set up phone shows a red message</strong>: it says what to fix. &ldquo;Authentication&rdquo; means the Twilio token in Vercel is wrong.</li>
          <li><strong>No notifications</strong>: on iPhone they must open the app from the home screen icon, then tap Turn on and Allow.</li>
          <li><strong>Review texts not going out</strong>: check their Google review link, and that it&apos;s between 9am and 7pm.</li>
          <li><strong>US texts not arriving</strong>: the registration isn&apos;t verified yet. Check the card on their page.</li>
          <li><strong>Client cancels</strong>: they dial <code>##002#</code> (UK) or <code>*73</code> / <code>##004#</code> (US), then release their number in Twilio.</li>
        </ul>
      </Section>
    </div>
  );
}
