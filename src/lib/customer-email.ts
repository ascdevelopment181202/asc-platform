import "server-only";
import { sendEmail } from "@/lib/email";
import { brandOf } from "@/lib/brand";
import { bumpConversation, sendSms, type Contact } from "@/lib/sms";
import type { Client } from "@/lib/supabase";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const validEmail = (e: string | null | undefined): e is string => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

/** A short email in the client's branding (logo, colour), from their business name, replies to them. */
export async function sendCustomerEmail(c: Client, to: string, m: { subject: string; paragraphs: string[]; button?: { label: string; url: string }; footnote?: string }) {
  const b = brandOf(c);
  const text = [...m.paragraphs, m.button ? `${m.button.label}: ${m.button.url}` : "", `Thanks,\n${b.name}${b.phone ? `\n${b.phone}` : ""}`].filter(Boolean).join("\n\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border-radius:16px;padding:28px 24px;border-top:6px solid ${esc(b.color)}">
${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}" style="max-height:56px;max-width:200px;margin-bottom:16px">` : `<p style="font-weight:700;font-size:18px;margin:0 0 16px">${esc(b.name)}</p>`}
${m.paragraphs.map((p) => `<p style="font-size:16px;line-height:1.55;margin:0 0 16px">${esc(p)}</p>`).join("")}
${m.button ? `<p style="margin:8px 0 24px"><a href="${esc(m.button.url)}" style="display:inline-block;background:${esc(b.color)};color:${esc(b.onColor)};text-decoration:none;font-weight:600;font-size:16px;padding:14px 22px;border-radius:12px">${esc(m.button.label)}</a></p>` : ""}
<p style="font-size:14px;color:#525252;margin:0">Thanks,<br>${esc(b.name)}${b.phone ? `<br>${esc(b.phone)}` : ""}</p>
</div>
${m.footnote ? `<p style="font-size:12px;color:#a3a3a3;text-align:center;margin-top:14px">${esc(m.footnote)}</p>` : ""}
</div></body></html>`;
  await sendEmail({ to: to.trim(), subject: m.subject, text, html, fromName: b.name, replyTo: c.invoice_details?.businessEmail || c.email });
}

/**
 * Tells a customer something (a quote, a booking): by email when we have their address (free),
 * by text otherwise or when the owner asks for a text. Shows in their conversation either way.
 */
export async function messageCustomer(p: {
  client: Client;
  contact: Contact;
  text: string;
  email: { subject: string; paragraphs: string[]; button?: { label: string; url: string } };
  forceText?: boolean;
}): Promise<{ ok: true; channel: "email" | "sms" } | { ok: false; error: string }> {
  const { client: c, contact } = p;
  if (!p.forceText && validEmail(contact.email)) {
    try {
      await sendCustomerEmail(c, contact.email, p.email);
      await bumpConversation(contact.id, `Emailed: ${p.email.subject}`, "outbound", false);
      return { ok: true, channel: "email" };
    } catch (err) {
      console.error("customer email failed, falling back to text", c.id, err);
    }
  }
  if (contact.opted_out_at) return { ok: false, error: "This customer replied STOP, so they can't be texted." };
  const r = await sendSms({ client: c, to: contact.phone, body: p.text, kind: "manual", contactId: contact.id });
  return r.ok ? { ok: true, channel: "sms" } : { ok: false, error: r.error };
}
