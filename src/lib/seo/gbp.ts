import "server-only";
import { businessMetrics, gapi } from "@/lib/google";
import type { GbpProfile, WeekPoint } from "./types";
import { mondayOf } from "./store";

const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";
const DAY = 86_400_000;

type Category = { name?: string; displayName?: string };
export type RawLocation = {
  name: string;
  title?: string;
  categories?: { primaryCategory?: Category; additionalCategories?: Category[] };
  profile?: { description?: string };
  regularHours?: { periods?: unknown[] };
  specialHours?: { specialHourPeriods?: unknown[] };
  serviceArea?: { places?: { placeInfos?: { placeName?: string; placeId?: string }[] } };
  serviceItems?: unknown[];
  websiteUri?: string;
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] };
  metadata?: { mapsUri?: string; newReviewUri?: string; placeId?: string; hasPendingEdits?: boolean };
  latlng?: { latitude: number; longitude: number };
};

const MASK = "name,title,categories,profile,regularHours,specialHours,serviceArea,serviceItems,websiteUri,phoneNumbers,metadata,latlng";

export const getLocation = (location: string) => gapi<RawLocation>(`${INFO}/${location}?readMask=${MASK}`);

export function summarise(l: RawLocation, lastPostAt?: string | null): GbpProfile {
  return {
    title: l.title,
    primaryCategory: l.categories?.primaryCategory?.displayName,
    categories: (l.categories?.additionalCategories ?? []).map((c) => c.displayName ?? "").filter(Boolean),
    description: l.profile?.description,
    hasHours: !!l.regularHours?.periods?.length,
    services: l.serviceItems?.length ?? 0,
    website: l.websiteUri,
    phone: l.phoneNumbers?.primaryPhone,
    serviceAreas: (l.serviceArea?.places?.placeInfos ?? []).map((p) => p.placeName ?? "").filter(Boolean),
    lastPostAt,
  };
}

/** Changes fields on the profile. `mask` names exactly what changes, e.g. "profile.description". */
export const patchLocation = (location: string, mask: string, body: Partial<RawLocation>, validateOnly = false) =>
  gapi<RawLocation>(`${INFO}/${location}?updateMask=${encodeURIComponent(mask)}${validateOnly ? "&validateOnly=true" : ""}`, { method: "PATCH", body });

/** Can we edit this profile? Sends the current description back with validateOnly, so nothing changes. */
export async function canWrite(location: string, l: RawLocation): Promise<{ ok: boolean; error?: string }> {
  try {
    await patchLocation(location, "profile.description", { profile: { description: l.profile?.description ?? "" } }, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Posts and photos still live on the older v4 API, which needs "accounts/9/locations/123". */
export async function v4Path(location: string, knownAccount?: string): Promise<string | null> {
  if (knownAccount) return `${knownAccount}/${location}`;
  const accounts = await gapi<{ accounts?: { name: string }[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20");
  for (const a of accounts.accounts ?? []) {
    try {
      const r = await gapi<{ locations?: { name: string }[] }>(`${INFO}/${a.name}/locations?readMask=name&pageSize=100`);
      if ((r.locations ?? []).some((l) => l.name === location)) return `${a.name}/${location}`;
    } catch {}
  }
  return null;
}

export type LocalPost = { name?: string; summary?: string; createTime?: string; searchUrl?: string; state?: string };

export async function listPosts(path: string): Promise<LocalPost[]> {
  const r = await gapi<{ localPosts?: LocalPost[] }>(`${V4}/${path}/localPosts?pageSize=10`);
  return r.localPosts ?? [];
}

export const createPost = (path: string, p: { summary: string; url?: string; photoUrl?: string }) =>
  gapi<LocalPost>(`${V4}/${path}/localPosts`, {
    method: "POST",
    body: { languageCode: "en-GB", topicType: "STANDARD", summary: p.summary.slice(0, 1500), ...(p.url ? { callToAction: { actionType: "LEARN_MORE", url: p.url } } : {}), ...(p.photoUrl ? { media: [{ mediaFormat: "PHOTO", sourceUrl: p.photoUrl }] } : {}) },
  });

export const deletePost = (name: string) => gapi(`${V4}/${name}`, { method: "DELETE" });

export const addPhoto = (path: string, sourceUrl: string, category = "ADDITIONAL") => gapi(`${V4}/${path}/media`, { method: "POST", body: { mediaFormat: "PHOTO", locationAssociation: { category }, sourceUrl } });

/** The words people typed to find the profile, by month. Google only reports these monthly. */
export async function searchKeywords(location: string, now = new Date()): Promise<{ keyword: string; impressions: number }[]> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
  const q = new URLSearchParams({ "monthlyRange.startMonth.year": String(start.getUTCFullYear()), "monthlyRange.startMonth.month": String(start.getUTCMonth() + 1), "monthlyRange.endMonth.year": String(end.getUTCFullYear()), "monthlyRange.endMonth.month": String(end.getUTCMonth() + 1), pageSize: "100" });
  const r = await gapi<{ searchKeywordsCounts?: { searchKeyword: string; insightsValue?: { value?: string; threshold?: string } }[] }>(`https://businessprofileperformance.googleapis.com/v1/${location}/searchkeywords/impressions/monthly?${q}`);
  return (r.searchKeywordsCounts ?? []).map((k) => ({ keyword: k.searchKeyword, impressions: Number(k.insightsValue?.value ?? k.insightsValue?.threshold ?? 0) })).sort((a, b) => b.impressions - a.impressions);
}

export type GbpWeek = Pick<WeekPoint, "week"> & { calls: number; directions: number; websiteClicks: number; views: number };

export async function weeklyProfile(location: string, weeks = 16): Promise<GbpWeek[]> {
  const daily = await businessMetrics(location, new Date(Date.now() - weeks * 7 * DAY), new Date(Date.now() - 2 * DAY));
  const out = new Map<string, GbpWeek>();
  for (const d of daily) {
    const week = mondayOf(d.day);
    const w = out.get(week) ?? { week, calls: 0, directions: 0, websiteClicks: 0, views: 0 };
    w.calls += d.calls;
    w.directions += d.directions;
    w.websiteClicks += d.websiteClicks;
    w.views += d.views;
    out.set(week, w);
  }
  return [...out.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-weeks);
}

export const withUtm = (url: string) => {
  try {
    const u = new URL(url);
    if (u.searchParams.get("utm_campaign") === "gbp") return url;
    u.searchParams.set("utm_source", "google");
    u.searchParams.set("utm_medium", "organic");
    u.searchParams.set("utm_campaign", "gbp");
    return u.toString();
  } catch {
    return url;
  }
};
