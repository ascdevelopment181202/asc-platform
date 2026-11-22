import "server-only";
import { firstThatFits } from "@/lib/sms-text";
import { db, type Client } from "@/lib/supabase";
import { brandOf } from "@/lib/brand";
import { firstNameOf, senderLine, type Contact } from "@/lib/sms";

const HOUR = 3600_000;

/**
 * After a 5 star rating, one thank-you text a few hours later that asks for referrals.
 * Once per job, and never if they've opted out.
 */
export async function queueReferral(c: Client, jobId: string) {
  if (!c.referral_ask) return;
  const { data: claimed } = await db().from("jobs").update({ referral_sent_at: new Date().toISOString() }).eq("id", jobId).is("referral_sent_at", null).select("contact_id").returns<{ contact_id: string }[]>();
  const contactId = claimed?.[0]?.contact_id;
  if (!contactId) return;
  const { data: contact } = await db().from("contacts").select("*").eq("id", contactId).maybeSingle<Contact>();
  if (!contact || contact.opted_out_at) return;
  await db().from("outbox").insert({ client_id: c.id, contact_id: contact.id, body: referralText(c, contact), send_at: new Date(Date.now() + 3 * HOUR).toISOString() });
}

export function referralText(c: Client, contact: Pick<Contact, "name">) {
  const b = brandOf(c);
  const hi = firstNameOf(contact.name) ? `Thanks so much, ${firstNameOf(contact.name)}!` : "Thanks so much!";
  const reach = b.phone ? `they can reach us on ${b.phone}` : "just pass on this number";
  const stop = c.country === "US" ? " Reply STOP to opt out" : "";
  return firstThatFits([
    `${hi} Your review really means a lot. If you know anyone who needs a hand, ${reach}. ${senderLine(c)}${stop}`,
    `${hi} Know anyone who needs a hand? ${b.phone ? `They can call us on ${b.phone}` : "Pass on this number"}. ${b.name}${stop}`,
    `${hi} Know anyone who needs a hand? Pass on our number.${stop}`,
  ]);
}
