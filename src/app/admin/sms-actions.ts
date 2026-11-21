"use server";

import { revalidatePath } from "next/cache";
import { db, type Client } from "@/lib/supabase";
import { displayPhone, forwardingCodes, normalizePhone, type Country } from "@/lib/phone";
import { countryOf, sendSms } from "@/lib/sms";
import { buyUkMobileNumber, buyUsLocalNumber } from "@/lib/twilio";
import { clientLabel } from "@/lib/clients";
import { env } from "@/lib/env";
import { phoneWelcomeEmail, sendEmail } from "@/lib/email";
import { firstNameOf } from "@/lib/onboarding";

// Behind the /admin Basic auth in src/proxy.ts.

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim() || null;

export async function saveSmsSettings(formData: FormData) {
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
export async function sendTestText(formData: FormData) {
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

/**
 * One click after the onboarding form: buys their UK mobile number, points it at the app,
 * switches texts on, and sends the owner their app link and forwarding codes by text and email.
 */
export async function setUpPhone(formData: FormData) {
  const id = String(formData.get("clientId"));
  const { data: c } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (!c) throw new Error("Client not found");
  if (!c.owner_mobile) throw new Error("Add the owner's mobile first (it comes from the onboarding form)");

  let number = c.twilio_number;
  let service = c.messaging_service_sid;
  if (!number) {
    const name = `ASC: ${clientLabel(c)}`;
    if (countryOf(c) === "US") {
      const bought = await buyUsLocalNumber(name, c.owner_mobile);
      number = bought.phoneNumber;
      service = bought.messagingServiceSid;
    } else {
      number = (await buyUkMobileNumber(name)).phoneNumber;
    }
    const { error } = await db()
      .from("clients")
      .update({ twilio_number: number, messaging_service_sid: service, sms_enabled: true, last_forwarded_call_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Bought ${number} but couldn't save it: ${error.message}. Add it manually.`);
  }
  await sendWelcome({ ...c, twilio_number: number, messaging_service_sid: service, sms_enabled: true });
  revalidatePath(`/admin/clients/${id}`);
}

/** Sends the app link and forwarding codes again (e.g. they lost the text). */
export async function resendPhoneWelcome(formData: FormData) {
  const id = String(formData.get("clientId"));
  const { data: c } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (!c?.twilio_number || !c.owner_mobile) throw new Error("Set up their phone first");
  await sendWelcome(c);
  revalidatePath(`/admin/clients/${id}`);
}

async function sendWelcome(c: Client) {
  const appUrl = `${env.appUrl}/m/${c.dashboard_token}`;
  const n = c.twilio_number!;
  const country = countryOf(c);
  const { data: sub } = await db().from("onboarding_submissions").select("data").eq("client_id", c.id).order("created_at", { ascending: false }).limit(1).maybeSingle<{ data: Record<string, unknown> }>();
  const otherLine = sub?.data?.customersCallMobile === "No" ? String(sub.data.customersCallNumber ?? "") : null;
  const codes = forwardingCodes(country, n, c.mobile_carrier);
  const firstCode = codes.length === 1 ? codes[0].steps[0].code : null;

  const switchOn = firstCode
    ? `To switch it on, dial ${firstCode} on ${otherLine ? `the phone customers call (${otherLine})` : "your phone"} and press call.`
    : `To switch it on, follow the steps in your email for your carrier.`;
  // In the US the welcome goes by email only until their A2P registration is approved (unregistered texts are blocked).
  const text =
    country === "US"
      ? { ok: true as const }
      : await sendSms({
          client: c,
          to: c.owner_mobile!,
          kind: "owner_confirm",
          body: `Welcome to ASC! This number texts your customers when you miss a call. Your inbox app: ${appUrl} (open it, then Add to Home Screen). ${switchOn} Full steps are in your email.`,
        });
  try {
    await sendEmail({
      to: c.email,
      ...phoneWelcomeEmail({ firstName: firstNameOf(c), appUrl, twilioNumber: country === "US" ? displayPhone(n) : n, forwardingOn: otherLine, codes, us: country === "US" }),
    });
  } catch (err) {
    console.error("Phone welcome email failed", c.id, err);
    if (country === "US") throw new Error("Number is set up, but the welcome email failed. Send them the app link from this page.");
  }
  if (!text.ok) throw new Error(`Number is set up, but the welcome text failed: ${"error" in text ? text.error : ""}`);
}
