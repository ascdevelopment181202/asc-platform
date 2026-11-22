import { db, type Client } from "@/lib/supabase";
import { displayPhone, forwardingCodes } from "@/lib/phone";
import { countryOf, sendSms } from "@/lib/sms";
import { buyUkMobileNumber, buyUsLocalNumber } from "@/lib/twilio";
import { clientLabel } from "@/lib/clients";
import { env } from "@/lib/env";
import { phoneWelcomeEmail, sendEmail } from "@/lib/email";
import { firstNameOf } from "@/lib/onboarding";

/**
 * Buys the client's number (UK mobile, or US local plus Messaging Service), points it at the app,
 * switches texts on, and sends the owner their app link and forwarding codes by text and email.
 * Safe to run again: an existing number is kept and only the welcome is re-sent.
 */
export async function setUpPhoneForClient(id: string) {
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
  await sendPhoneWelcome({ ...c, twilio_number: number, messaging_service_sid: service, sms_enabled: true });
  return number;
}

export async function sendPhoneWelcome(c: Client) {
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

/** Turns Twilio's error codes into what to do next. */
export function friendlyPhoneError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("21404")) return "Your Twilio account is still on the free trial, which only allows one number. Upgrade it (\"Upgrade Now\" at the top of the Twilio console), then click Set up phone again. Nothing was charged.";
  if (msg.includes("21608") || msg.includes("21219")) return "Twilio's trial can only text verified numbers. Upgrade Twilio, or add this number under Phone Numbers, then Verified Caller IDs.";
  if (msg.includes("20003")) return "Twilio rejected the account details. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Vercel.";
  return msg;
}
