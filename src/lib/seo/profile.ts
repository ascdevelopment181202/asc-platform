import "server-only";
import { db, type Client } from "@/lib/supabase";
import type { GoogleReview } from "@/lib/google-reviews";
import type { ActionDetail, CompetitorCheck, Draft, Finding, GbpProfile, SeoConfig } from "./types";
import { canWrite, getLocation, listPosts, summarise, v4Path, weeklyProfile, withUtm, type GbpWeek, type RawLocation } from "./gbp";
import { valueOf } from "./value";
import { saveConfig } from "./store";

const DAY = 86_400_000;

function item(cfg: SeoConfig, kind: string, type: "Profile" | "Reviews", dedupe: string, summary: string, why: string, gain: { calls?: number; clicks?: number }, o: Partial<Pick<ActionDetail, "confidence" | "effort" | "risk" | "autoOk" | "alert">> & { draft?: Draft; numbers?: { label: string; value: string }[]; competitor?: string; assume?: string; mapsUri?: string } = {}): Finding {
  const v = valueOf(gain, cfg, o.assume ? [{ label: o.assume, value: "estimate", assumed: true }] : undefined);
  return {
    kind,
    type,
    dedupe,
    summary,
    detail: { evidence: { why, numbers: o.numbers, competitor: o.competitor }, gain: { ...gain, gbp: Math.round(v.gbp) }, chain: v.chain, confidence: o.confidence ?? "Medium", effort: o.effort ?? "1 click", risk: o.risk ?? "Low", undoable: true, autoOk: o.autoOk, alert: o.alert, links: o.mapsUri ? [{ label: "Business Profile", url: o.mapsUri }] : undefined },
    draft: o.draft,
  };
}

export type ProfileRead = { findings: Finding[]; profile: GbpProfile | null; write: boolean; error?: string; weeks: GbpWeek[]; raw?: RawLocation };

