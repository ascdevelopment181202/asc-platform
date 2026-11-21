"use server";

import { ASSETS_BUCKET, env } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { clientLabel, createTask, once } from "@/lib/clients";
import { formReceivedEmail, notifyAdmin, sendEmail } from "@/lib/email";
import { firstNameOf } from "@/lib/onboarding";
import { describeHours, FIELD_LABELS, MAX_FILE_MB, MAX_PHOTOS, onboardingSchema, type OnboardingInput } from "@/lib/onboarding-fields";
import { isUkMobile, normalizeUk } from "@/lib/phone";

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
  const ownerMobile = normalizeUk(answers.mobile);
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
      owner_mobile: client.owner_mobile || (isUkMobile(ownerMobile) ? ownerMobile : null),
      business_hours: { start: answers.hoursStart, end: answers.hoursEnd, days: answers.hoursDays },
      google_review_url: client.google_review_url || reviewUrl,
    })
    .eq("id", client.id)
    .is("form_submitted_at", null)
    .select("*")
    .maybeSingle<Client>();
  if (updErr) return { ok: false, error: "Couldn't save your form. Please try again." };
  if (!updated) return { ok: true }; // a parallel submit already won

  await createTask(client.id, `Build and launch: ${clientLabel(updated)}`, dueAt);

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
        `Phone: click "Set up phone" on their admin page to buy their number and send their app link.${answers.customersCallMobile === "No" ? ` Customers call ${answers.customersCallNumber}, so forwarding goes on that line.` : ""}`,
        `Dashboard: ${env.appUrl}/admin/clients/${client.id}`,
      ]),
    );
  } catch (err) {
    console.error("Onboarding emails failed", err);
  }

  return { ok: true };
}
