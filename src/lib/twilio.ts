import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** Twilio sends webhooks as form posts. Returns the fields as a plain object. */
export async function readTwilioForm(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);
  return params;
}

/**
 * Checks the X-Twilio-Signature header so nobody else can post to our webhooks.
 * Twilio signs the full public URL it called plus the POST fields, sorted by name, with the Auth Token.
 * We rebuild the URL from APP_URL because Vercel's internal request URL can differ.
 */
export function isFromTwilio(request: Request, params: Record<string, string>): boolean {
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return false;
  const url = new URL(request.url);
  const publicUrl = `${env.appUrl}${url.pathname}${url.search}`;
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], publicUrl);
  const token = env.twilioAuthToken;
  const expected = createHmac("sha1", token).update(payload, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    // Safe to log: no secret values, just enough to tell a wrong token from a wrong URL.
    console.warn("Twilio signature mismatch", {
      signedUrl: publicUrl,
      requestUrl: request.url,
      accountSidMatches: params.AccountSid ? params.AccountSid === env.twilioAccountSid : "no AccountSid param",
      tokenLength: token.length,
      tokenLooksLikeAuthToken: /^[0-9a-f]{32}$/.test(token),
    });
  }
  return ok;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export function twiml(body = ""): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}

/** Short spoken message to a caller, then hang up. */
export function sayAndHangUp(message: string): Response {
  return twiml(`<Say voice="Polly.Amy" language="en-GB">${escapeXml(message)}</Say><Hangup/>`);
}

export type SentMessage = { sid: string; status: string };

/**
 * Sends one SMS through Twilio's REST API. Throws with Twilio's error message on failure.
 * Authenticates with the Account SID + Auth Token (the same token that signs webhooks).
 * US clients send through their Messaging Service, which carries their A2P 10DLC registration.
 */
export async function twilioSend(sender: { from: string; messagingServiceSid?: string | null }, to: string, body: string): Promise<SentMessage> {
  const auth = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64");
  const params = new URLSearchParams({ To: to, Body: body, StatusCallback: `${env.appUrl}/api/twilio/status` });
  if (sender.messagingServiceSid) params.set("MessagingServiceSid", sender.messagingServiceSid);
  else params.set("From", sender.from);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
  if (!res.ok || !json.sid) throw new Error(`Twilio ${json.code ?? res.status}: ${json.message ?? "send failed"}`);
  return { sid: json.sid, status: json.status ?? "queued" };
}

const api = (path: string) => `https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}${path}`;
const authHeader = () => `Basic ${Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64")}`;

type Bought = { phoneNumber: string; sid: string };

async function purchase(phoneNumber: string, friendlyName: string, extra: Record<string, string>): Promise<Bought> {
  const res = await fetch(api(`/IncomingPhoneNumbers.json`), {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      PhoneNumber: phoneNumber,
      FriendlyName: friendlyName.slice(0, 64),
      VoiceUrl: `${env.appUrl}/api/twilio/voice`,
      VoiceMethod: "POST",
      SmsUrl: `${env.appUrl}/api/twilio/sms`,
      SmsMethod: "POST",
      ...extra,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { phone_number?: string; sid?: string; message?: string; code?: number };
  if (res.ok && json.phone_number && json.sid) return { phoneNumber: json.phone_number, sid: json.sid };
  throw new Error(`Twilio ${json.code ?? res.status}: ${json.message ?? "purchase failed"}`);
}

async function available(path: string): Promise<string[]> {
  const res = await fetch(api(path), { headers: { Authorization: authHeader() }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { available_phone_numbers?: { phone_number: string }[] };
  return res.ok ? (json.available_phone_numbers ?? []).map((n) => n.phone_number) : [];
}

/**
 * Buys a UK mobile number (voice + SMS) and points it at our webhooks in one go.
 * Uses the approved UK mobile regulatory bundle; set TWILIO_UK_BUNDLE_SID to use a different one.
 */
export async function buyUkMobileNumber(friendlyName: string): Promise<Bought> {
  const candidates = await available(`/AvailablePhoneNumbers/GB/Mobile.json?SmsEnabled=true&VoiceEnabled=true&PageSize=10`);
  if (!candidates.length) throw new Error("No UK mobile numbers available right now");
  const bundleSid = process.env.TWILIO_UK_BUNDLE_SID?.trim() || "BU3b23308d91d929b2bce6e19ca1a386c3";
  let lastError = "";
  for (const n of candidates.slice(0, 3)) {
    try {
      return await purchase(n, friendlyName, { BundleSid: bundleSid });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError);
}

/**
 * Buys a US local number, near the owner's area code when possible, points it at our webhooks,
 * and puts it in a new Messaging Service for this client. Texts only send once that service is
 * linked to an approved A2P 10DLC campaign (done in the Twilio console).
 */
export async function buyUsLocalNumber(friendlyName: string, nearNumber?: string | null): Promise<Bought & { messagingServiceSid: string }> {
  const areaCode = nearNumber?.match(/^\+1(\d{3})/)?.[1];
  let candidates = areaCode ? await available(`/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&VoiceEnabled=true&AreaCode=${areaCode}&PageSize=10`) : [];
  if (!candidates.length) candidates = await available(`/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&VoiceEnabled=true&PageSize=10`);
  if (!candidates.length) throw new Error("No US numbers available right now");

  let bought: Bought | null = null;
  let lastError = "";
  for (const n of candidates.slice(0, 3)) {
    try {
      bought = await purchase(n, friendlyName, {});
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!bought) throw new Error(lastError);

  // Messaging Service: inbound texts still use the number's own webhook.
  const svcRes = await fetch("https://messaging.twilio.com/v1/Services", {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ FriendlyName: friendlyName.slice(0, 64), UseInboundWebhookOnNumber: "true", StatusCallback: `${env.appUrl}/api/twilio/status` }),
    cache: "no-store",
  });
  const svc = (await svcRes.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!svcRes.ok || !svc.sid) throw new Error(`Bought ${bought.phoneNumber} but couldn't create its Messaging Service: ${svc.message ?? svcRes.status}`);
  const addRes = await fetch(`https://messaging.twilio.com/v1/Services/${svc.sid}/PhoneNumbers`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ PhoneNumberSid: bought.sid }),
    cache: "no-store",
  });
  if (!addRes.ok) throw new Error(`Bought ${bought.phoneNumber} but couldn't add it to its Messaging Service`);
  return { ...bought, messagingServiceSid: svc.sid };
}

/** A2P 10DLC campaign status for a US client's Messaging Service ("not registered" if none yet). */
export async function a2pStatus(messagingServiceSid: string): Promise<string> {
  try {
    const res = await fetch(`https://messaging.twilio.com/v1/Services/${messagingServiceSid}/Compliance/Usa2p`, { headers: { Authorization: authHeader() }, cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as { compliance?: { campaign_status?: string }[] };
    const status = json.compliance?.[0]?.campaign_status;
    return status ? status.replace(/_/g, " ").toLowerCase() : "not registered";
  } catch {
    return "unknown";
  }
}
