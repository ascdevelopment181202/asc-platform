"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { normalizePhone, type Country } from "@/lib/phone";
import { sendSms } from "@/lib/sms";
import { friendlyPhoneError, sendPhoneWelcome, setUpPhoneForClient } from "@/lib/phone-setup";

// Behind the /admin Basic auth in src/proxy.ts.

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim() || null;

async function saveSmsSettingsInner(formData: FormData) {
  const id = String(formData.get("clientId"));
  const { data: before } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (!before) throw new Error("Client not found");

  const twilioNumber = text(formData, "twilio_number");
  const ownerMobile = text(formData, "owner_mobile");
  const reviewUrl = text(formData, "google_review_url");
  const enabled = formData.get("sms_enabled") === "on";

  const country: Country = formData.get("country") === "US" ? "US" : "GB";
  const twilio = twilioNumber ? normalizePhone(twilioNumber, country) : null;
  const owner = ownerMobile ? normalizePhone(ownerMobile, country) : null;
  const timezone = text(formData, "timezone") ?? (country === "US" ? "America/Chicago" : "Europe/London");
  if (twilioNumber && !twilio) throw new Error("Twilio number doesn't look right");
  if (ownerMobile && !owner) throw new Error("Owner mobile doesn't look right");
  if (reviewUrl && !/^https:\/\//.test(reviewUrl)) throw new Error("Review link must start with https://");
  if (enabled && (!twilio || !owner)) throw new Error("Set the Twilio number and owner mobile before switching texts on");

  const { error } = await db()
    .from("clients")
    .update({
      country,
      timezone,
      mobile_carrier: text(formData, "mobile_carrier"),
      messaging_service_sid: text(formData, "messaging_service_sid"),
      twilio_number: twilio,
      owner_mobile: owner,
      google_review_url: reviewUrl,
      sms_enabled: enabled,
      forward_replies: formData.get("forward_replies") === "on",
      missed_call_template: text(formData, "missed_call_template"),
      missed_call_after_hours_template: text(formData, "missed_call_after_hours_template"),
      review_template: text(formData, "review_template"),
      review_followup_template: text(formData, "review_followup_template"),
      business_hours: {
        start: text(formData, "hours_start") ?? "08:00",
        end: text(formData, "hours_end") ?? "18:00",
        days: formData.getAll("hours_days").map(Number).filter((d) => d >= 1 && d <= 7),
      },
      // Starting point for the "forwarding has gone quiet" check, so a new client gets a week's grace.
      ...(enabled && !before.sms_enabled ? { last_forwarded_call_at: new Date().toISOString() } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(error.code === "23505" ? "That Twilio number is already used by another client" : error.message);
  revalidatePath(`/admin/clients/${id}`);
}

/** Sends a test text to the owner from their Twilio number. Run it on the onboarding call. */
async function sendTestTextInner(formData: FormData) {
  const id = String(formData.get("clientId"));
  const { data: c } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (!c?.owner_mobile || !c.twilio_number) throw new Error("Set the Twilio number and owner mobile first");
  const result = await sendSms({
    client: c,
    to: c.owner_mobile,
    body: `Test from ASC: this is the number your customers will get texts from. To ask for a review, text DONE ${c.country === "US" ? "2145550123" : "07700900123"} Sarah to this number.`,
    kind: "test",
  });
  if (!result.ok) throw new Error(`Test text failed: ${result.error}`);
  revalidatePath(`/admin/clients/${id}`);
}

/** One click after the onboarding form (also runs automatically for UK clients when they submit it). */
async function setUpPhoneInner(formData: FormData) {
  const id = String(formData.get("clientId"));
  await setUpPhoneForClient(id, { notify: formData.get("quiet") !== "on" });
  revalidatePath(`/admin/clients/${id}`);
}

/** Sends the app link and forwarding codes again (e.g. they lost the text). */
async function resendPhoneWelcomeInner(formData: FormData) {
  const id = String(formData.get("clientId"));
  const { data: c } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (!c?.twilio_number || !c.owner_mobile) throw new Error("Set up their phone first");
  await sendPhoneWelcome(c);
  revalidatePath(`/admin/clients/${id}`);
}

/** Runs an admin action and shows the result on the client page instead of crashing it. */
async function withFeedback(formData: FormData, run: (f: FormData) => Promise<void>, ok: string) {
  const id = String(formData.get("clientId"));
  let result: string;
  try {
    await run(formData);
    result = `sms_ok=${encodeURIComponent(ok)}`;
  } catch (err) {
    console.error("Admin phone action failed", id, err);
    result = `sms_err=${encodeURIComponent(friendlyPhoneError(err))}`;
  }
  redirect(`/admin/clients/${id}?${result}#sms`);
}

export async function saveSmsSettings(formData: FormData) {
  await withFeedback(formData, saveSmsSettingsInner, "Saved.");
}

export async function sendTestText(formData: FormData) {
  await withFeedback(formData, sendTestTextInner, "Test text sent.");
}

export async function setUpPhone(formData: FormData) {
  const quiet = formData.get("quiet") === "on";
  await withFeedback(
    formData,
    setUpPhoneInner,
    quiet
      ? "Number bought and connected. Nothing was sent to the client. Click \"Send app link and forwarding codes\" when you're ready."
      : "Phone set up. Their app link and forwarding code are on their way.",
  );
}

export async function resendPhoneWelcome(formData: FormData) {
  await withFeedback(formData, resendPhoneWelcomeInner, "App link and forwarding code sent again.");
}
