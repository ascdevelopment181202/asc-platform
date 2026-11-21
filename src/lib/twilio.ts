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
 * Authenticates with the Account SID + Auth Token (the same token that signs webhooks),
 * so there's one secret to keep right instead of three.
 */
export async function twilioSend(from: string, to: string, body: string): Promise<SentMessage> {
  const auth = Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: to, Body: body, StatusCallback: `${env.appUrl}/api/twilio/status` }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
  if (!res.ok || !json.sid) throw new Error(`Twilio ${json.code ?? res.status}: ${json.message ?? "send failed"}`);
  return { sid: json.sid, status: json.status ?? "queued" };
}

const api = (path: string) => `https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}${path}`;
const authHeader = () => `Basic ${Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64")}`;

/**
 * Buys a UK mobile number (voice + SMS) and points it at our webhooks in one go.
 * Uses the approved UK mobile regulatory bundle; set TWILIO_UK_BUNDLE_SID to use a different one.
 */
export async function buyUkMobileNumber(friendlyName: string): Promise<string> {
  const search = await fetch(api(`/AvailablePhoneNumbers/GB/Mobile.json?SmsEnabled=true&VoiceEnabled=true&PageSize=10`), {
    headers: { Authorization: authHeader() },
    cache: "no-store",
  });
  const found = (await search.json().catch(() => ({}))) as { available_phone_numbers?: { phone_number: string }[]; message?: string };
  const candidates = found.available_phone_numbers ?? [];
  if (!search.ok || !candidates.length) throw new Error(`No UK mobile numbers available right now${found.message ? `: ${found.message}` : ""}`);

  const bundleSid = process.env.TWILIO_UK_BUNDLE_SID?.trim() || "BU3b23308d91d929b2bce6e19ca1a386c3";
  let lastError = "";
  for (const { phone_number } of candidates.slice(0, 3)) {
    const res = await fetch(api(`/IncomingPhoneNumbers.json`), {
      method: "POST",
      headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        PhoneNumber: phone_number,
        BundleSid: bundleSid,
        FriendlyName: friendlyName.slice(0, 64),
        VoiceUrl: `${env.appUrl}/api/twilio/voice`,
        VoiceMethod: "POST",
        SmsUrl: `${env.appUrl}/api/twilio/sms`,
        SmsMethod: "POST",
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { phone_number?: string; message?: string; code?: number };
    if (res.ok && json.phone_number) return json.phone_number;
    lastError = `Twilio ${json.code ?? res.status}: ${json.message ?? "purchase failed"}`;
  }
  throw new Error(lastError);
}
