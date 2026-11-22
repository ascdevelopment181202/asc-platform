import "server-only";
import { db, type Client } from "./supabase";
import { clientLabel } from "./clients";
import { env } from "./env";
import { isTextable, localeFor, normalizePhone, type Country } from "./phone";
import { twilioSend } from "./twilio";
import { setStage } from "./crm";

export type Contact = {
  id: string;
  client_id: string;
  phone: string;
  name: string | null;
  opted_out_at: string | null;
  last_review_request_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: "inbound" | "outbound" | "call" | null;
  unread_count: number;
  starred: boolean;
  email: string | null;
  address: string | null;
  tags: string[];
  stage: Stage | null;
  stage_changed_at: string | null;
  job_value_pence: number | null;
};

export type Stage = "new" | "quoted" | "booked" | "done" | "paid" | "lost";

export type Job = {
  id: string;
  client_id: string;
  contact_id: string;
  source: "dashboard" | "sms" | "bulk" | "booking" | "integration" | "reask";
  review_token: string;
  job_label: string | null;
  appointment_id: string | null;
  referral_sent_at: string | null;
  rescue_task_id: string | null;
  completed_at: string;
  review_clicked_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
};

export type SmsKind = "missed_call" | "review" | "owner_forward" | "owner_confirm" | "test" | "manual";

/** Texts that belong in the customer conversation (the rest are system texts to the owner). */
const CONVERSATION_KINDS: SmsKind[] = ["missed_call", "review", "manual"];

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Review texts after a job: first ask, then two gentle reminders. Bulk uploads get the first ask only. */
export const REVIEW_STEPS_MS = [2 * HOUR, 4 * DAY, 14 * DAY];
/** Don't ask the same customer for another review within this window. */
export const REVIEW_COOLDOWN_MS = 180 * DAY;
/** A caller who rings again within this window doesn't get a second text. */
export const REPEAT_CALLER_MS = 30 * 60_000;
/** Bulk uploads go out at most this many per client per day. */
export const BULK_PER_DAY = 40;

export const DEFAULT_TEMPLATES = {
  missed_call: "Hi, it's {business}. Sorry we missed your call, we're probably on a job. What do you need help with? Reply here and we'll call you back shortly.",
  missed_call_after_hours: "Hi, it's {business}. Sorry we missed you, we're closed right now. What do you need help with? Reply here and we'll get back to you first thing.",
  review: "Hi {name}, it's {sender}. {thanks} If you're happy with how it went, would you mind leaving us a quick Google review? It really helps a small business like ours: {link}",
  review_followup: "Hi {name}, it's {sender} again. If you get a minute, a quick Google review would mean a lot to us: {link} Reply STOP to opt out",
  review_reask: "Hi {name}, it's {sender}. Thanks for giving us the chance to put things right. If you're happy now, a quick Google review would mean a lot: {link}",
};

/** After-hours text for clients who do emergency call-outs (set from the onboarding form). */
export const EMERGENCY_AFTER_HOURS = {
  GB: "Hi, it's {business}. Sorry we missed you, we're closed right now. Reply with what you need and we'll get back to you first thing. If it's an emergency, reply URGENT.",
  US: "Hi, it's {business}. Sorry we missed you, we're closed right now. Reply with what you need and we'll get back to you first thing. If it's an emergency, reply URGENT. Reply STOP to opt out",
} as const;

/** US carriers expect opt-out wording in the first text a number sends to someone. */
const US_TEMPLATES = {
  missed_call: `${DEFAULT_TEMPLATES.missed_call} Reply STOP to opt out`,
  missed_call_after_hours: `${DEFAULT_TEMPLATES.missed_call_after_hours} Reply STOP to opt out`,
  review: `${DEFAULT_TEMPLATES.review} Reply STOP to opt out`,
  review_followup: DEFAULT_TEMPLATES.review_followup,
  review_reask: `${DEFAULT_TEMPLATES.review_reask} Reply STOP to opt out`,
};

