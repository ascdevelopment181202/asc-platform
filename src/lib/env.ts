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
  /** The Google account clients add as a Business Profile manager (onboarding form). */
  get googleManagerEmail() {
    return (process.env.GOOGLE_MANAGER_EMAIL || "chavanayush802@gmail.com").trim();
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
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get twilioAccountSid() {
    return required("TWILIO_ACCOUNT_SID").trim();
  },
  /** Sends texts (REST API) and checks that webhook requests really come from Twilio. */
  get twilioAuthToken() {
    return required("TWILIO_AUTH_TOKEN").trim();
  },
  get contactPhone() {
    return process.env.CONTACT_PHONE ?? "07784 071383";
  },
};

export const ASSETS_BUCKET = "client-assets";

export const googleEnabled = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

const opt = (name: string) => process.env[name]?.trim() || null;

/** SEO autopilot (admin only). Every key is optional: a missing one shows "Not connected" and the rest still works. */
export const seoEnv = {
  /** The whole feature is dark unless SEO_AUTOPILOT=1. */
  on: () => process.env.SEO_AUTOPILOT === "1",
  anthropicKey: () => opt("ANTHROPIC_API_KEY"),
  googleKey: () => opt("GOOGLE_API_KEY"),
  geminiKey: () => opt("GEMINI_API_KEY"),
  openaiKey: () => opt("OPENAI_API_KEY"),
  perplexityKey: () => opt("PERPLEXITY_API_KEY"),
  dataForSeo: () => (opt("DATAFORSEO_LOGIN") && opt("DATAFORSEO_PASSWORD") ? { login: opt("DATAFORSEO_LOGIN")!, password: opt("DATAFORSEO_PASSWORD")! } : null),
  githubToken: () => opt("GITHUB_TOKEN"),
  vercelToken: () => opt("VERCEL_TOKEN"),
  bingKey: () => opt("BING_WEBMASTER_API_KEY"),
  indexNowKey: () => opt("INDEXNOW_KEY"),
  encryptionKey: () => opt("SEO_ENCRYPTION_KEY"),
  /** Hard stop on AI spend across every client, in pounds a month. */
  aiMonthlyCapGbp: () => Number(process.env.SEO_AI_MONTHLY_CAP_GBP) || 30,
  appUrl: () => (process.env.APP_URL ?? "").replace(/\/$/, ""),
};
