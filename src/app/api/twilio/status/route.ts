import { db } from "@/lib/supabase";
import { isFromTwilio, readTwilioForm } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delivery updates for texts we sent (queued, sent, delivered, undelivered, failed). */
export async function POST(request: Request) {
  const params = await readTwilioForm(request);
  if (!isFromTwilio(request, params)) return new Response("Forbidden", { status: 403 });
  if (params.MessageSid && params.MessageStatus) {
    await db()
      .from("sms_log")
      .update({ status: params.MessageStatus, error: params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null })
      .eq("twilio_message_sid", params.MessageSid);
  }
  return new Response(null, { status: 204 });
}
