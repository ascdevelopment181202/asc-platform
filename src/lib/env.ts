function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get stripeSecretKey() {
    return required("STRIPE_SECRET_KEY");
  },
  get stripeWebhookSecret() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
  get resendApiKey() {
    return required("RESEND_API_KEY");
  },
  get emailFrom() {
    return required("EMAIL_FROM");
  },
  get adminEmail() {
    return required("ADMIN_EMAIL");
  },
  get appUrl() {
    return required("APP_URL").replace(/\/$/, "");
  },
  get bookingUrl() {
    return required("BOOKING_URL");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get contactPhone() {
    return process.env.CONTACT_PHONE ?? "07784 071383";
  },
};

export const ASSETS_BUCKET = "client-assets";