export const countryOf = (c: Pick<Client, "country">): Country => (c.country === "US" ? "US" : "GB");
export const templatesFor = (c: Pick<Client, "country">) => (countryOf(c) === "US" ? US_TEMPLATES : DEFAULT_TEMPLATES);

export const TEMPLATE_HELP =
  "Use {name} for the customer's first name, {sender} for \"Paul from P.I.C Driveways\", {business} for the business name, {job} for the job (\"driveway clean\"), {thanks} for a thank-you line that mentions the job, and {link} for the review link.";

export function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m).replace(/\s+/g, " ").trim();
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "there";
/** First name, or null when we don't have one. */
export const firstNameOf = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/** Hour, minute and weekday (1 = Monday ... 7 = Sunday) in the client's time zone. */
export function localTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { hour: Number(get("hour")), minute: Number(get("minute")), weekday };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Is the business open right now, by its opening hours? Used to pick the missed-call text. */
export function isOpen(c: Pick<Client, "timezone" | "business_hours">, date = new Date()) {
  const t = localTime(date, c.timezone || "Europe/London");
  const hours = c.business_hours ?? { start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5, 6] };
  const now = t.hour * 60 + t.minute;
  return hours.days.includes(t.weekday) && now >= toMinutes(hours.start) && now < toMinutes(hours.end);
}

/** Review texts only go out between 9am and 7pm local time. */
export function inSendingWindow(c: Pick<Client, "timezone">, date = new Date()) {
  const { hour } = localTime(date, c.timezone || "Europe/London");
  return hour >= 9 && hour < 19;
}

export const businessName = (c: Client) => clientLabel(c);
export const reviewLink = (job: Pick<Job, "review_token">) => `${env.appUrl}/v/${job.review_token}`;

export function missedCallText(c: Client, date = new Date()) {
  const open = isOpen(c, date);
  const t = templatesFor(c);
  const template = open ? c.missed_call_template || t.missed_call : c.missed_call_after_hours_template || t.missed_call_after_hours;
  return fill(template, { business: businessName(c) });
}

/** "Paul from P.I.C Driveways", or just the business when we don't know who's sending. */
export function senderLine(c: Client) {
  const who = (c.sender_name || c.first_name || "").trim().split(/\s+/)[0];
  return who ? `${who} from ${businessName(c)}` : businessName(c);
}

/**
 * Cleans a booking title or invoice line into something that reads naturally in a text:
 * "Sarah - Driveway Clean" -> "driveway clean". Returns null if it wouldn't read well.
 */
