import "server-only";
import { gapi } from "@/lib/google";
import { db } from "@/lib/supabase";
import type { Finding, Measured, SeoAction, SeoConfig } from "./types";
import type { GbpWeek } from "./gbp";
import { LAG_DAYS } from "./gsc";
import { updateAction, weeklyMetrics, ymd } from "./store";
import { valueOf } from "./value";
import { verdict } from "./verdict";

const DAY = 86_400_000;

async function clicks(property: string, from: Date, to: Date, page?: string): Promise<number> {
  const r = await gapi<{ rows?: { clicks: number }[] }>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", body: { startDate: ymd(from), endDate: ymd(to), ...(page ? { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: page }] }] } : {}) } });
  return r.rows?.[0]?.clicks ?? 0;
}

/**
 * 28 days after a change went live: compare the page (or the profile's calls) with the 28 days before,
 * using the rest of the site as the control. Title changes that made things worse raise a "revert" item.
 */
export async function measureDue(clientId: string, cfg: SeoConfig): Promise<{ measured: number; findings: Finding[] }> {
  const due = new Date(Date.now() - LAG_DAYS * DAY).toISOString();
  const { data } = await db().from("seo_actions").select("*").eq("client_id", clientId).eq("status", "applied").is("result", null).not("measure_at", "is", null).lte("measure_at", due).limit(10).returns<SeoAction[]>();
  const findings: Finding[] = [];
  let measured = 0;
  for (const a of data ?? []) {
    const applied = new Date(a.applied_at ?? a.updated_at);
    const b0 = new Date(applied.getTime() - 28 * DAY);
    const a1 = new Date(applied.getTime() + 28 * DAY);
    let result: Measured | null = null;
    const page = a.draft?.page && a.draft.page !== "*" ? a.draft.page : a.detail.evidence.page;
    try {
      if (a.type === "Profile" || a.type === "Reviews") {
        const weeks = await weeklyMetrics<GbpWeek>(clientId, "gbp", 16);
        const sum = (from: Date, to: Date) => weeks.filter((w) => w.week >= ymd(from) && w.week < ymd(to)).reduce((n, w) => n + w.data.calls, 0);
        const before = sum(b0, applied);
        const after = sum(applied, a1);
        const v = verdict(before, after, 0, 0);
        result = { at: new Date().toISOString(), verdict: v, before, after, text: v === "too early" ? "Too few calls to judge yet." : `Calls from the profile: ${before} in the 4 weeks before, ${after} in the 4 weeks after. No control is available for profile changes, so read this with the season in mind.` };
      } else if (cfg.gscProperty && page && cfg.domain) {
        const isNew = ["new_page", "cost_guide", "comparison", "blog"].includes(a.kind);
        const [before, after, allBefore, allAfter] = await Promise.all([isNew ? Promise.resolve(0) : clicks(cfg.gscProperty, b0, applied, page), clicks(cfg.gscProperty, applied, a1, page), clicks(cfg.gscProperty, b0, applied), clicks(cfg.gscProperty, applied, a1)]);
        const v = isNew ? (after >= 3 ? "worked" : after === 0 ? "no change" : "too early") : verdict(before, after, allBefore - before, allAfter - after);
        const control = allBefore - before >= 10 ? Math.round(((allAfter - after) / (allBefore - before) - 1) * 100) : undefined;
        result = { at: new Date().toISOString(), verdict: v, before, after, control, text: isNew ? `The new page got ${after} clicks in its first 28 days.` : `This page: ${before} clicks in the 28 days before, ${after} in the 28 days after.${control !== undefined ? ` The rest of the site moved ${control >= 0 ? "+" : ""}${control}% over the same days, which is the control.` : ""}` };
        if (v === "worse" && ["title_rewrite", "meta_fix"].includes(a.kind)) {
          const val = valueOf({ clicks: before - after }, cfg);
          findings.push({ kind: "revert_suggest", type: "Page", dedupe: `revert:${a.id}`, summary: `The new title on ${page} did worse: put the old one back.`, detail: { evidence: { why: result.text, page }, gain: { clicks: before - after, gbp: Math.round(val.gbp) }, chain: val.chain, confidence: "Medium", effort: "1 click", risk: "Low", undoable: true }, draft: { target: "manual", minutes: 1, steps: [{ text: "Open the Changes tab for this client and press Undo on that change." }, { text: "Press Mark done." }] } });
        }
      } else result = { at: new Date().toISOString(), verdict: "no change", text: "This change can't be measured directly (no page or no Search Console)." };
    } catch (err) {
      result = null;
      console.error("SEO measure failed", a.id, err instanceof Error ? err.message : err);
    }
    if (!result) continue;
    // "Too early" gets one more 28-day window before it's recorded as inconclusive.
    if (result.verdict === "too early" && Date.now() - applied.getTime() < 50 * DAY) await updateAction(a.id, { measure_at: new Date(applied.getTime() + 56 * DAY).toISOString() });
    else await updateAction(a.id, { result });
    measured++;
  }
  return { measured, findings };
}
