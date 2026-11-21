"use server";

import { revalidatePath } from "next/cache";
import { db, type Client } from "@/lib/supabase";
import { normalizeUk } from "@/lib/phone";
import { sendSms } from "@/lib/sms";

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

  const twilio = twilioNumber ? normalizeUk(twilioNumber) : null;
  const owner = ownerMobile ? normalizeUk(ownerMobile) : null;
  if (twilioNumber && !twilio) throw new Error("Twilio number doesn't look right");
  if (ownerMobile && !owner) throw new Error("Owner mobile doesn't look right");
  if (reviewUrl && !/^https:\/\//.test(reviewUrl)) throw new Error("Review link must start with https://");
  if (enabled && (!twilio || !owner || !reviewUrl)) throw new Error("Set the Twilio number, owner mobile and review link before switching texts on");

  const { error } = await db()
    .from("clients")
    .update({
      twilio_number: twilio,
      owner_mobile: owner,
      google_review_url: reviewUrl,
      sms_enabled: enabled,
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
    body: `Test from ASC: this is the number your customers will get texts from. To ask for a review, text DONE 07700900123 Sarah to this number.`,
    kind: "test",
  });
  if (!result.ok) throw new Error(`Test text failed: ${result.error}`);
  revalidatePath(`/admin/clients/${id}`);
}
