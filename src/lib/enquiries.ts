import "server-only";
import { env } from "./env";
import { db, type Client } from "./supabase";
import { notifyAdmin, sendEmail } from "./email";
import type { Site } from "./sites";

export type EnquiryInput = {
  siteId: string;
  name?: string;
  phone?: string;
  email?: string;
  postcode?: string;
  service?: string;
  message?: string;
  company?: string; // honeypot
  path?: string;
};

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Saves a website enquiry and emails it to the business owner and to ASC. */
export async function createEnquiry(input: EnquiryInput): Promise<{ ok: boolean; error?: string }> {
  if (clean(input.company, 200)) return { ok: true }; // bot

  const name = clean(input.name, 120);
  const phone = clean(input.phone, 40);
  const email = clean(input.email, 160);
  const postcode = clean(input.postcode, 20);
  const service = clean(input.service, 120);
  const message = clean(input.message, 2000);
  if (!name) return { ok: false, error: "Please add your name." };
  if (!phone && !email) return { ok: false, error: "Please add a phone number so we can get back to you." };

  const { data: site } = await db().from("sites").select("*").eq("id", clean(input.siteId, 60)).maybeSingle<Site>();
  if (!site) return { ok: false, error: "Something went wrong." };

  const { error } = await db().from("enquiries").insert({
    site_id: site.id,
    client_id: site.client_id,
    name,
    phone: phone || null,
    email: email || null,
    postcode: postcode || null,
    service: service || null,
    message: message || null,
    source_path: clean(input.path, 200) || null,
  });
  if (error) return { ok: false, error: "Something went wrong." };

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
  ].filter((l): l is string => typeof l === "string");

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
