import "server-only";
import { env } from "./env";
import { db } from "./supabase";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/business.manage",
];

export const googleRedirectUri = () => `${env.appUrl}/admin/google/callback`;

export function googleAuthUrl(state: string) {
  const q = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type TokenReply = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenReply> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, ...body }),
  });
  const json = (await res.json()) as TokenReply;
  if (!res.ok) throw new Error(`Google token: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

/** Finishes the OAuth flow and stores the refresh token. */
export async function connectGoogle(code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token. Remove ASC Platform from your Google account's third-party access and connect again.");
  let email: string | null = null;
  if (t.id_token) {
    try {
      email = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()).email ?? null;
    } catch {}
  }
  await db().from("google_auth").upsert({ id: 1, email, refresh_token: t.refresh_token, scopes: t.scope ?? null, connected_at: new Date().toISOString() });
  cached = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
  return email;
}

export async function googleAccount() {
  const { data } = await db().from("google_auth").select("email, scopes, connected_at").eq("id", 1).maybeSingle<{ email: string | null; scopes: string | null; connected_at: string }>();
  return data;
}

let cached: { token: string; until: number } | null = null;

async function accessToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const { data } = await db().from("google_auth").select("refresh_token").eq("id", 1).maybeSingle<{ refresh_token: string }>();
  if (!data) throw new GoogleNotConnected();
  const t = await tokenRequest({ refresh_token: data.refresh_token, grant_type: "refresh_token" });
  cached = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
  return t.access_token;
}

export class GoogleNotConnected extends Error {
  constructor() {
    super("Google isn't connected yet.");
  }
}

export async function gapi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${await accessToken()}`, ...(init?.body ? { "content-type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Google API ${res.status}: ${json.error?.message ?? url}`);
  return json;
}

const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });

// ---------- Search Console ----------

export async function listSearchConsoleSites() {
  const r = await gapi<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>("https://www.googleapis.com/webmasters/v3/sites");
  return (r.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl);
}

export type SearchRow = { query: string; clicks: number; impressions: number; position: number };

export async function searchQueries(property: string, from: Date, to: Date): Promise<SearchRow[]> {
  const r = await gapi<{ rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    { method: "POST", body: { startDate: ymd(from), endDate: ymd(to), dimensions: ["query"], rowLimit: 500, dataState: "all" } },
  );
  return (r.rows ?? []).map((row) => ({ query: row.keys[0], clicks: row.clicks, impressions: row.impressions, position: row.position }));
}

// ---------- Business Profile ----------

export type GbpLocation = { name: string; title: string; address: string };

export async function listBusinessLocations(): Promise<GbpLocation[]> {
  const accounts = await gapi<{ accounts?: { name: string }[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20");
  const out: GbpLocation[] = [];
  for (const a of accounts.accounts ?? []) {
    let pageToken = "";
    do {
      const r = await gapi<{ locations?: { name: string; title: string; storefrontAddress?: { addressLines?: string[]; locality?: string; postalCode?: string } }[]; nextPageToken?: string }>(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storefrontAddress&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`,
      );
      for (const l of r.locations ?? []) {
        const ad = l.storefrontAddress;
        out.push({ name: l.name, title: l.title, address: [ad?.addressLines?.[0], ad?.locality, ad?.postalCode].filter(Boolean).join(", ") || "Service area business" });
      }
      pageToken = r.nextPageToken ?? "";
    } while (pageToken);
  }
  return out;
}

export const GBP_METRICS = {
  CALL_CLICKS: "calls",
  BUSINESS_DIRECTION_REQUESTS: "directions",
  WEBSITE_CLICKS: "websiteClicks",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "views",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "views",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "views",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "views",
} as const;

export type GbpDaily = { day: string; calls: number; directions: number; websiteClicks: number; views: number };

export async function businessMetrics(location: string, from: Date, to: Date): Promise<GbpDaily[]> {
  const [fy, fm, fd] = ymd(from).split("-").map(Number);
  const [ty, tm, td] = ymd(to).split("-").map(Number);
  const q = new URLSearchParams();
  for (const m of Object.keys(GBP_METRICS)) q.append("dailyMetrics", m);
  Object.entries({ "dailyRange.startDate.year": fy, "dailyRange.startDate.month": fm, "dailyRange.startDate.day": fd, "dailyRange.endDate.year": ty, "dailyRange.endDate.month": tm, "dailyRange.endDate.day": td }).forEach(([k, v]) => q.append(k, String(v)));
  type Series = { dailyMetric: keyof typeof GBP_METRICS; timeSeries?: { datedValues?: { date: { year: number; month: number; day: number }; value?: string }[] } };
  const r = await gapi<{ multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: Series[] }[] }>(
    `https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries?${q}`,
  );
  const days = new Map<string, GbpDaily>();
  for (const group of r.multiDailyMetricTimeSeries ?? []) {
    for (const s of group.dailyMetricTimeSeries ?? []) {
      const field = GBP_METRICS[s.dailyMetric];
      for (const v of s.timeSeries?.datedValues ?? []) {
        const day = `${v.date.year}-${String(v.date.month).padStart(2, "0")}-${String(v.date.day).padStart(2, "0")}`;
        const row = days.get(day) ?? { day, calls: 0, directions: 0, websiteClicks: 0, views: 0 };
        if (field) row[field] += Number(v.value ?? 0);
        days.set(day, row);
      }
    }
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
