"use server";

import { redirect } from "next/navigation";
import { db, type InvoiceDetails } from "@/lib/supabase";
import { clientFromForm } from "./data";
import { normalizeHex, uploadLogo } from "@/lib/brand";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveBookingSettings(f: FormData) {
  const c = await clientFromForm(f);
  const clamp = (v: string, lo: number, hi: number, d: number) => Math.min(Math.max(Number(v) || d, lo), hi);
  const days = f.getAll("days").map(Number).filter((d) => d >= 1 && d <= 7);
  await db()
    .from("clients")
    .update({
      booking_enabled: f.get("enabled") === "on",
      booking_slot_minutes: clamp(str(f, "slot"), 15, 480, 60),
      booking_notice_hours: clamp(str(f, "notice"), 0, 168, 4),
      booking_days_ahead: clamp(str(f, "ahead"), 1, 30, 14),
      business_hours: { start: str(f, "start") || "08:00", end: str(f, "end") || "18:00", days: days.length ? days : [1, 2, 3, 4, 5] },
    })
    .eq("id", c.id);
  redirect(`/m/${c.dashboard_token}/more/booking?ok=${encodeURIComponent("Saved.")}`);
}

export async function savePaymentSettings(f: FormData) {
  const c = await clientFromForm(f);
  const link = str(f, "paymentLink");
  if (link && !/^https:\/\//.test(link)) redirect(`/m/${c.dashboard_token}/more/payments?err=${encodeURIComponent("The payment link should start with https://")}`);
  const details: InvoiceDetails = {
    businessAddress: str(f, "businessAddress") || undefined,
    vatNumber: str(f, "vatNumber") || undefined,
    defaultVatPercent: Math.min(Math.max(Number(str(f, "defaultVatPercent")) || 0, 0), 30),
    paymentLink: link || undefined,
    bankName: str(f, "bankName") || undefined,
    accountName: str(f, "accountName") || undefined,
    sortCode: str(f, "sortCode") || undefined,
    routingNumber: str(f, "routingNumber") || undefined,
    accountNumber: str(f, "accountNumber") || undefined,
    paymentTerms: str(f, "paymentTerms") || undefined,
    businessPhone: str(f, "businessPhone") || undefined,
    businessEmail: str(f, "businessEmail") || undefined,
    website: str(f, "website") || undefined,
    companyNumber: str(f, "companyNumber") || undefined,
  };
  const back = `/m/${c.dashboard_token}/more/payments`;
  const color = str(f, "brandColor") ? normalizeHex(str(f, "brandColor")) : null;
  let logoUrl = c.logo_url;
  const logo = f.get("logo");
  if (logo instanceof File && logo.size > 0) {
    try {
      logoUrl = await uploadLogo(c.id, logo);
    } catch (err) {
      redirect(`${back}?err=${encodeURIComponent(err instanceof Error ? err.message : "Couldn't save the logo.")}`);
    }
  }
  if (f.get("removeLogo") === "on") logoUrl = null;
  await db().from("clients").update({ invoice_details: details, brand_color: color, logo_url: logoUrl }).eq("id", c.id);
  redirect(`${back}?ok=${encodeURIComponent("Saved.")}`);
}