export function jobLabel(raw: string | null | undefined, customerName?: string | null): string | null {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, " ").trim();
  for (const part of (customerName ?? "").split(/\s+/).filter((p) => p.length > 1)) {
    t = t.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b'?s?`, "gi"), "");
  }
  t = t.replace(/^[\s\-–:|,/]+|[\s\-–:|,/.]+$/g, "").replace(/\s*[\-–|:]\s*/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/\b(mr|mrs|ms|miss|dr)\b\.?/gi, "").replace(/\s+(for|with|at|to|from|re)\s*$/i, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(a|an|the|job|booking|appointment|visit|invoice for|quote for)\s+/i, "").trim();
  if (t.length < 3 || t.length > 40 || /\d{3,}|@|https?:/i.test(t) || /^(job|work|booking|appointment|visit|labour|labor|materials?)$/i.test(t)) return null;
  // Keep acronyms (UPVC, EV) as they are, lower-case the rest.
  return t
    .split(" ")
    .map((w) => (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

export function reviewText(c: Client, contact: Pick<Contact, "name">, job: Pick<Job, "review_token" | "job_label" | "source">, step: number) {
  const t = templatesFor(c);
  const template =
    step === 1 ? (job.source === "reask" ? t.review_reask : c.review_template || t.review) : c.review_followup_template || t.review_followup;
  const label = job.job_label?.trim();
  return fill(template, {
    business: businessName(c),
    sender: senderLine(c),
    name: firstName(contact.name),
    job: label || "the job",
    thanks: label ? `Thanks for choosing us for the ${label}.` : "Thanks for choosing us.",
    link: reviewLink(job),
  });
}

/** Finds or creates the customer record. Fills in a name if we didn't have one. */
export async function upsertContact(clientId: string, phone: string, name?: string | null): Promise<Contact> {
  const { data: existing } = await db().from("contacts").select("*").eq("client_id", clientId).eq("phone", phone).maybeSingle<Contact>();
  if (existing) {
    if (name && name.trim() && name.trim() !== existing.name) {
      await db().from("contacts").update({ name: name.trim() }).eq("id", existing.id);
      return { ...existing, name: name.trim() };
    }
    return existing;
  }
  const { data, error } = await db()
    .from("contacts")
    .insert({ client_id: clientId, phone, name: name?.trim() || null })
    .select("*")
    .single<Contact>();
  if (error) {
    // Two requests at once for the same number: read the row the other one made.
    if (error.code === "23505") return upsertContact(clientId, phone, name);
    throw error;
  }
  return data;
}

/** Sends an SMS from the client's Twilio number and logs it. Never throws: failures are logged with the error. */
export async function sendSms(p: { client: Client; to: string; body: string; kind: SmsKind; contactId?: string | null }) {
  const { data: log } = await db()
    .from("sms_log")
    .insert({ client_id: p.client.id, contact_id: p.contactId ?? null, to_number: p.to, body: p.body, kind: p.kind })
    .select("id")
    .single<{ id: string }>();
  try {
    if (!p.client.twilio_number) throw new Error("No Twilio number set for this client");
    const sent = await twilioSend({ from: p.client.twilio_number, messagingServiceSid: p.client.messaging_service_sid }, p.to, p.body);
    if (log) await db().from("sms_log").update({ twilio_message_sid: sent.sid, status: sent.status }).eq("id", log.id);
    if (p.contactId && CONVERSATION_KINDS.includes(p.kind)) {
      if (p.kind === "missed_call") await bumpConversation(p.contactId, "Missed call · auto-text sent", "call", false);
      else await bumpConversation(p.contactId, p.body, "outbound", false);
    }
    return { ok: true as const, logId: log?.id ?? null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("SMS send failed", p.client.id, p.kind, error);
    if (log) await db().from("sms_log").update({ status: "failed", error }).eq("id", log.id);
    return { ok: false as const, logId: log?.id ?? null, error };
  }
}

/** "14:05" in the UK, "2:05 PM" in the US, in the client's time zone. */
export const clientTime = (c: Pick<Client, "country" | "timezone">, date: Date) =>
  date.toLocaleTimeString(localeFor(c.country), { hour: "numeric", minute: "2-digit", timeZone: c.timezone || "Europe/London" });

/** Moves the customer's conversation to the top of the inbox. Inbound activity counts as unread. */
export async function bumpConversation(contactId: string, preview: string, direction: "inbound" | "outbound" | "call", unread: boolean) {
  const { error } = await db().rpc("bump_conversation", { p_contact: contactId, p_preview: preview, p_direction: direction, p_unread: unread });
  if (error) console.error("bump_conversation failed", contactId, error.message);
}

/** Stops any review texts still waiting for this customer (they replied, clicked or opted out). */
export async function cancelPendingReviews(contactId: string, reason: string) {
  const { data: jobs } = await db().from("jobs").select("id").eq("contact_id", contactId).is("cancelled_at", null).returns<{ id: string }[]>();
  const ids = (jobs ?? []).map((j) => j.id);
  if (!ids.length) return;
  const now = new Date().toISOString();
  await db().from("review_messages").update({ cancelled_at: now }).in("job_id", ids).is("sent_at", null).is("cancelled_at", null);
  if (reason !== "replied") await db().from("jobs").update({ cancelled_at: now, cancelled_reason: reason }).in("id", ids).is("cancelled_at", null);
}

export type CreateJobResult = { ok: true; job: Job; contact: Contact; firstSendAt: Date } | { ok: false; error: string };

/**
 * One finished job = one set of review texts. Used by the dashboard button, the owner's DONE text and bulk uploads.
 * Bulk jobs get a single text at `startAt`; everything else gets the full sequence starting 2 hours from now.
 */
export async function createJob(
  c: Client,
  input: {
    phone: string;
    name?: string | null;
    source: Job["source"];
    startAt?: Date;
    label?: string | null; // booking title, invoice line or what the owner typed
    appointmentId?: string | null;
    email?: string | null;
  },
): Promise<CreateJobResult> {
  const country = countryOf(c);
  const phone = normalizePhone(input.phone, country);
  if (!isTextable(phone, country)) return { ok: false, error: country === "US" ? "That doesn't look like a US cell number." : "That doesn't look like a UK mobile number (07...)." };
  if (!c.google_review_url) return { ok: false, error: "No Google review link is set up yet. Ask ASC to add it." };

  const contact = await upsertContact(c.id, phone, input.name);
  if (input.email && !contact.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) {
    await db().from("contacts").update({ email: input.email.trim() }).eq("id", contact.id);
    contact.email = input.email.trim();
  }
  if (contact.opted_out_at) return { ok: false, error: "This customer has opted out of texts." };
  // A second ask after putting things right is the one exception to the 6-month rule.
  if (input.source !== "reask" && contact.last_review_request_at && Date.now() - Date.parse(contact.last_review_request_at) < REVIEW_COOLDOWN_MS) {
    return { ok: false, error: "This customer was already asked for a review in the last 6 months." };
  }

  const { data: job, error } = await db()
    .from("jobs")
    .insert({
      client_id: c.id,
      contact_id: contact.id,
      source: input.source,
      job_label: jobLabel(input.label, contact.name),
      appointment_id: input.appointmentId ?? null,
    })
    .select("*")
    .single<Job>();
  if (error) throw error;

  const start = input.startAt ?? new Date(Date.now() + REVIEW_STEPS_MS[0]);
  const steps = input.source === "bulk" || input.source === "reask" ? [0] : REVIEW_STEPS_MS.map((ms) => ms - REVIEW_STEPS_MS[0]);
  const { error: stepError } = await db()
    .from("review_messages")
    .insert(steps.map((offset, i) => ({ job_id: job.id, client_id: c.id, step: i + 1, send_at: new Date(start.getTime() + offset).toISOString() })));
  if (stepError) throw stepError;

  await db().from("contacts").update({ last_review_request_at: new Date().toISOString() }).eq("id", contact.id);
  if (input.source !== "bulk" && input.source !== "reask") await setStage(contact, "done");
  return { ok: true, job, contact, firstSendAt: start };
}

/** Parses pasted lines or a CSV export into name + number pairs. Accepts "Name, 07..." or "07..., Name" or just a number. */
export function parseCustomerList(text: string, country: Country = "GB"): { name: string | null; phone: string }[] {
  const rows: { name: string | null; phone: string }[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    if (!cells.length) continue;
    const phoneCell = cells.find((cell) => isTextable(normalizePhone(cell, country), country));
    if (!phoneCell) continue;
    const phone = normalizePhone(phoneCell, country)!;
    if (seen.has(phone)) continue;
    seen.add(phone);
    const name = cells.find((cell) => cell !== phoneCell && /[a-z]/i.test(cell) && !/@/.test(cell)) ?? null;
    rows.push({ name, phone });
  }
  return rows;
}

/** Link to one conversation in the client's app (used in the "new reply" text to the owner). */
export const threadLink = (c: Pick<Client, "dashboard_token">, contactId: string) => `${env.appUrl}/m/${c.dashboard_token}/c/${contactId}`;

export async function clientByTwilioNumber(number: string | undefined) {
  if (!number) return null;
  const { data } = await db().from("clients").select("*").eq("twilio_number", number).maybeSingle<Client>();
  return data;
}
