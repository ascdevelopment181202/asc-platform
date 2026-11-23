import type { Measured } from "./types";

/** Did a change work, judged against how the rest of the site moved over the same days? */
export function verdict(before: number, after: number, controlBefore: number, controlAfter: number): Measured["verdict"] {
  if (before + after < 10) return "too early";
  const drift = controlBefore >= 10 ? Math.min(3, Math.max(0.33, controlAfter / controlBefore)) : 1;
  const expected = before * drift;
  const margin = Math.max(2, expected * 0.15);
  if (after >= expected + margin) return "worked";
  if (after <= expected - margin) return "worse";
  return "no change";
}
