/**
 * UK phone helpers. Everything is stored in E.164 (+447700900123).
 * Texts only go to UK mobiles (+447...), which also filters out landlines,
 * withheld numbers and international callers.
 */

/** Turns "07700 900123", "+44 (0)7700-900123", "447700900123" into "+447700900123". Returns null if it can't. */
export function normalizeUk(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\(0\)/g, "").replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^0\d{9,10}$/.test(s)) s = `+44${s.slice(1)}`;
  else if (/^44\d{9,10}$/.test(s)) s = `+${s}`;
  if (!/^\+\d{8,15}$/.test(s)) return null;
  return s;
}

export function isUkMobile(e164: string | null | undefined): e164 is string {
  return !!e164 && /^\+447\d{9}$/.test(e164);
}

/** "+447700900123" -> "07700 900123" for showing to people. */
export function displayUk(e164: string | null | undefined): string {
  if (!e164) return "Unknown number";
  if (/^\+44\d{10}$/.test(e164)) {
    const n = `0${e164.slice(3)}`;
    return `${n.slice(0, 5)} ${n.slice(5)}`;
  }
  return e164;
}
