// Keeps texts cheap: Twilio bills per segment. A plain text fits 160 characters in one segment
// (153 per part when longer). One character outside the GSM alphabet (a curly apostrophe, an emoji,
// an accented letter) switches the whole text to 70 characters per segment, so it can cost 3 times as much.
// Safe to use in the browser too (campaign preview).

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€"; // these count as 2 characters
const BASIC = new Set(GSM_BASIC);
const EXTENDED = new Set(GSM_EXTENDED);

const SWAPS: [RegExp, string][] = [
  [/[‘’‚‛′´`]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[–—―−]/g, "-"],
  [/…/g, "..."],
  [/[       ]/g, " "],
  [/[​-‍⁠﻿‪-‮]/g, ""],
  [/•/g, "-"],
  [/[★⭐]/g, "*"],
];

/** Rewrites a text into the GSM alphabet: straight quotes, plain dashes, accents dropped, emoji removed. */
export function toGsm(text: string): string {
  let t = text;
  for (const [re, to] of SWAPS) t = t.replace(re, to);
  let out = "";
  for (const ch of t) {
    if (BASIC.has(ch) || EXTENDED.has(ch)) {
      out += ch;
      continue;
    }
    const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (plain.length === 1 && (BASIC.has(plain) || EXTENDED.has(plain))) out += plain;
    // anything else (emoji, symbols) is dropped
  }
  return out.replace(/ {2,}/g, " ").trim();
}

export function isGsm(text: string) {
  for (const ch of text) if (!BASIC.has(ch) && !EXTENDED.has(ch)) return false;
  return true;
}

/** Billing length: extended GSM characters count twice. */
export function gsmLength(text: string) {
  let n = 0;
  for (const ch of text) n += EXTENDED.has(ch) ? 2 : 1;
  return n;
}

/** How many segments Twilio will bill for this text. */
export function segmentsOf(text: string) {
  if (!text) return 0;
  if (isGsm(text)) {
    const n = gsmLength(text);
    return n <= 160 ? 1 : Math.ceil(n / 153);
  }
  const n = [...text].length;
  return n <= 70 ? 1 : Math.ceil(n / 67);
}

export const fitsOne = (text: string) => segmentsOf(toGsm(text)) === 1;

/** The first wording that fits one segment, else the shortest one. */
export function firstThatFits(candidates: string[]): string {
  const clean = candidates.map((t) => toGsm(t)).filter(Boolean);
  return clean.find((t) => segmentsOf(t) === 1) ?? clean.reduce((a, b) => (gsmLength(b) < gsmLength(a) ? b : a));
}

/** Cuts free text (a customer's message) to fit the room left, on a word boundary. */
export function clip(text: string, room: number) {
  const t = toGsm(text);
  if (gsmLength(t) <= room) return t;
  return `${t.slice(0, Math.max(0, room - 3)).replace(/\s+\S*$/, "")}...`;
}

/** Rough cost per segment, for previews: UK about 4.2p, US about 1.2 cents (Twilio list price plus carrier fee). */
export const SEGMENT_COST = { GB: { amount: 0.042, symbol: "£" }, US: { amount: 0.012, symbol: "$" } } as const;

export function costLabel(segments: number, country: "GB" | "US") {
  const c = SEGMENT_COST[country];
  const v = segments * c.amount;
  return v < 1 ? (country === "US" ? `${Math.max(1, Math.round(v * 100))}c` : `${Math.max(1, Math.round(v * 100))}p`) : `${c.symbol}${v.toFixed(2)}`;
}
