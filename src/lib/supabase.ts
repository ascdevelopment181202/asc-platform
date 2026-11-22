import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let admin: SupabaseClient | null = null;

/** Server-only client using the service role key. Never import from client components. */
export function db(): SupabaseClient {
  if (!admin) {
    admin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

export type ClientStatus = "awaiting_form" | "building" | "live" | "past_due" | "cancelled";

export type Client = {
  id: string;
  created_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  email: string;
  first_name: string | null;
  full_name: string | null;
  phone: string | null;
  business_name: string | null;
  status: ClientStatus;
  onboarding_token: string;
  paid_at: string;
  form_submitted_at: string | null;
  build_due_at: string | null;
  launched_at: string | null;
  live_url: string | null;
  cancelled_at: string | null;
  notes: string | null;
  report_note: string | null;
  dashboard_token: string;
  // Missed call text back + review requests
  twilio_number: string | null;
  owner_mobile: string | null;
  google_review_url: string | null;
  sms_enabled: boolean;
  missed_call_template: string | null;
  missed_call_after_hours_template: string | null;
  review_template: string | null;
  review_followup_template: string | null;
  timezone: string;
  business_hours: { start: string; end: string; days: number[] };
  last_forwarded_call_at: string | null;
  forward_replies: boolean;
  country: "GB" | "US";
  mobile_carrier: string | null;
  messaging_service_sid: string | null;
  // Client app settings
  booking_token: string;
  booking_enabled: boolean;
  booking_slot_minutes: number;
  booking_notice_hours: number;
  booking_days_ahead: number;
  invoice_details: InvoiceDetails;
  brand_color: string | null; // "#F2B705": buttons and accents on quotes, invoices and the review page
  logo_url: string | null; // public URL (PNG or JPG so it can go on PDFs)
  review_slug: string; // shareable review page: /r/<review_slug>
};

/** What goes on a client's quotes and invoices, and how their customers pay. */
export type InvoiceDetails = {
  businessAddress?: string;
  vatNumber?: string;
  defaultVatPercent?: number;
  paymentLink?: string; // their own Stripe/SumUp/PayPal link
  bankName?: string;
  accountName?: string;
  sortCode?: string; // UK
  accountNumber?: string;
  routingNumber?: string; // US
  paymentTerms?: string;
  businessPhone?: string; // shown on documents and the review page; defaults to the owner's mobile
  businessEmail?: string;
  website?: string;
  companyNumber?: string;
};

export type Task = {
  id: string;
  client_id: string | null;
  created_at: string;
  title: string;
  due_at: string | null;
  done_at: string | null;
};