/** Reads the Business Profile and says what's missing. Nothing is changed here. */
export async function readProfile(clientId: string, cfg: SeoConfig, competitors: CompetitorCheck[]): Promise<ProfileRead> {
  if (!cfg.gbpLocation) return { findings: [], profile: null, write: false, weeks: [], error: "No Business Profile picked yet." };
  let raw: RawLocation;
  try {
    raw = await getLocation(cfg.gbpLocation);
  } catch (err) {
    return { findings: [], profile: null, write: false, weeks: [], error: err instanceof Error ? err.message : String(err) };
  }
  const write = await canWrite(cfg.gbpLocation, raw);
  let lastPostAt: string | null = null;
  try {
    const path = await v4Path(cfg.gbpLocation, cfg.gbpAccount);
    if (path) {
      if (!cfg.gbpAccount) await saveConfig(clientId, { gbpAccount: path.split("/locations/")[0] });
      lastPostAt = (await listPosts(path))[0]?.createTime ?? null;
    }
  } catch {}
  const profile = summarise(raw, lastPostAt);
  if (raw.latlng && !cfg.lat) await saveConfig(clientId, { lat: raw.latlng.latitude, lng: raw.latlng.longitude });
  const weeks = await weeklyProfile(cfg.gbpLocation).catch(() => [] as GbpWeek[]);
  const recent = weeks.slice(-4).reduce((n, w) => n + w.calls, 0); // calls in the last 4 weeks
  const calls = Math.max(recent, 4);
  const mapsUri = raw.metadata?.mapsUri;
  const guided = (steps: string[], minutes = 5): Draft => ({ target: "manual", minutes, steps: [{ text: "Open the Business Profile.", url: "https://business.google.com/locations" }, ...steps.map((text) => ({ text })), { text: "Press Mark done. The autopilot re-checks the profile on its next run." }] });
  const f: Finding[] = [];

  const desc = profile.description ?? "";
  if (desc.length < 250) {
    f.push(item(cfg, "gbp_description", "Profile", "gbp_description", desc ? "Rewrite the Business Profile description: it's too short to say what the business does and where." : "Write a Business Profile description: there isn't one.", `The description is ${desc.length} characters. Google allows 750, and it's read by customers and by Google's AI answers. A full one names the services and towns in plain words.`, { calls: calls * 0.03 }, { draft: { target: "profile", needsAi: true, fields: [{ name: "description", label: "Description", before: desc, after: "" }] }, assume: "About 3% more calls from a complete profile", mapsUri }));
  }
  if (profile.website && withUtm(profile.website) !== profile.website) {
    f.push(item(cfg, "gbp_utm", "Profile", "gbp_utm", "Tag the website link on the Business Profile so its visitors are counted separately.", "Visits from the Business Profile currently look the same as any other Google visit. A tracking tag on the link shows exactly how many people come from the profile, without changing what customers see.", {}, { confidence: "High", draft: { target: "profile", fields: [{ name: "websiteUri", label: "Website link", before: profile.website, after: withUtm(profile.website) }] }, mapsUri }));
  }
  if (!profile.hasHours) f.push(item(cfg, "gbp_hours", "Profile", "gbp_hours", "Add opening hours to the Business Profile.", "The profile has no opening hours. Google favours businesses that are open when someone searches, and profiles without hours look closed. Only list hours the phone is actually answered.", { calls: calls * 0.1 }, { confidence: "High", effort: "5 min manual", draft: guided(["Edit profile, then Hours.", "Enter the hours the phone is really answered, then Save."]), assume: "About 10% more calls when hours are shown", mapsUri }));
  if ((profile.categories ?? []).length < 2) {
    const theirs = [...new Set(competitors.flatMap((c) => c.top.filter((t) => !t.isClient).map((t) => t.category ?? "")).filter((c) => c && c !== profile.primaryCategory))].slice(0, 5);
    f.push(item(cfg, "gbp_categories", "Profile", "gbp_categories", "Add secondary categories to the Business Profile.", `The profile lists ${profile.primaryCategory ?? "one category"} and ${(profile.categories ?? []).length} others. Categories decide which searches the profile can show for.${theirs.length ? ` Competitors in the top results use: ${theirs.join(", ")}.` : ""} Only add ones that are true for this business.`, { calls: calls * 0.08 }, { effort: "5 min manual", draft: guided(["Edit profile, then Business category.", `Add each category that truly applies${theirs.length ? ` (candidates: ${theirs.join(", ")})` : ""}. Leave the primary category alone.`, "Save."]), competitor: theirs.length ? `Top competitors' categories: ${theirs.join(", ")}` : undefined, assume: "About 8% more calls from showing for more searches", mapsUri }));
  }
  if (!profile.services) f.push(item(cfg, "gbp_services", "Profile", "gbp_services", "List the services on the Business Profile.", `No services are listed on the profile. The fact sheet has ${(cfg.services ?? []).length}: ${(cfg.services ?? []).slice(0, 6).join(", ")}.`, { calls: calls * 0.05 }, { effort: "5 min manual", draft: { target: "manual", minutes: 5, steps: [{ text: "Open the Business Profile.", url: "https://business.google.com/locations" }, { text: "Edit services, then add each of these:", copy: (cfg.services ?? []).join("\n") }, { text: "Save, then press Mark done." }] }, assume: "About 5% more calls", mapsUri }));
  const areas = profile.serviceAreas ?? [];
  const missingTowns = (cfg.towns ?? []).filter((t) => !areas.some((a) => a.toLowerCase().includes(t.toLowerCase()))).slice(0, 20 - areas.length);
  if (areas.length < 20 && missingTowns.length >= 2) f.push(item(cfg, "gbp_service_area", "Profile", "gbp_service_area", `Add ${missingTowns.length} towns to the Business Profile's service area.`, `The profile's service area lists ${areas.length} places; Google allows 20. Towns from the plan that are missing: ${missingTowns.join(", ")}.`, { calls: calls * 0.04 }, { effort: "5 min manual", draft: { target: "manual", minutes: 4, steps: [{ text: "Open the Business Profile.", url: "https://business.google.com/locations" }, { text: "Edit profile, Location, then Service area. Add:", copy: missingTowns.join("\n") }, { text: "Save, then press Mark done." }] }, assume: "About 4% more calls from nearby towns", mapsUri }));
  if (!lastPostAt || Date.now() - Date.parse(lastPostAt) > 7 * DAY) {
    f.push(item(cfg, "gbp_post", "Profile", `gbp_post:${new Date().toISOString().slice(0, 10).slice(0, 8)}w${Math.ceil(new Date().getUTCDate() / 7)}`, "Publish this week's Business Profile post.", lastPostAt ? `The last post was ${Math.round((Date.now() - Date.parse(lastPostAt)) / DAY)} days ago. A weekly post shows Google and customers the business is active.` : "The profile has no recent posts. A weekly post shows Google and customers the business is active.", { calls: calls * 0.02 }, { autoOk: true, draft: { target: "profile", needsAi: true }, assume: "About 2% more calls from an active profile", mapsUri }));
  }

  // Calls well below their usual level.
  if (weeks.length >= 9) {
    const last = weeks[weeks.length - 2]; // the latest full week
    const before = weeks.slice(-10, -2);
    const usual = before.reduce((n, w) => n + w.calls, 0) / before.length;
    if (usual >= 3 && last.calls <= usual * 0.5) f.push(item(cfg, "gbp_calls_drop", "Profile", "gbp_calls_drop", `Calls from the Business Profile halved last week: ${last.calls} against a usual ${usual.toFixed(1)}.`, `The week of ${last.week} had ${last.calls} calls from the profile. The 8 weeks before averaged ${usual.toFixed(1)}. Check the profile is still live, the hours are right and a competitor hasn't moved ahead on Maps.`, { calls: (usual - last.calls) * 4 }, { confidence: "Medium", effort: "5 min manual", mapsUri }));
  }
  return { findings: f, profile, write: write.ok, error: write.ok ? undefined : write.error, weeks, raw };
}

