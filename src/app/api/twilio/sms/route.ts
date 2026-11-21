import { db, type Client } from "@/lib/supabase";
import { isFromTwilio, readTwilioForm, twiml } from "@/lib/twilio";
import { displayUk, normalizeUk } from "@/lib/phone";
import { bumpConversation, cancelPendingReviews, clientByTwilioNumber, createJob, sendSms, threadLink, upsertContact } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOP_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout"];
const START_WORDS = ["start", "unstop", "yes"];

/**
 * A text arrived at a client's Twilio number.
 * From the owner's own mobile: a command (DONE 07... Name). From anyone else: a customer reply.
 */
export async function POST(request: Request) {
  const params = await readTwilioForm(request);
  if (!isFromTwilio(request, params)) return new Response("Forbidden", { status: 403 });

  const client = await clientByTwilioNumber(params.To);
  if (!client) return twiml();

  const from = normalizeUk(params.From);
  const body = (params.Body ?? "").trim();
  if (!from) return twiml();

  if (client.owner_mobile && normalizeUk(client.owner_mobile) === from) {
    await handleOwnerCommand(client, from, body);
    return twiml();
  }

  const contact = await upsertContact(client.id, from);
  const word = body.toLowerCase().replace(/[^a-z]/g, "");

  if (STOP_WORDS.includes(word)) {
    await db().from("contacts").update({ opted_out_at: new Date().toISOString() }).eq("id", contact.id);
    await cancelPendingReviews(contact.id, "opted_out");
    return twiml();
  }
  if (START_WORDS.includes(word) && contact.opted_out_at) {
    await db().from("contacts").update({ opted_out_at: null }).eq("id", contact.id);
    return twiml();
  }

  const { data: reply } = await db()
    .from("replies")
    .insert({ client_id: client.id, contact_id: contact.id, from_number: from, body, twilio_message_sid: params.MessageSid ?? null })
    .select("id")
    .single<{ id: string }>();
  if (!reply) return twiml(); // Twilio retry of a message we already have

  await bumpConversation(contact.id, body || "(no text)", "inbound", true);
  // Any reply stops the remaining review reminders; the owner takes it from here.
  await cancelPendingReviews(contact.id, "replied");

  if (client.owner_mobile && client.forward_replies) {
    const who = contact.name ? `${contact.name} (${displayUk(from)})` : displayUk(from);
    const text = `New message from ${who}: "${body.slice(0, 240)}" Reply here: ${threadLink(client, contact.id)}`;
    const sent = await sendSms({ client, to: normalizeUk(client.owner_mobile)!, body: text, kind: "owner_forward", contactId: contact.id });
    if (sent.ok) await db().from("replies").update({ forwarded: true }).eq("id", reply.id);
  }
  return twiml();
}

const HELP = 'To ask a customer for a review, text: DONE 07700900123 Sarah';

async function handleOwnerCommand(client: Client, ownerMobile: string, body: string) {
  const reply = (text: string) => sendSms({ client, to: ownerMobile, body: text, kind: "owner_confirm" });
  const match = body.match(/^\s*done\b[\s:,-]*(.*)$/i);
  if (!match) {
    await reply(`Hi! ${HELP}`);
    return;
  }

  // Everything that looks like a phone number is the number; the rest is the name.
  const rest = match[1];
  const numberMatch = rest.match(/(\+?\d[\d\s()-]{8,}\d)/);
  if (!numberMatch) {
    await reply(`Couldn't find a mobile number in that. ${HELP}`);
    return;
  }
  const name = rest.replace(numberMatch[0], "").replace(/[,;:-]/g, " ").trim() || null;
  const result = await createJob(client, { phone: numberMatch[0], name, source: "sms" });
  if (!result.ok) {
    await reply(`Not sent: ${result.error}`);
    return;
  }
  const when = result.firstSendAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: client.timezone || "Europe/London" });
  await reply(`Got it. Review request goes to ${result.contact.name ?? displayUk(result.contact.phone)} at about ${when} (texts only go out 9am to 7pm).`);
}
