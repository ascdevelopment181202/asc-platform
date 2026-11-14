"use server";

import { env } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { notifyAdmin, sendEmail } from "@/lib/email";
import type { Site } from "@/lib/sites";

export type EnquiryState = { ok: boolean; error?: string };

export async function submitEnquiry(siteId: string, _prev: EnquiryState, formData: FormData): Promise<EnquiryState> {
  // Honeypot: real people never fill this hidden field.
  if (String(formData.get("company") ?? "").trim()) return { ok: true };

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const email = String(formData.get("email") ?? "").trim().slice(0, 160);
  const postcode = String(formData.get("postcode") ?? "").trim().slice(0, 20);
  const service = String(formData.get("service") ?? "").trim().slice(0, 120);
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000);
  const sourcePath = String(formData.get("path") ?? "").slice(0, 200);

  if (!name) return { ok: false, error: "Please add your name." };
  if (!phone && !email) return { ok: false, error: "Please add a phone number or email so we can get back to you." };

  const { data: site } = await db().from("sites").select("*").eq("id", siteId).maybeSingle<Site>();
  if (!site) return { ok: false, error: "Something went wrong. Please call us instead." };

  const { error } = await db().from("enquiries").insert({
    site_id: site.id,
    client_id: site.client_id,
    name,
    phone: phone || null,
    email: email || null,
    postcode: postcode || null,
    service: service || null,
    message: message || null,
    source_path: sourcePath || null,
  });
  if (error) return { ok: false, error: "Something went wrong. Please call us instead." };

  const c = site.content;
  const lines = [
    `New enquiry from your website, ${c.businessName}:`,
    "",
    `Name: ${name}`,
    phone && `Phone: ${phone}`,
    email && `Email: ${email}`,
    postcode && `Postcode: ${postcode}`,
    service && `Service: ${service}`,
    message && `Message: ${message}`,
    "",
    phone ? `Call them back as soon as you can: ${phone}` : `Reply to them as soon as you can: ${email}`,
    "",
    "Sent by ASC Development",
  ].filter((l): l is string => typeof l === "string" && l !== "");

  // Lead to the business owner, plus a copy to ASC so every lead is tracked.
  try {
    const { data: client } = await db().from("clients").select("*").eq("id", site.client_id).maybeSingle<Client>();
    const to = c.email || client?.email;
    if (to) {
      await sendEmail({
        to,
        subject: `New enquiry: ${name}${service ? ` (${service})` : ""}`,
        text: lines.join("\n"),
        replyTo: email || env.adminEmail,
      });
    }
    await notifyAdmin(`Lead for ${c.businessName}: ${name}`, lines);
  } catch (err) {
    console.error("Enquiry email failed", err);
  }

  return { ok: true };
}
