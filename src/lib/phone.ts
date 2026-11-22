/**
 * Phone helpers for UK and US clients. Everything is stored in E.164 (+447700900123, +12145550123).
 * Texts only go to numbers that can receive them in the client's country: UK mobiles (+447...)
 * or valid US numbers (US mobiles and landlines look the same, so a landline just fails to deliver).
 */

export type Country = "GB" | "US";

/** Turns what people type into E.164 for the given country. Numbers already starting with + are kept as they are. */
export function normalizePhone(raw: string | null | undefined, country: Country = "GB"): string | null {
  if (!raw) return null;
  // Numbers copied from contacts, WhatsApp or iMessage often carry invisible direction marks
  // (U+202A..U+202E, U+2066..U+2069, U+200E/F) and non-breaking spaces, so keep only digits and a leading +.
  const cleaned = raw.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  let s = cleaned.startsWith("+") ? `+${cleaned.slice(1).replace(/\+/g, "")}` : cleaned.replace(/\+/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) {
    if (country === "US") {
      if (/^1\d{10}$/.test(s)) s = `+${s}`;
      else if (/^\d{10}$/.test(s)) s = `+1${s}`;
    } else {
      if (/^0\d{9,10}$/.test(s)) s = `+44${s.slice(1)}`;
      else if (/^44\d{9,10}$/.test(s)) s = `+${s}`;
    }
  }
  if (!/^\+\d{8,15}$/.test(s)) return null;
  return s;
}

const US_TOLL_FREE = /^\+18(00|33|44|55|66|77|88)/;

/** Can we text this number for a client in this country? */
export function isTextable(e164: string | null | undefined, country: Country = "GB"): e164 is string {
  if (!e164) return false;
  if (country === "US") return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e164) && !US_TOLL_FREE.test(e164);
  return /^\+447\d{9}$/.test(e164);
}

export const countryCode = (country: Country) => (country === "US" ? "+1" : "+44");

/** "+447700900123" -> "07700 900123", "+12145550123" -> "(214) 555-0123". */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return "Unknown number";
  if (/^\+44\d{10}$/.test(e164)) {
    const n = `0${e164.slice(3)}`;
    return `${n.slice(0, 5)} ${n.slice(5)}`;
  }
  if (/^\+1\d{10}$/.test(e164)) return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  return e164;
}

// UK-only names kept for older call sites.
export const normalizeUk = (raw: string | null | undefined) => normalizePhone(raw, "GB");
export const isUkMobile = (e164: string | null | undefined): e164 is string => isTextable(e164, "GB");
export const displayUk = displayPhone;

/** Date and time formatting for the client's country (24h in the UK, 12h in the US). */
export const localeFor = (country: Country | string | null | undefined) => (country === "US" ? "en-US" : "en-GB");

export type ForwardingStep = { label: string; code: string };

/**
 * The codes a client dials once to forward missed calls to their business texting number.
 * UK networks all use the standard codes. US carriers differ: Verizon has its own, AT&T and T-Mobile use the standard ones.
 */
export function forwardingCodes(country: Country, twilioNumber: string, carrier?: string | null): { carrier: string; steps: ForwardingStep[]; off: string }[] {
  if (country === "US") {
    const ten = twilioNumber.replace(/^\+1/, "");
    const verizon = { carrier: "Verizon", steps: [{ label: "Missed or busy calls", code: `*71${ten}` }], off: "*73" };
    const gsm = {
      carrier: "AT&T or T-Mobile",
      steps: [
        { label: "Calls you don't answer", code: `**61*1${ten}#` },
        { label: "When your phone is off", code: `**62*1${ten}#` },
        { label: "When you're on another call", code: `**67*1${ten}#` },
      ],
      off: "##004#",
    };
    if (carrier === "Verizon") return [verizon];
    if (carrier === "AT&T" || carrier === "T-Mobile") return [gsm];
    return [verizon, gsm];
  }
  return [
    {
      carrier: "Any UK network",
      steps: [
        { label: "Calls you don't answer within 20 seconds", code: `**61*${twilioNumber}*11*20#` },
        { label: "When you're on another call", code: `**67*${twilioNumber}#` },
        { label: "When your phone is off or has no signal", code: `**62*${twilioNumber}#` },
      ],
      off: "##002#",
    },
  ];
}
