import { db } from "@/lib/supabase";
import { isFromTwilio, readTwilioForm } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Twilio error codes that mean this number will never take a text (invalid, landline, not a mobile, blocked).
const DEAD = new Set(["21211", "21612", "21614", "30005", "30006", "30008"]);
// Codes that can be temporary (phone off, out of signal): only give up after it happens 3 times in a row.
const MAYBE = new Set(["30003", "30004"]);

/** Delivery updates for texts we sent (queued, sent, delivered, undelivered, failed). */
export async function POST(request: Request) {
  const params = await readTwilioForm(request);
  if (!isFromTwilio(request, params)) return new Response("Forbidden", { status: 403 });
  if (params.MessageSid && params.MessageStatus) {
    const { data: rows } = await db()
      .from("sms_log")
      .update({ status: params.MessageStatus, error: params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null })
      .eq("twilio_message_sid", params.MessageSid)
      .select("contact_id, kind")
      .returns<{ contact_id: string | null; kind: string }[]>();
    const contactId = rows?.[0]?.contact_id;
    const owner = rows?.[0]?.kind?.startsWith("owner");
    if (contactId && !owner) await trackDelivery(contactId, params.MessageStatus, params.ErrorCode);
  }
  return new Response(null, { status: 204 });
}

/** Stops paying to text numbers that can't receive them. A delivered text resets the count. */
async function trackDelivery(contactId: string, status: string, code?: string) {
  if (status === "delivered") {
    await db().from("contacts").update({ sms_fail_count: 0 }).eq("id", contactId).gt("sms_fail_count", 0);
    return;
  }
  if (status !== "undelivered" && status !== "failed") return;
  if (code === "21610") {
    await db().from("contacts").update({ opted_out_at: new Date().toISOString() }).eq("id", contactId).is("opted_out_at", null);
    return;
  }
  const { data: ct } = await db().from("contacts").select("sms_fail_count").eq("id", contactId).maybeSingle<{ sms_fail_count: number }>();
  const fails = (ct?.sms_fail_count ?? 0) + 1;
  const dead = (code && DEAD.has(code)) || (code && MAYBE.has(code) && fails >= 3);
  await db()
    .from("contacts")
    .update({ sms_fail_count: fails, ...(dead ? { sms_undeliverable_at: new Date().toISOString() } : {}) })
    .eq("id", contactId);
}
