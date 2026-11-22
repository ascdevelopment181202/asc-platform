"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { launchEmail, sendEmail, welcomeEmail } from "@/lib/email";
import { firstNameOf, formLink, startOnboarding } from "@/lib/onboarding";
import { once } from "@/lib/clients";
import { isTextable, normalizePhone } from "@/lib/phone";
import { EMERGENCY_AFTER_HOURS } from "@/lib/sms";

// Every route under /admin is behind the Basic auth in src/proxy.ts, including these actions.

async function getClient(id: string) {
  const { data, error } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (error) throw error;
  return data;
}

export async function completeTask(formData: FormData) {
  const id = String(formData.get("taskId"));
  await db().from("tasks").update({ done_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin", "layout");
}

export async function addTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "") || null;
  const due = String(formData.get("due") ?? "");
  if (!title) return;
  await db().from("tasks").insert({ title, client_id: clientId, due_at: due ? new Date(due).toISOString() : null });
  revalidatePath("/admin", "layout");
}

/** For clients who paid outside Stripe checkout (cash, bank transfer, existing clients). */
export async function addClientManually(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;
  const client = await startOnboarding({
    email,
    fullName: String(formData.get("fullName") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    businessName: String(formData.get("businessName") ?? "").trim() || null,
  });
  redirect(`/admin/clients/${client.id}`);
}

/**
 * For existing clients you're setting up yourself: creates the account with nothing sent to them.
 * No welcome email, no form reminders, no build deadline alerts. Fill in the rest on their page.
 */
export async function addClientQuietly(formData: FormData) {
  const val = (k: string) => String(formData.get(k) ?? "").trim();
  const email = val("email");
  if (!email) return;
  const fullName = val("fullName") || null;
  const mobile = normalizePhone(val("mobile"), "GB");
  const liveUrl = val("liveUrl");
  const reviewUrl = val("reviewUrl");
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from("clients")
    .insert({
      email,
      full_name: fullName,
      first_name: fullName?.split(" ")[0] ?? null,
      business_name: val("businessName") || null,
      phone: mobile ?? (val("mobile") || null),
      country: "GB",
      timezone: "Europe/London",
      owner_mobile: mobile && isTextable(mobile, "GB") ? mobile : null,
      google_review_url: /^https:\/\//.test(reviewUrl) ? reviewUrl : null,
      // Marked as already onboarded so the form reminders and 48-hour build alerts never fire.
      form_submitted_at: now,
      status: /^https?:\/\//.test(liveUrl) ? "live" : "building",
      live_url: /^https?:\/\//.test(liveUrl) ? liveUrl : null,
      missed_call_after_hours_template: formData.get("emergency") === "on" ? EMERGENCY_AFTER_HOURS.GB : null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;
  redirect(`/admin/clients/${data.id}`);
}

export async function resendWelcome(formData: FormData) {
  const c = await getClient(String(formData.get("clientId")));
  await sendEmail({ to: c.email, ...welcomeEmail({ firstName: firstNameOf(c), formLink: formLink(c) }) });
  await db().from("client_messages").insert({ client_id: c.id, kind: `welcome_resent_${Date.now()}` });
  revalidatePath(`/admin/clients/${c.id}`);
}

export async function markLive(formData: FormData) {
  const c = await getClient(String(formData.get("clientId")));
  const liveUrl = String(formData.get("liveUrl") ?? "").trim();
  if (!/^https?:\/\//.test(liveUrl)) throw new Error("Enter the full live URL, starting with https://");

  await db()
    .from("clients")
    .update({ status: "live", launched_at: c.launched_at ?? new Date().toISOString(), live_url: liveUrl })
    .eq("id", c.id);
  await db().from("tasks").update({ done_at: new Date().toISOString() }).eq("client_id", c.id).like("title", "Build and launch:%").is("done_at", null);

  if (formData.get("sendEmail") === "on") {
    await once(c.id, "launch_email", () => sendEmail({ to: c.email, ...launchEmail({ firstName: firstNameOf(c), liveUrl }) }));
  }
  revalidatePath("/admin", "layout");
}

export async function saveNotes(formData: FormData) {
  const id = String(formData.get("clientId"));
  await db().from("clients").update({ notes: String(formData.get("notes") ?? "") }).eq("id", id);
  revalidatePath(`/admin/clients/${id}`);
}
