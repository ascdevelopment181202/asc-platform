// Turns onboarding answers into website content. Pure functions, no I/O,
// so the same input always produces the same site.

export type SiteService = { name: string; slug: string; summary: string; body: string[] };

export type SiteContent = {
  businessName: string;
  ownerName: string;
  trade: string;
  tradeNoun: string; // "plumber", "electrician"...
  phone: string;
  phoneHref: string;
  email: string;
  address: string;
  mainArea: string;
  areas: string[];
  hours: string;
  emergency: boolean;
  yearsTrading: string;
  accreditations: string[];
  different: string;
  brandColor: string;
  logoUrl: string | null;
  heroImage: string | null;
  gallery: string[];
  reviewsLink: string;
  headline: string;
  subheadline: string;
  services: SiteService[];
  faqs: { q: string; a: string }[];
  seo: { title: string; description: string };
  schemaType: string;
};

type Answers = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Splits a free-text list on new lines, commas or semicolons. */
export function listOf(text: string, max = 20): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .filter((s, i, a) => a.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, max);
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function titleCase(s: string) {
  return s.replace(/\w\S*/g, (w) => (w.length <= 3 && /^(and|of|the|for|to|in)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)));
}

const TRADE_NOUN: Record<string, string> = {
  Plumbing: "plumber",
  Heating: "heating engineer",
  "Plumbing and heating": "plumbing and heating engineer",
  Electrical: "electrician",
  Roofing: "roofer",
  HVAC: "HVAC engineer",
};

const SCHEMA_TYPE: Record<string, string> = {
  Plumbing: "Plumber",
  Heating: "HVACBusiness",
  "Plumbing and heating": "Plumber",
  Electrical: "Electrician",
  Roofing: "RoofingContractor",
  HVAC: "HVACBusiness",
};

const DEFAULT_COLOR: Record<string, string> = {
  Plumbing: "#1d4ed8",
  Heating: "#c2410c",
  "Plumbing and heating": "#1d4ed8",
  Electrical: "#ca8a04",
  Roofing: "#334155",
  HVAC: "#0e7490",
};

// Copy for common services. Matched by keyword; anything else gets the generic version.
const SERVICE_COPY: { match: RegExp; summary: string; body: string[] }[] = [
  {
    match: /boiler.*(install|replace|new)|new boiler/i,
    summary: "Efficient new boilers fitted properly, with the paperwork and warranty sorted.",
    body: [
      "A new boiler is a big decision, so we start with an honest survey of your home and recommend the right size and type, not the most expensive one.",
      "We handle the full installation, flush your system, register the boiler and leave you with a clear warranty.",
    ],
  },
  {
    match: /boiler.*(repair|service|fault|breakdown)|boiler/i,
    summary: "Fast, honest boiler repairs and annual servicing to keep your heating running safely.",
    body: [
      "No heating or hot water? We diagnose the fault, explain it in plain English and give you a price before any work starts.",
      "Annual servicing keeps your boiler efficient, safe and within its warranty.",
    ],
  },
  {
    match: /leak|burst|emergency/i,
    summary: "Rapid response to leaks and plumbing emergencies to limit the damage.",
    body: [
      "Water where it shouldn't be needs dealing with quickly. We get to you fast, find the source and stop it.",
      "Once it's safe, we carry out a proper permanent repair rather than a quick patch.",
    ],
  },
  {
    match: /bathroom|shower|wet ?room/i,
    summary: "Bathrooms and showers fitted to a high standard, from design to finishing touches.",
    body: [
      "Whether it's a new shower or a full bathroom, we plan the job with you and keep disruption to a minimum.",
      "Tidy work, clear timescales and a finish you'll be proud of.",
    ],
  },
  {
    match: /drain|block/i,
    summary: "Blocked drains, sinks and toilets cleared quickly and cleanly.",
    body: [
      "We clear blockages properly and check for the cause so the problem doesn't keep coming back.",
      "Clean, fast and fairly priced.",
    ],
  },
  {
    match: /radiator|central heating|power ?flush|underfloor/i,
    summary: "Central heating that heats every room evenly and efficiently.",
    body: [
      "Cold spots, noisy pipes or radiators that won't warm up? We find the cause and fix it.",
      "From new radiators to full system upgrades, we'll make your heating work the way it should.",
    ],
  },
  {
    match: /rewir|consumer unit|fuse ?board/i,
    summary: "Safe, certified rewiring and consumer unit upgrades.",
    body: [
      "We upgrade old wiring and fuse boards to current regulations, with full certification on completion.",
      "Careful, tidy work with minimal disruption to your home.",
    ],
  },
  {
    match: /ev|charger/i,
    summary: "Home EV charger installation, done safely and to regulations.",
    body: [
      "We'll recommend the right charger for your car and home, and install it neatly with full certification.",
      "Charge at home overnight and save on running costs.",
    ],
  },
  {
    match: /roof|gutter|flat|tile|slate|chimney/i,
    summary: "Roof repairs and replacements that keep your home watertight.",
    body: [
      "From a few slipped tiles to a full replacement, we inspect properly and tell you exactly what's needed.",
      "Quality materials, safe working and a clean site when we leave.",
    ],
  },
];

