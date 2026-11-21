import { db } from "@/lib/supabase";
import { isFromTwilio, readTwilioForm, sayAndHangUp, twiml } from "@/lib/twilio";
import { isUkMobile, normalizeUk } from "@/lib/phone";
import { bumpConversation, clientByTwilioNumber, missedCallText, REPEAT_CALLER_MS, sendSms, upsertContact } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A call reached a client's Twilio number. Clients forward unanswered calls here,
 * so every call that arrives is a missed call: log it, text the caller, hang up.
 */
export async function POST(request: Request) {
  const params = await readTwilioForm(request);
  if (!isFromTwilio(request, params)) return new Response("Forbidden", { status: 403 });

  const client = await clientByTwilioNumber(params.To);
  if (!client) return sayAndHangUp("Sorry, this number is not in service.");

  const from = normalizeUk(params.From);
  const now = new Date();
  await db().from("clients").update({ last_forwarded_call_at: now.toISOString() }).eq("id", client.id);

  let skipped: string | null = null;
  let contactId: string | null = null;
  if (!from) skipped = "withheld";
  else if (!from.startsWith("+44")) skipped = "international";
  else if (!isUkMobile(from)) skipped = "landline";
  else if (!client.sms_enabled) skipped = "sms_disabled";

  if (!skipped && from) {
    const contact = await upsertContact(client.id, from);
    contactId = contact.id;
    if (contact.opted_out_at) skipped = "opted_out";
    else {
      const { count } = await db()
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .eq("contact_id", contact.id)
        .eq("text_sent", true)
        .gte("created_at", new Date(now.getTime() - REPEAT_CALLER_MS).toISOString());
      if (count) skipped = "repeat_caller";
    }
  }

  const { data: call } = await db()
    .from("calls")
    .insert({ client_id: client.id, contact_id: contactId, from_number: from ?? params.From ?? null, twilio_call_sid: params.CallSid ?? null, skipped_reason: skipped })
    .select("id")
    .single<{ id: string }>();
  // Twilio retried a call we already handled.
  if (!call) return twiml("<Hangup/>");
  // Missed calls show in the inbox as unread, like GoHighLevel.
  if (contactId) await bumpConversation(contactId, "Missed call", "call", true);

  let texted = skipped === "repeat_caller"; // they already have a text from a moment ago
  if (!skipped && from) {
    const sent = await sendSms({ client, to: from, body: missedCallText(client, now), kind: "missed_call", contactId });
    await db().from("calls").update(sent.ok ? { text_sent: true } : { skipped_reason: "send_failed" }).eq("id", call.id);
    texted = sent.ok;
  }

  if (!texted) return sayAndHangUp("Sorry we missed your call. We'll get back to you as soon as we can.");
  return sayAndHangUp("Sorry we missed your call. We've sent you a text and will get back to you shortly.");
}
