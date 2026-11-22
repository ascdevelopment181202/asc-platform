"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/supabase";
import { notifyClient } from "@/lib/push";
import { loadClientBySlug } from "@/lib/review-funnel";
import { isTextable, normalizePhone } from "@/lib/phone";
import { bumpConversation, countryOf, upsertContact } from "@/lib/sms";

/** Star rating on the shareable review page: 4 or 5 go to Google, 1 to 3 to the feedback form. */
export async function rateShared(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const rating = Number(formData.get("rating"));
  const c = await loadClientBySlug(slug);
  if (!c || !(rating >= 1 && rating <= 5)) redirect(`/r/${slug}`);
  if (rating >= 4) {
    await db().from("review_ratings").insert({ client_id: c.id, rating, went_to_google: !!c.google_review_url });
    after(() => notifyClient(c.id, { title: `${"⭐".repeat(rating)} on your review page`, body: c.google_review_url ? "They've gone to Google to post it." : "Add your Google review link so happy customers can post it.", url: `/m/${c.dashboard_token}/reviews` }));
    if (c.google_review_url) redirect(c.google_review_url);
    redirect(`/r/${slug}?step=thanks`);
  }
  redirect(`/r/${slug}?step=feedback&r=${rating}`);
}

/** Private feedback from the shareable page: saved to the customer's conversation (by phone) and sent to the owner. */
export async function feedbackShared(formData: FormData) {
  const slug = String(formData.get("slug") ?? "");
  const rating = Number(formData.get("rating")) || null;
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000);
  const c = await loadClientBySlug(slug);
  if (!c) redirect(`/r/${slug}`);
  if (!message) redirect(`/r/${slug}?step=feedback&err=1${rating ? `&r=${rating}` : ""}`);

  const phone = normalizePhone(String(formData.get("phone") ?? ""), countryOf(c));
  const contact = phone && isTextable(phone, countryOf(c)) ? await upsertContact(c.id, phone, name || null) : null;
  const stars = rating ? `${rating}/5 stars` : "no rating";
  await db().from("review_ratings").insert({ client_id: c.id, contact_id: contact?.id ?? null, rating: rating ?? 3, feedback: `${name ? `${name}: ` : ""}${message}` });
  if (contact) {
    await db().from("contact_notes").insert({ client_id: c.id, contact_id: contact.id, body: `Private feedback from your review page (${stars}):\n${message}` });
    await bumpConversation(contact.id, `Feedback (${stars}): ${message}`, "inbound", true);
  }
  await notifyClient(c.id, {
    title: `Feedback from ${name || "a customer"} (${stars})`,
    body: message.slice(0, 140),
    url: contact ? `/m/${c.dashboard_token}/c/${contact.id}` : `/m/${c.dashboard_token}/reviews`,
  });
  redirect(`/r/${slug}?step=thanks&sent=1`);
}
