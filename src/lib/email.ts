import "server-only";
import { Resend } from "resend";
import { env } from "./env";

let resend: Resend | null = null;
function client() {
  if (!resend) resend = new Resend(env.resendApiKey);
  return resend;
}

type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string; fromName?: string };

/** "P.I.C Driveways <hello@ascdev.tech>": same sending address, the client's name on it. */
const fromAs = (name?: string) => {
  if (!name) return env.emailFrom;
  const addr = env.emailFrom.match(/<([^>]+)>/)?.[1] ?? env.emailFrom;
  return `${name.replace(/[<>"]/g, "")} <${addr}>`;
};

export async function sendEmail({ to, subject, text, html, replyTo, fromName }: Mail) {
  const { error } = await client().emails.send({
    from: fromAs(fromName),
    to,
    subject,
    text,
    html: html ?? textToHtml(text),
    replyTo: replyTo ?? env.adminEmail,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
}

export async function notifyAdmin(subject: string, lines: string[]) {
  await sendEmail({ to: env.adminEmail, subject: `[ASC] ${subject}`, text: lines.join("\n") });
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain-text email to simple HTML: paragraphs, **bold**, links, "- " bullets and "1. " lists. */
export function textToHtml(text: string) {
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563eb">$1</a>');
  const blocks = text.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^- /.test(l))) {
      return `<ul style="padding-left:20px;margin:0 0 16px">${lines.map((l) => `<li style="margin:4px 0">${inline(l.slice(2))}</li>`).join("")}</ul>`;
    }
    if (lines.every((l) => /^\d+\. /.test(l))) {
      return `<ol style="padding-left:20px;margin:0 0 16px">${lines.map((l) => `<li style="margin:6px 0">${inline(l.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`;
    }
    return `<p style="margin:0 0 16px">${lines.map(inline).join("<br>")}</p>`;
  });
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;max-width:560px">${blocks.join("")}</div>`;
}

// ---------- Client-facing templates (copy from the Onboarding SOP doc) ----------

export const signoff = () => `Any questions, call or text me on ${env.contactPhone}.\n\nAyush\nASC Development`;

export function welcomeEmail(p: { firstName: string; formLink: string }) {
  return {
    subject: "Information needed for your onboarding - ASC Development",
    text: `Hi ${p.firstName},

Thanks for signing up with ASC Development. We'll have your new website, Google Business Profile and local SEO live within 48 hours of getting your details.

Here's what happens next:

1. **Fill in your onboarding form (about 10 minutes):** ${p.formLink} It covers your services, the areas you work in, your logo and job photos, and access to your Google profile.
2. **Book your 20-minute onboarding call** if you haven't already: ${env.bookingUrl} We'll confirm your services and areas and agree what counts as a lead.
3. **We build.** Your 48 hours start the moment your form comes in.
4. **You go live.** We'll send your link, a summary of everything set up, and how to ask for changes.

Handy to have ready:

- Your logo, in any format, and a minimum of 5 to 10 photos of recent jobs
- The login for wherever your domain is registered, if you have one
- Your Google Business Profile, so you can add us as a manager

You agreed to our terms of service when you signed up. You can read them any time here: ${env.appUrl}/terms

${signoff()}`,
  };
}

export function chase24Email(p: { firstName: string; formLink: string }) {
  return {
    subject: "Quick nudge on your onboarding form",
    text: `Hi ${p.firstName},

Just a nudge on your onboarding form so we can start your build: ${p.formLink}

It takes about 10 minutes.

${signoff()}`,
  };
}

export function chase48Email(p: { firstName: string; formLink: string }) {
  return {
    subject: "Your build is waiting on one thing",
    text: `Hi ${p.firstName},

Everything's ready on our side. As soon as your onboarding form is in, your 48-hour build starts: ${p.formLink}

Stuck on anything, like Google access? Reply here or call ${env.contactPhone} and I'll walk you through it.

Ayush
ASC Development`,
  };
}

export function formReceivedEmail(p: { firstName: string; dueAt: Date }) {
  const due = p.dueAt.toLocaleString("en-GB", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  return {
    subject: "Got it. Your 48-hour build has started",
    text: `Hi ${p.firstName},

Thanks, your onboarding form is in and your build has started. You'll be live by ${due} at the latest.

If you haven't booked your onboarding call yet, grab a slot here: ${env.bookingUrl}

${signoff()}`,
  };
}

export function launchEmail(p: { firstName: string; liveUrl: string }) {
  return {
    subject: "You're live",
    text: `Hi ${p.firstName},

Your new site is live: ${p.liveUrl}

Here's what's now set up for you:

- Your website, built to turn visitors into calls and enquiries
- Your Google Business Profile, updated and optimised
- Local SEO pages for your main services and areas
- Automatic review requests after each job

Need a change? Just reply to this email and we'll get it done within 2 working days.

${signoff()}`,
  };
}

/** Sent when a client's business texting number is set up: app link, install steps and forwarding codes. */
export function phoneWelcomeEmail(p: {
  firstName: string;
  appUrl: string;
  twilioNumber: string;
  forwardingOn: string | null;
  codes: { carrier: string; steps: { label: string; code: string }[]; off: string }[];
  us: boolean;
}) {
  const n = p.twilioNumber;
  const codeBlocks = p.codes
    .map((c) => `${p.codes.length > 1 ? `If you're on ${c.carrier}:\n` : ""}${c.steps.map((s) => `${s.code}   (${s.label.toLowerCase()})`).join("\n")}\nTo switch it off later: ${c.off}`)
    .join("\n\n");
  const example = p.us ? "2145550123" : "07700900123";
  return {
    subject: "Your missed-call texts and inbox app are ready",
    text: `Hi ${p.firstName},

Your missed-call texts and review requests are set up. Two quick steps and you're live.

1. SWITCH ON MISSED-CALL TEXTS
${p.forwardingOn ? `On the phone customers call you on (${p.forwardingOn}), open the keypad, type` : "On your phone, open the keypad, type"} each code below and press call:

${codeBlocks}

You'll see or hear a confirmation. Your phone still rings as normal. Only calls you miss come to us, and we text the caller straight back. This replaces voicemail for missed calls.
${p.us ? "\nNote: your texts go live once your business is approved by the US carriers (we handle this, it usually takes a few days). Calls are logged in your app straight away.\n" : ""}
2. PUT YOUR INBOX APP ON YOUR HOME SCREEN
Your app: ${p.appUrl}

iPhone: open the link in Safari, tap the Share button, then "Add to Home Screen". Open it from the new icon and tap "Turn on" for notifications.
Android: open the link in Chrome, tap the three dots, then "Add to Home screen" or "Install app", then tap "Turn on" for notifications.

Keep this link to yourself. It opens your inbox without a password.

WHAT YOU'LL USE IT FOR
- Inbox: missed calls and customer texts. Tap one to reply or call back.
- Reviews: after each job tap "Job done", or text DONE ${example} Sarah to ${n}. We'll ask them for a Google review.
- Results: your numbers for the month.

${signoff()}`,
  };
}
