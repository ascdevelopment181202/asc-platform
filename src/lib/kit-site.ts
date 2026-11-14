// Maps generated SiteContent onto the asc-site-kit data format (window.SITE),
// so client homepages use the same design as the Which? outreach mockups.
import type { SiteContent } from "./site-content";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function rgbToHex(rgb: number[]) {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}
/** Mixes a colour towards black (amount < 0) or white (amount > 0). */
function shade(hex: string, amount: number) {
  const rgb = hexToRgb(hex);
  const target = amount < 0 ? 0 : 255;
  const a = Math.abs(amount);
  return rgbToHex(rgb.map((v) => v + (target - v) * a));
}

const SERVICE_ICON: [RegExp, string][] = [
  [/boiler|heating|radiator|power ?flush/i, "flame"],
  [/leak|burst|emergency/i, "siren"],
  [/bath|shower|wet ?room/i, "shower-head"],
  [/drain|block|toilet/i, "waves"],
  [/water|tap|pipe|plumb/i, "droplet"],
  [/rewir|wiring|consumer|fuse|electric/i, "cable"],
  [/light/i, "lightbulb"],
  [/ev|charger/i, "car"],
  [/socket|plug/i, "plug"],
  [/roof|gutter|chimney/i, "house"],
  [/air ?con|hvac|cooling|ventilat/i, "fan"],
  [/cylinder|tank/i, "cylinder"],
  [/thermostat|smart/i, "thermometer"],
  [/inspect|test|certif|safety|report/i, "clipboard-check"],
];

function iconFor(name: string) {
  return SERVICE_ICON.find(([re]) => re.test(name))?.[1] ?? "wrench";
}

export type KitSite = Record<string, unknown>;

export function toKitSite(c: SiteContent, opts: { siteId: string; base: string; preview: boolean }): KitSite {
  const photos = c.gallery;
  const pic = (i: number) => (photos.length ? photos[i % photos.length] : null);
  const firstSentence = (t: string) => (t.match(/^[^.!?]+[.!?]/)?.[0] ?? t).trim();

  const proof = [
    c.yearsTrading && /^\d+(\.\d+)?$/.test(c.yearsTrading)
      ? { v: c.yearsTrading, count: Number(c.yearsTrading), l: "years in business" }
      : null,
    c.accreditations[0] ? { v: c.accreditations[0], l: "accredited" } : null,
    c.emergency ? { v: "24/7", l: "emergency call-outs" } : { v: "Free", l: "no-obligation quotes" },
    c.areas.length > 1 ? { v: String(c.areas.length), count: c.areas.length, l: "towns covered" } : null,
  ].filter(Boolean);

  const extras: [string, string][] = [
    ...c.accreditations.slice(0, 2).map((a): [string, string] => ["shield-check", /gas safe|niceic|napit|oftec/i.test(a) && !/regist/i.test(a) ? `${a} registered` : a]),
    ["clipboard-check", "Fixed price agreed before we start"],
    ["house", "Tidy, respectful work in your home"],
    ["wrench", "All work guaranteed"],
    ...(c.emergency ? [["siren", "Emergency call-outs available"] as [string, string]] : []),
    ...c.services.slice(6).map((s): [string, string] => [iconFor(s.name), s.name]),
  ];

  return {
    siteId: opts.siteId,
    endpoint: "/api/enquiry",
    concept: opts.preview ? c.businessName : undefined,
    brand: c.businessName,
    tagline: `${c.trade} · ${c.mainArea}`,
    phone: c.phone,
    email: c.email || undefined,
    theme: {
      main: c.brandColor,
      deep: shade(c.brandColor, -0.45),
      accent: shade(c.brandColor, 0.25),
      mist: shade(c.brandColor, 0.82),
      chalk: shade(c.brandColor, 0.95),
    },
    hero: { h1: c.headline, p: c.subheadline, cta: "Get a free quote" },
    mosaic: photos,
    proof,
    services: {
      title: "What we do",
      intro: `Everything you'd expect from a professional ${c.tradeNoun} in ${c.mainArea}, done properly and priced fairly.`,
      cards: c.services.slice(0, 6).map((s, i) => ({
        t: s.name,
        d: s.summary,
        img: pic(i + 1),
        href: `${opts.base}/services/${s.slug}`,
      })),
      extrasTitle: "Why customers choose us",
      extras,
    },
    work: photos.length > 1 ? { gallery: photos.slice(0, 12), gtitle: "Recent jobs", gintro: `A few of our recent jobs around ${c.mainArea}.` } : {},
    steps: [
      ["Get in touch", "Call us or send a quick request. We'll get back to you the same day."],
      ["Clear, fixed quote", "We look at the job and give you a price before any work starts. No surprises."],
      ["Job done properly", "We turn up on time, do the work to a high standard and leave everything tidy."],
      ["Aftercare", "All our work is guaranteed. If anything isn't right, we'll come back and sort it."],
    ],
    story: c.different
      ? {
          img: pic(photos.length > 1 ? photos.length - 1 : 0),
          alt: `${c.businessName} at work`,
          quote: firstSentence(c.different),
          body: c.different.slice(firstSentence(c.different).length).trim() ? [c.different.slice(firstSentence(c.different).length).trim()] : [],
          sig: c.ownerName || c.businessName,
          role: c.ownerName ? c.businessName : `${c.trade}, ${c.mainArea}`,
        }
      : undefined,
    areas: {
      title: "Areas we cover",
      intro: `Based in ${c.mainArea} and covering the surrounding area.`,
      towns: c.areas,
      q: `${c.mainArea}, UK`,
    },
    quote: {
      title: "Get a free quote",
      intro: "Tell us about the job and we'll get back to you quickly with a clear price.",
      hours: c.hours.replace(/\n+/g, " · ") || (c.emergency ? "Emergency call-outs available" : "Call or send a request"),
      options: [...c.services.map((s) => s.name), "Something else"],
      button: "Request a quote",
      sent: "Thanks, we've got your request. We'll be in touch shortly. If it's urgent, give us a call.",
    },
    footer: {
      company: c.businessName,
      lines: [c.address, c.accreditations.join(" · ")].filter(Boolean),
      links: c.services.slice(0, 6).map((s) => [s.name, `${opts.base}/services/${s.slug}`]),
    },
    mobileCta: "Free quote",
  };
}
