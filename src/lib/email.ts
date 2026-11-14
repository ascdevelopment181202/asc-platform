import "server-only";
import { Resend } from "resend";
import { env } from "./env";

let resend: Resend | null = null;
function client() {
  if (!resend) resend = new Resend(env.resendApiKey);
  return resend;
}

type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string };

export async function sendEmail({ to, subject, text, html, replyTo }: Mail) {
  const { error } = await client().emails.send({
    from: env.emailFrom,
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

const signoff = () => `Any questions, call or text me on ${env.contactPhone}.\n\nAyush\nASC Development`;

export function welcomeEmail(p: { firstName: string; formLink: string }) {
  return {
    subject: "You're in. Here's what happens next",
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
