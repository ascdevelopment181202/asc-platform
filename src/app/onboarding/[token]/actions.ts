"use server";

import { ASSETS_BUCKET, env } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { clientLabel, createTask, once } from "@/lib/clients";
import { formReceivedEmail, notifyAdmin, sendEmail } from "@/lib/email";
import { firstNameOf } from "@/lib/onboarding";
import { describeHours, US_TIMEZONES, FIELD_LABELS, MAX_FILE_MB, MAX_PHOTOS, onboardingSchema, type OnboardingInput } from "@/lib/onboarding-fields";
import { isTextable, normalizePhone } from "@/lib/phone";
import { friendlyPhoneError, setUpPhoneForClient } from "@/lib/phone-setup";
import { EMERGENCY_AFTER_HOURS } from "@/lib/sms";
import { logoFromOnboarding } from "@/lib/brand";
import { after } from "next/server";

const BUILD_HOURS = 48;
const ALLOWED = /\.(jpe?g|png|webp|heic|heif|gif|svg|pdf|ai|eps)$/i;

async function clientForToken(token: string): Promise<Client | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const { data } = await db().from("clients").select("*").eq("onboarding_token", token).maybeSingle<Client>();
  return data;
}

type UploadRequest = { name: string; size: number; kind: "logo" | "photo" };
export type UploadTarget = { path: string; token: string };

/** Issues signed upload URLs so files go straight to storage, not through the server. */
export async function getUploadTargets(
  token: string,
  files: UploadRequest[],
): Promise<{ ok: true; targets: UploadTarget[] } | { ok: false; error: string }> {
  const client = await clientForToken(token);
  if (!client) return { ok: false, error: "This onboarding link isn't valid." };
  if (client.form_submitted_at) return { ok: false, error: "This form has already been submitted." };
  if (files.length === 0 || files.length > MAX_PHOTOS + 1) return { ok: false, error: "Too many files." };

  const targets: UploadTarget[] = [];
  for (const f of files) {
    if (!ALLOWED.test(f.name)) return { ok: false, error: `${f.name} isn't an image or logo file.` };
    if (f.size > MAX_FILE_MB * 1024 * 1024) return { ok: false, error: `${f.name} is over ${MAX_FILE_MB} MB.` };
    const safe = f.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-80);
    const path = `${client.id}/${f.kind}s/${crypto.randomUUID()}-${safe}`;
    const { data, error } = await db().storage.from(ASSETS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: "Couldn't prepare the upload. Please try again." };
    targets.push({ path: data.path, token: data.token });
  }
  return { ok: true, targets };
}

