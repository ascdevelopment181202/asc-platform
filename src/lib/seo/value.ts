// Turning "more clicks" into pounds, and ranking the inbox. Pure functions.
import type { ActionDetail, ActionType, ChainStep, Confidence, Effort, SeoConfig } from "./types";

/** Typical share of searchers who click a result at each position. Estimates for local service searches. */
const CTR = [0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];

export function expectedCtr(position: number): number {
  const p = Math.max(1, position);
  if (p <= 10) {
    const lo = Math.floor(p);
    const hi = Math.min(10, lo + 1);
    return CTR[lo] + (CTR[hi] - CTR[lo]) * (p - lo);
  }
  if (p <= 15) return 0.01;
  if (p <= 20) return 0.005;
  return 0.002;
}

/** Average job value by trade, used only until the client's real figure is on the fact sheet. */
export const TRADE_DEFAULTS: Record<string, { jobValue: number; label: string }> = {
  driveways: { jobValue: 4500, label: "driveway and paving firms" },
  paving: { jobValue: 4500, label: "driveway and paving firms" },
  landscaping: { jobValue: 3000, label: "landscapers" },
  roofing: { jobValue: 1800, label: "roofers" },
  plumbing: { jobValue: 250, label: "plumbers" },
  heating: { jobValue: 900, label: "heating engineers" },
  electrical: { jobValue: 300, label: "electricians" },
  hvac: { jobValue: 700, label: "HVAC firms" },
  fencing: { jobValue: 1200, label: "fencing firms" },
  building: { jobValue: 5000, label: "builders" },
  cleaning: { jobValue: 150, label: "cleaning firms" },
};
const FALLBACK = { jobValue: 600, label: "trades businesses" };
export const DEFAULT_ENQUIRY_RATE = 0.05;
export const DEFAULT_CLOSE_RATE = 0.33;

export function tradeKey(trade?: string): string {
  const t = (trade ?? "").toLowerCase();
  if (/drive|pav|tarmac|resin/.test(t)) return "driveways";
  if (/landscap|garden|patio/.test(t)) return "landscaping";
  if (/roof|gutter/.test(t)) return "roofing";
  if (/plumb|drain/.test(t)) return "plumbing";
  if (/boiler|heat|gas/.test(t)) return "heating";
  if (/electric/.test(t)) return "electrical";
  if (/hvac|air con|cooling/.test(t)) return "hvac";
  if (/fenc/.test(t)) return "fencing";
  if (/build|extension|construct/.test(t)) return "building";
  if (/clean/.test(t)) return "cleaning";
  return t || "general";
}

export const money = (n: number, country?: "GB" | "US") => `${country === "US" ? "$" : "£"}${Math.round(n).toLocaleString("en-GB")}`;
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

export type Value = { gbp: number; enquiries: number; chain: ChainStep[] };

/** The chain from extra clicks (or calls) to money, with every assumption labelled. */
export function valueOf(gain: { clicks?: number; calls?: number }, cfg: SeoConfig, lead?: ChainStep[]): Value {
  const def = TRADE_DEFAULTS[tradeKey(cfg.trade)] ?? FALLBACK;
  const jobValue = cfg.jobValueGbp && cfg.jobValueGbp > 0 ? cfg.jobValueGbp : def.jobValue;
  const jobAssumed = !(cfg.jobValueGbp && cfg.jobValueGbp > 0);
  const rate = cfg.enquiryRate && cfg.enquiryRate > 0 ? cfg.enquiryRate : DEFAULT_ENQUIRY_RATE;
  const rateAssumed = !(cfg.enquiryRate && cfg.enquiryRate > 0);
  const chain: ChainStep[] = [...(lead ?? [])];
  let enquiries = 0;
  if (gain.clicks) {
    const clicks = Math.round(gain.clicks);
    chain.push({ label: "Extra clicks a month", value: `+${clicks}` });
    enquiries += gain.clicks * rate;
    chain.push({ label: rateAssumed ? "Enquiry rate (typical, not this site's yet)" : "This site's enquiry rate", value: `${pct(rate)} ≈ ${(gain.clicks * rate).toFixed(1)} enquiries`, assumed: rateAssumed });
  }
  if (gain.calls) {
    enquiries += gain.calls;
    chain.push({ label: "Extra calls a month", value: `+${gain.calls.toFixed(gain.calls < 10 ? 1 : 0)}` });
  }
  // Not every enquiry becomes a job. One in three is a fair starting point for trades until the client's own rate is set.
  const close = cfg.closeRate && cfg.closeRate > 0 ? Math.min(1, cfg.closeRate) : DEFAULT_CLOSE_RATE;
  const closeAssumed = !(cfg.closeRate && cfg.closeRate > 0);
  const jobs = enquiries * close;
  chain.push({ label: closeAssumed ? "Enquiries that become jobs (typical)" : "Enquiries that become jobs (this client)", value: `${pct(close)} ≈ ${jobs.toFixed(1)} jobs`, assumed: closeAssumed });
  const total = jobs * jobValue;
  chain.push({
    label: jobAssumed ? `Average job (typical for ${def.label})` : "Average job (from the fact sheet)",
    value: `${money(jobValue, cfg.country)} ≈ ${money(total, cfg.country)} a month`,
    assumed: jobAssumed,
  });
  return { gbp: total, enquiries, chain };
}

const CONF: Record<Confidence, number> = { High: 0.9, Medium: 0.6, Low: 0.3 };
const EFFORT: Record<Effort, number> = { "1 click": 1, "5 min manual": 2, "30 min manual": 4 };
/** Business Profile and reviews move local rankings most, then page fixes, then content. */
export const TYPE_WEIGHT: Record<ActionType, number> = { Profile: 1.5, Reviews: 1.5, Technical: 1.3, Page: 1, "AI search": 1, Content: 0.7, Manual: 0.8 };

/** Score = pounds x confidence / effort, weighted by type. Alerts always sort first. */
export function scoreOf(type: ActionType, d: Pick<ActionDetail, "gain" | "confidence" | "effort" | "alert">, opts: { servesGoal?: boolean; penalty?: number } = {}): number {
  if (d.alert) return 1_000_000;
  const base = Math.max(d.gain.gbp ?? 0, 1);
  const s = (base * CONF[d.confidence] * TYPE_WEIGHT[type]) / EFFORT[d.effort];
  return Math.round(s * (opts.servesGoal === false ? 0.7 : 1) * (opts.penalty ?? 1) * 100) / 100;
}

export function gainLabel(d: Pick<ActionDetail, "gain">, country?: "GB" | "US"): string {
  const parts: string[] = [];
  if (d.gain.clicks && d.gain.clicks >= 1) parts.push(`+${Math.round(d.gain.clicks)} clicks a month`);
  if (d.gain.calls && d.gain.calls >= 0.5) parts.push(`+${d.gain.calls.toFixed(d.gain.calls < 10 ? 1 : 0)} calls a month`);
  if (d.gain.gbp && d.gain.gbp >= 1) parts.push(`about ${money(d.gain.gbp, country)} in jobs`);
  return parts.join(", ") || "Protects existing traffic";
}
