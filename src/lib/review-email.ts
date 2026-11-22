import "server-only";
import { sendEmail } from "@/lib/email";
import { brandOf } from "@/lib/brand";
import { bumpConversation, reviewLink, reviewText, type Contact, type Job } from "@/lib/sms";
import type { Client } from "@/lib/supabase";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The review request as a short branded email, for customers we can't text (or when the text fails). */
export async function emailReviewRequest(c: Client, contact: Contact, job: Job, step: number) {
  if (!contact.email) throw new Error("No email for this customer");
  const b = brandOf(c);
  const link = reviewLink(job);
  const body = reviewText(c, contact, job, step)
    .replace(/\s*Reply STOP to opt out\.?/i, "")
    .replace(link, "")
    .replace(/[:\s]+$/, ".");
  const text = `${body}\n\nLeave a review: ${link}\n\nThanks,\n${b.name}${b.phone ? `\n${b.phone}` : ""}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:16px;padding:28px 24px;border-top:6px solid ${esc(b.color)}">
${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}" style="max-height:56px;max-width:200px;margin-bottom:16px">` : `<p style="font-weight:700;font-size:18px;margin:0 0 16px">${esc(b.name)}</p>`}
<p style="font-size:16px;line-height:1.55;margin:0 0 22px">${esc(body)}</p>
<p style="margin:0 0 8px;font-size:15px;color:#525252">How did we do?</p>
<p style="margin:0 0 24px"><a href="${esc(link)}" style="display:inline-block;background:${esc(b.color)};color:${esc(b.onColor)};text-decoration:none;font-weight:600;font-size:16px;padding:14px 22px;border-radius:12px">★★★★★ Leave a review</a></p>
<p style="font-size:14px;color:#525252;margin:0">Thanks,<br>${esc(b.name)}${b.phone ? `<br>${esc(b.phone)}` : ""}</p>
</div>
<p style="font-size:12px;color:#a3a3a3;text-align:center;margin-top:14px">You're getting this because ${esc(b.name)} recently did some work for you. Reply to let them know if you'd rather not hear from them.</p>
</div></body></html>`;
  await sendEmail({
    to: contact.email,
    subject: step === 1 ? `Thanks from ${b.name}` : `A quick favour from ${b.name}?`,
    text,
    html,
    fromName: b.name,
    replyTo: c.invoice_details?.businessEmail || c.email,
  });
  await bumpConversation(contact.id, `Review request emailed to ${contact.email}`, "outbound", false);
}