type ReviewRow = Pick<GoogleReview, "id" | "rating" | "comment" | "reviewer_name" | "created_at" | "reply" | "auto_reply_at">;

/** Reviews waiting for a reply, and the pace needed to catch the competitors. Read-only on the review tables. */
export async function reviewFindings(c: Client, cfg: SeoConfig, competitors: CompetitorCheck[]): Promise<{ findings: Finding[]; pace: ReviewPace }> {
  const { data } = await db().from("google_reviews").select("id, rating, comment, reviewer_name, created_at, reply, auto_reply_at").eq("client_id", c.id).order("created_at", { ascending: false }).limit(200).returns<ReviewRow[]>();
  const reviews = data ?? [];
  const f: Finding[] = [];
  for (const r of reviews.filter((r) => !r.reply && !r.auto_reply_at && Date.now() - Date.parse(r.created_at) < 60 * DAY).slice(0, 8)) {
    const bad = (r.rating ?? 5) <= 3;
    f.push(item(cfg, "review_reply", "Reviews", `review_reply:${r.id}`, `Reply to ${r.reviewer_name ?? "a customer"}'s ${r.rating ?? "?"}-star Google review.`, `${bad ? "A lower rating needs a calm, professional reply: future customers read how the business responds." : "Replying to reviews shows customers and Google the business is active."} Review: "${(r.comment ?? "(no comment)").slice(0, 240)}"`, { calls: bad ? 0.5 : 0.2 }, { confidence: "High", risk: bad ? "Medium" : "Low", draft: { target: "review", needsAi: true, fields: [{ name: "reply", label: "Reply", before: "", after: "" }], note: r.id }, assume: "Replies lift trust with the next reader" }));
  }
  const pace = reviewPace(c, reviews, competitors);
  if (pace.leader && pace.gap > 15) {
    f.push(item(cfg, "review_pace", "Reviews", "review_pace", `Ask for ${pace.perWeek} reviews a week to catch ${pace.leader.name}.`, pace.text, { calls: 2 }, { effort: "5 min manual", confidence: "Medium", competitor: `${pace.leader.name}: ${pace.leader.reviews} reviews at ${pace.leader.rating ?? "?"} stars. ${c.business_name ?? "This client"}: ${pace.ours}.`, draft: { target: "manual", minutes: 5, steps: [{ text: `Tell ${c.first_name ?? "the client"} the target: ${pace.perWeek} review requests a week, sent from the app after each finished job.` }, { text: "Check review requests are switched on for them in the client page." }, { text: "Press Mark done. The pace is tracked on the Business Profile tab." }] }, assume: "Review count is about a fifth of map ranking" }));
  }
  return { findings: f, pace };
}

export type ReviewPace = { ours: number; last90: number; leader: { name: string; reviews: number; rating?: number } | null; gap: number; perWeek: number; text: string };

export function reviewPace(c: Pick<Client, "google_review_count" | "business_name">, reviews: { created_at: string }[], competitors: CompetitorCheck[]): ReviewPace {
  const ours = c.google_review_count ?? reviews.length;
  const last90 = reviews.filter((r) => Date.now() - Date.parse(r.created_at) < 90 * DAY).length;
  const rivals = competitors.flatMap((k) => k.top.filter((t) => !t.isClient && t.reviews)).sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
  const top3 = [...new Map(rivals.map((r) => [r.placeId, r])).values()].slice(0, 3);
  const leader = top3[0] ? { name: top3[0].name, reviews: top3[0].reviews ?? 0, rating: top3[0].rating } : null;
  const gap = leader ? leader.reviews - ours : 0;
  const perWeek = Math.max(1, Math.min(5, Math.ceil(gap / 26)));
  const weeks = gap > 0 ? Math.ceil(gap / perWeek) : 0;
  const by = new Date(Date.now() + weeks * 7 * DAY).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const text = !leader ? "No competitor data yet. Add the Google API key and the weekly check fills this in." : gap <= 0 ? `Ahead of every competitor found: ${ours} reviews against ${leader.name}'s ${leader.reviews}. Keep the current pace of ${(last90 / 13).toFixed(1)} a week.` : `${ours} reviews against ${leader.name}'s ${leader.reviews}. ${perWeek} new reviews a week draws level by ${by}. The current pace is ${(last90 / 13).toFixed(1)} a week.`;
  return { ours, last90, leader, gap, perWeek, text };
}