export type SubmitResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function submitOnboarding(token: string, input: OnboardingInput): Promise<SubmitResult> {
  const client = await clientForToken(token);
  if (!client) return { ok: false, error: "This onboarding link isn't valid." };
  if (client.form_submitted_at) return { ok: true };

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  const data = parsed.data;

  // Uploaded files must belong to this client.
  const prefix = `${client.id}/`;
  if ([data.logoPath, ...data.photoPaths].some((p) => p && !p.startsWith(prefix))) {
    return { ok: false, error: "Something went wrong with your uploads. Please re-add them." };
  }

  const { logoPath, photoPaths, ...answers } = data;
  answers.hours = answers.hours || describeHours(answers.hoursDays, answers.hoursStart, answers.hoursEnd);
  const country = answers.country === "US" ? "US" : "GB";
  const ownerMobile = normalizePhone(answers.mobile, country);
  const timezone = country === "US" && answers.usTimezone ? US_TIMEZONES[answers.usTimezone] : "Europe/London";
  // Only a link that opens Google's "write a review" box is used for review texts; anything else waits for you to check.
  const reviewUrl = /^https:\/\/(g\.page\/r\/|search\.google\.com\/local\/writereview)/.test(answers.reviewsLink) ? answers.reviewsLink : null;
  const now = new Date();
  const dueAt = new Date(now.getTime() + BUILD_HOURS * 3600_000);

  const { error: subErr } = await db().from("onboarding_submissions").insert({
    client_id: client.id,
    data: answers,
    logo_path: logoPath || null,
    photo_paths: photoPaths,
  });
  if (subErr) return { ok: false, error: "Couldn't save your form. Please try again." };

  // Only the first submission starts the clock.
  const { data: updated, error: updErr } = await db()
    .from("clients")
    .update({
      form_submitted_at: now.toISOString(),
      build_due_at: dueAt.toISOString(),
      status: client.status === "past_due" ? "past_due" : "building",
      business_name: client.business_name || answers.businessName,
      full_name: client.full_name || answers.contactName,
      first_name: client.first_name || answers.contactName.split(" ")[0],
      phone: client.phone || answers.mobile,
      // Missed call text back + reviews: set up the parts the form gives us. The Twilio number is added in admin.
      country,
      timezone,
      mobile_carrier: country === "US" ? answers.carrier || null : null,
      owner_mobile: client.owner_mobile || (isTextable(ownerMobile, country) ? ownerMobile : null),
      business_hours: { start: answers.hoursStart, end: answers.hoursEnd, days: answers.hoursDays },
      google_review_url: client.google_review_url || reviewUrl,
      // Emergency call-out businesses get an after-hours text that offers an URGENT reply.
      missed_call_after_hours_template:
        client.missed_call_after_hours_template || (answers.emergency === "Yes" ? EMERGENCY_AFTER_HOURS[country] : null),
    })
    .eq("id", client.id)
    .is("form_submitted_at", null)
    .select("*")
    .maybeSingle<Client>();
  if (updErr) return { ok: false, error: "Couldn't save your form. Please try again." };
  if (!updated) return { ok: true }; // a parallel submit already won

  await createTask(client.id, `Build and launch: ${clientLabel(updated)}`, dueAt);

  // Their uploaded logo goes on their quotes, invoices and review page.
  if (logoPath && !updated.logo_url) {
    after(async () => {
      const url = await logoFromOnboarding(client.id, logoPath, ASSETS_BUCKET);
      if (url) await db().from("clients").update({ logo_url: url }).eq("id", client.id).is("logo_url", null);
    });
  }

  // UK clients: buy their number and send the welcome straight away, after the form has replied.
  // US clients wait for you, because their number needs A2P registration alongside it.
  const autoPhone = country === "GB" && !!updated.owner_mobile && !updated.twilio_number;
  if (autoPhone) {
    after(async () => {
      try {
        await once(client.id, "auto_phone_setup", async () => {
          const number = await setUpPhoneForClient(client.id);
          await notifyAdmin(`Phone live: ${clientLabel(updated)}`, [
            `Bought ${number} for ${clientLabel(updated)} and sent their welcome text and email.`,
            "Next: the 2-minute setup call (forwarding code, add app to home screen, live test).",
            `${env.appUrl}/admin/clients/${client.id}#sms`,
          ]);
        });
      } catch (err) {
        console.error("Automatic phone setup failed", client.id, err);
        await notifyAdmin(`Phone setup needs you: ${clientLabel(updated)}`, [
          `Automatic phone setup for ${clientLabel(updated)} didn't finish: ${friendlyPhoneError(err)}`,
          `Open their admin page and click "Set up phone": ${env.appUrl}/admin/clients/${client.id}#sms`,
        ]).catch(() => {});
      }
    });
  }

  // Emails are best effort: the form is saved either way.
  try {
    await once(client.id, "form_received_email", () =>
      sendEmail({ to: updated.email, ...formReceivedEmail({ firstName: firstNameOf(updated), dueAt }) }),
    );
    await once(client.id, "admin_form_submitted", () =>
      notifyAdmin(`Form in, build due ${dueAt.toLocaleString("en-GB", { timeZone: "Europe/London" })}: ${clientLabel(updated)}`, [
        `${clientLabel(updated)} submitted their onboarding form. The 48-hour clock has started.`,
        "",
        ...Object.entries(answers)
          .filter(([, v]) => v !== "" && v !== false && !(Array.isArray(v)))
          .map(([k, v]) => `${FIELD_LABELS[k] ?? k}: ${v === true ? "Yes" : v}`),
        "",
        `Logo: ${logoPath ? "uploaded" : "none"}  |  Photos: ${photoPaths.length}${photoPaths.length ? "" : " (use photos from their website or Google)"}`,
        ...(country === "US" ? [`US client: after "Set up phone", register their A2P 10DLC brand and campaign in Twilio (legal name ${answers.legalName}${answers.ein ? `, EIN ${answers.ein}` : ", sole proprietor"}). Texts send once it's verified.`] : []),
        `Phone: ${autoPhone ? "their UK number is being bought and their welcome sent automatically. Check it's showing on their admin page, then book the 2-minute setup call." : `click "Set up phone" on their admin page to buy their number and send their app link.`}${answers.customersCallMobile === "No" ? ` Customers call ${answers.customersCallNumber}, so forwarding goes on that line.` : ""}`,
        `Dashboard: ${env.appUrl}/admin/clients/${client.id}`,
      ]),
    );
  } catch (err) {
    console.error("Onboarding emails failed", err);
  }

  return { ok: true };
}
