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
};

export type Task = {
  id: string;
  client_id: string | null;
  created_at: string;
  title: string;
  due_at: string | null;
  done_at: string | null;
};