function serviceCopy(name: string, area: string, noun: string): Pick<SiteService, "summary" | "body"> {
  const hit = SERVICE_COPY.find((s) => s.match.test(name));
  if (hit) return { summary: hit.summary, body: hit.body };
  return {
    summary: `Professional ${name.toLowerCase()} across ${area} and surrounding areas.`,
    body: [
      `Looking for a reliable ${noun} for ${name.toLowerCase()} in ${area}? We turn up when we say we will, explain the work clearly and price it fairly.`,
      "Every job is done properly, tidied up after, and backed by our guarantee.",
    ],
  };
}

function firstHex(text: string) {
  const m = text.match(/#?([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex.toLowerCase()}`;
}

/** Shortens to max characters at a word boundary. */
function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1).replace(/\s+\S*$/, "");
  return cut.replace(/[\s,;:|&-]+$/, "");
}

export function phoneHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.startsWith("0")) return `tel:+44${digits.slice(1)}`;
  return `tel:${digits}`;
}

export function buildSiteContent(
  answers: Answers,
  images: { logoUrl: string | null; photoUrls: string[] },
): SiteContent {
  const tradeKey = str(answers.trade) || "Plumbing";
  const trade = tradeKey === "Other" ? str(answers.tradeOther) || "Trades" : tradeKey;
  const noun = TRADE_NOUN[tradeKey] ?? (str(answers.tradeOther).toLowerCase() || "tradesperson");
  const businessName = str(answers.businessName);
  const areas = listOf(str(answers.areas), 30).map(titleCase);
  const mainArea = areas[0] ?? "your area";
  const phone = str(answers.mobile);
  const emergency = str(answers.emergency) === "Yes";
  const years = str(answers.yearsTrading).replace(/\s*years?$/i, "");
  const accreditations = listOf(str(answers.accreditations), 8);

  const usedSlugs = new Set<string>();
  const services: SiteService[] = listOf(str(answers.services), 12).map((raw) => {
    const name = titleCase(raw);
    let slug = slugify(name) || "service";
    while (usedSlugs.has(slug)) slug += "-2";
    usedSlugs.add(slug);
    return { name, slug, ...serviceCopy(name, mainArea, noun) };
  });

  const headline = `Trusted ${noun} in ${mainArea}`;
  const subheadline = [
    emergency ? "Fast response, including emergencies." : "Reliable, tidy work at a fair price.",
    years ? `${years} years' experience.` : "",
    accreditations[0] ? `${accreditations[0]} registered.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const faqs = [
    {
      q: `Which areas do you cover?`,
      a: areas.length > 1 ? `We cover ${areas.slice(0, -1).join(", ")} and ${areas.at(-1)}.` : `We're based in ${mainArea} and cover the surrounding area.`,
    },
    {
      q: `Do you offer emergency call-outs?`,
      a: emergency ? "Yes. Call us any time and we'll get to you as quickly as possible." : `We don't run a 24/7 emergency service, but call us and we'll fit you in as soon as we can.`,
    },
    { q: "Do you give free quotes?", a: "Yes. Tell us what you need and we'll give you a clear price before any work starts." },
    ...(accreditations.length ? [{ q: "Are you accredited?", a: `Yes: ${accreditations.join(", ")}.` }] : []),
  ];

  const serviceList = services.slice(0, 2).map((s) => s.name.toLowerCase()).join(" and ");
  const cta = `Call ${phone} for a free quote.`;
  const basePitch = `Trusted ${noun} in ${mainArea}${serviceList ? ` for ${serviceList}` : ""}.`;
  const withEmergency = `${basePitch} Emergency call-outs.`;
  const pitch = emergency && withEmergency.length + cta.length < 155 ? withEmergency : basePitch;

  return {
    businessName,
    ownerName: str(answers.contactName),
    trade,
    tradeNoun: noun,
    phone,
    phoneHref: phoneHref(phone),
    email: str(answers.email),
    address: str(answers.address),
    mainArea,
    areas,
    hours: str(answers.hours),
    emergency,
    yearsTrading: years,
    accreditations,
    different: str(answers.different),
    brandColor: firstHex(str(answers.brandColours)) ?? DEFAULT_COLOR[tradeKey] ?? "#1d4ed8",
    logoUrl: images.logoUrl,
    heroImage: images.photoUrls[0] ?? null,
    gallery: images.photoUrls.slice(0, 12),
    reviewsLink: str(answers.reviewsLink),
    headline,
    subheadline,
    services,
    faqs,
    seo: {
      title: clip(`${titleCase(noun)} in ${mainArea} | ${businessName}`, 60),
      description: `${clip(pitch, 155 - cta.length - 1)} ${cta}`,
    },
    schemaType: SCHEMA_TYPE[tradeKey] ?? "HomeAndConstructionBusiness",
  };
}
