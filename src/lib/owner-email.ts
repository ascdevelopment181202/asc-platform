import "server-only";
import { sendEmail } from "@/lib/email";
import { clientLabel } from "@/lib/clients";
import type { Client } from "@/lib/supabase";

/** Emails the business owner (free) instead of texting them, for when their phone has no notifications. */
export async function emailOwner(c: Client, subject: string, lines: string[], link?: { label: string; url: string }) {
  if (!c.email) return false;
  const text = [...lines, link ? `${link.label}: ${link.url}` : "", "Tip: turn on notifications in your app and these arrive on your phone instantly instead."].filter(Boolean).join("\n\n");
  await sendEmail({ to: c.email, subject: `${subject} | ${clientLabel(c)}`, text });
  return true;
}
