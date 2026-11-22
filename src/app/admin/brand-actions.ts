"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { normalizeHex, uploadLogo } from "@/lib/brand";
import { DEFAULT_REVIEW_SETTINGS, reviewSettings, type ReviewSettings } from "@/lib/sms";

// Behind the /admin Basic auth in src/proxy.ts.

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Logo, colour and the business details that go on quotes, invoices and the review page. */
export async function saveBranding(f: FormData) {
  const id = str(f, "clientId");
  const { data: c } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (!c) throw new Error("Client not found");
  const back = `/admin/clients/${id}`;
  let logoUrl = c.logo_url;
  const logo = f.get("logo");
  if (logo instanceof File && logo.size > 0) {
    try {
      logoUrl = await uploadLogo(id, logo);
    } catch (err) {
      redirect(`${back}?brand_err=${encodeURIComponent(err instanceof Error ? err.message : "Couldn't save the logo.")}#brand`);
    }
  }
  const inv = c.invoice_details ?? {};
  const set = (k: string) => str(f, k) || undefined;
  await db()
    .from("clients")
    .update({
      brand_color: normalizeHex(str(f, "brandColor")),
      logo_url: logoUrl,
      invoice_details: {
        ...inv,
        businessPhone: set("businessPhone"),
        businessEmail: set("businessEmail"),
        website: set("website"),
        businessAddress: set("businessAddress"),
        companyNumber: set("companyNumber"),
        vatNumber: set("vatNumber"),
      },
    })
    .eq("id", id);
  revalidatePath(back);
  redirect(`${back}?brand_ok=1#brand`);
}

/** Which Google Business Profile this client's reviews come from, then pulls them in straight away. */
export async function saveReviewLocation(f: FormData) {
  const id = str(f, "clientId");
  const value = str(f, "location");
  const [location, ...title] = value.split("|");
  await db()
    .from("clients")
    .update({ gbp_location: location || null, gbp_title: title.join("|") || null, gbp_reviews_path: null, reviews_synced_at: null })
    .eq("id", id);
  let msg = location ? "Google profile linked." : "Google profile unlinked.";
  if (location) {
    const { data: c } = await db().from("clients").select("*").eq("id", id).single<Client>();
    try {
      const { syncReviews } = await import("@/lib/google-reviews");
      await syncReviews(c!);
      const { count } = await db().from("google_reviews").select("id", { count: "exact", head: true }).eq("client_id", id);
      msg += ` ${count ?? 0} reviews pulled in.`;
    } catch (e) {
      msg = `Saved, but Google said: ${e instanceof Error ? e.message : e}`;
    }
  }
  revalidatePath(`/admin/clients/${id}`);
  redirect(`/admin/clients/${id}?ok=${encodeURIComponent(msg)}`);
}

/** Review autopilot switches and the name used in texts. */
export async function saveAutopilot(f: FormData) {
  const id = str(f, "clientId");
  await db()
    .from("clients")
    .update({
      auto_review_after_booking: f.get("auto_review_after_booking") === "on",
      review_auto_reply: f.get("review_auto_reply") === "on",
      referral_ask: f.get("referral_ask") === "on",
      sender_name: str(f, "sender_name").slice(0, 40) || null,
      review_settings: settingsFrom(f),
    })
    .eq("id", id);
  revalidatePath(`/admin/clients/${id}`);
  redirect(`/admin/clients/${id}?ok=${encodeURIComponent("Review autopilot saved.")}`);
}

/** The competitor they want to beat: found on Google if a Places key is set, otherwise typed in. */
export async function saveCompetitor(f: FormData) {
  const id = str(f, "clientId");
  const name = str(f, "competitor_name");
  let patch: Record<string, unknown> = {
    competitor_name: name || null,
    competitor_rating: Number(str(f, "competitor_rating")) || null,
    competitor_review_count: Number.parseInt(str(f, "competitor_review_count"), 10) || null,
    competitor_place_id: null,
  };
  let msg = name ? "Competitor saved." : "Competitor cleared.";
  if (name && process.env.GOOGLE_PLACES_API_KEY) {
    const { findCompetitor } = await import("@/lib/weekly-reviews");
    const found = await findCompetitor(`${name} ${str(f, "town")}`.trim()).catch(() => null);
    if (found) {
      patch = { competitor_name: found.name, competitor_rating: found.rating, competitor_review_count: found.count, competitor_place_id: found.id };
      msg = `Found ${found.name} on Google: ${found.rating ?? "?"}★ from ${found.count ?? "?"} reviews. It updates every Monday.`;
    }
  }
  await db().from("clients").update(patch).eq("id", id);
  revalidatePath(`/admin/clients/${id}`);
  redirect(`/admin/clients/${id}?ok=${encodeURIComponent(msg)}`);
}

function settingsFrom(f: FormData): ReviewSettings {
  const num = (k: string, d: number) => (Number.isFinite(Number(str(f, k))) && str(f, k) !== "" ? Number(str(f, k)) : d);
  return reviewSettings({
    review_settings: {
      firstDelayMin: num("firstDelayMin", DEFAULT_REVIEW_SETTINGS.firstDelayMin),
      bookingDelayMin: num("bookingDelayMin", DEFAULT_REVIEW_SETTINGS.bookingDelayMin),
      reminderDays: str(f, "reminderDays").split(/[,\s]+/).map(Number).filter((n) => n > 0),
      laterDays: num("laterDays", DEFAULT_REVIEW_SETTINGS.laterDays),
      onPaid: f.get("onPaid") === "on",
      onStage: f.get("onStage") === "on",
    },
  });
}

/** Monthly texting budget (alert) and campaign allowance for one client. */
export async function saveUsageSettings(f: FormData) {
  const id = str(f, "clientId");
  const budget = str(f, "sms_budget_gbp");
  await db()
    .from("clients")
    .update({
      sms_budget_gbp: budget === "" ? null : Math.max(0, Number(budget) || 0),
      campaign_monthly_limit: Math.max(0, Number.parseInt(str(f, "campaign_monthly_limit"), 10) || 0),
    })
    .eq("id", id);
  revalidatePath(`/admin/clients/${id}`);
  redirect(`/admin/clients/${id}?ok=${encodeURIComponent("Texting limits saved.")}`);
}
