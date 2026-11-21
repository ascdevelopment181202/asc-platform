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
  const expected = createHmac("sha1", env.twilioAuthToken).update(payload, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
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

/** Sends one SMS through Twilio's REST API using the API key. Throws with Twilio's error message on failure. */
export async function twilioSend(from: string, to: string, body: string): Promise<SentMessage> {
  const auth = Buffer.from(`${env.twilioApiKeySid}:${env.twilioApiKeySecret}`).toString("base64");
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
