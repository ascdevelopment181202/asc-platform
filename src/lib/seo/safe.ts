import type { SeoAction } from "./types";

/** What "Approve all safe" will take: written, low risk, undoable, no gaps left for a person, and a clean visual check where there is one. */
export function isSafe(a: SeoAction): boolean {
  const d = a.draft;
  if (!d || d.needsAi || d.target === "manual" || d.target === "email") return false;
  if (a.detail.alert || a.detail.risk !== "Low" || a.detail.confidence === "Low") return false;
  if (d.note && /\[ADD:|Missing facts|isn't confirmed/.test(d.note)) return false;
  if (/\[ADD:/.test(`${d.html ?? ""}${(d.fields ?? []).map((x) => x.after).join(" ")}`)) return false;
  if (["new_page", "cost_guide", "comparison", "blog", "holiday_hours", "weather_post"].includes(a.kind)) return false;
  if (a.apply?.visual && !a.apply.visual.ok) return false;
  return true;
}
