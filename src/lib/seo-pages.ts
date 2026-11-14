// Local SEO pages for each client site: one per service, one per area, and one per
// top service in each top area. Copy is assembled from the client's own answers with
// varied phrasing so pages aren't near-duplicates.
import { slugify, type SiteContent, type SiteService } from "./site-content";

export type SeoPage = {
  path: string; // relative to the site root, e.g. "/services/boiler-installation"
  title: string;
  description: string;
  h1: string;
  heroP: string;
  proseTitle: string;
  paras: string[];
  crumbs: [string, string | null][];
  links: [string, string][];
  linksTitle: string;
  faqs: { q: string; a: string }[];
  service?: SiteService;
  area?: string;
};

const COMBO_SERVICES = 4;
const COMBO_AREAS = 6;

const comboServices = (c: SiteContent) => c.services.slice(0, COMBO_SERVICES);
const comboAreas = (c: SiteContent) => c.areas.slice(0, COMBO_AREAS);
const areaSlug = (a: string) => slugify(a);
const lc = (s: string) => s.toLowerCase();

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const pick = <T,>(arr: T[], key: string) => arr[hash(key) % arr.length];

function clip(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, max + 1).replace(/\s+\S*$/, "").replace(/[\s,;:|&-]+$/, "");
}

function listJoin(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function nearby(c: SiteContent, area: string) {
  return c.areas.filter((a) => a !== area).slice(0, 4);
}

function trustLine(c: SiteContent) {
  const bits = [
    c.accreditations.length ? `We're ${listJoin(c.accreditations)}` : "",
    c.yearsTrading ? `${c.accreditations.length ? "and have" : "We have"} ${c.yearsTrading} years' experience` : "",
  ].filter(Boolean);
  return bits.length ? `${bits.join(" ")}, and all our work is guaranteed.` : "All our work is guaranteed, and we always tidy up after ourselves.";
}

function titleFor(main: string, biz: string) {
  return clip(`${main} | ${biz}`, 60);
}

function descFor(c: SiteContent, lead: string) {
  const cta = `Call ${c.phone} for a free quote.`;
  return `${clip(lead, 155 - cta.length - 1)} ${cta}`;
}

// ---------- page builders ----------

export function servicePage(c: SiteContent, slug: string): SeoPage | null {
  const s = c.services.find((x) => x.slug === slug);
  if (!s) return null;
  const inCombo = comboServices(c).some((x) => x.slug === s.slug);
  return {
    path: `/services/${s.slug}`,
    title: titleFor(`${s.name} | ${listJoin(c.areas.slice(0, 2))}`, c.businessName),
    description: descFor(c, `${s.summary} Covering ${listJoin(c.areas.slice(0, 3))}.`),
    h1: `${s.name} across ${c.mainArea} and nearby`,
    heroP: s.summary,
    proseTitle: `${s.name} you can trust`,
    paras: [...s.body, c.different, trustLine(c)].filter(Boolean),
    crumbs: [["Home", ""], [s.name, null]],
    links: inCombo ? comboAreas(c).map((a) => [`${s.name} in ${a}`, `/services/${s.slug}/${areaSlug(a)}`]) : c.areas.map((a) => [a, `/areas/${areaSlug(a)}`]),
    linksTitle: inCombo ? `${s.name} near you` : "Areas we cover",
    faqs: serviceFaqs(c, s, c.mainArea),
    service: s,
  };
}

export function areaPage(c: SiteContent, slug: string): SeoPage | null {
  const area = c.areas.find((a) => areaSlug(a) === slug);
  if (!area) return null;
  const inCombo = comboAreas(c).includes(area);
  const near = nearby(c, area);
  const intro = pick(
    [
      `Looking for a reliable ${c.tradeNoun} in ${area}? ${c.businessName} works across ${area}${near.length ? ` and nearby ${listJoin(near.slice(0, 2))}` : ""}, helping local homeowners with everything from small repairs to bigger projects.`,
      `${c.businessName} is a trusted local ${c.tradeNoun} covering ${area}. Whether it's an urgent problem or a planned job, we'll give you a clear price and turn up when we say we will.`,
      `If you live in ${area}, we're your local ${c.tradeNoun}. We know the area well and regularly work on homes across ${area}${near.length ? `, ${listJoin(near.slice(0, 2))}` : ""}.`,
    ],
    area,
  );
  return {
    path: `/areas/${slug}`,
    title: titleFor(`Local ${c.tradeNoun} covering ${area}`, c.businessName),
    description: descFor(c, `Trusted ${c.tradeNoun} in ${area}. ${c.services.slice(0, 3).map((s) => s.name).join(", ")}.${c.emergency ? " Emergency call-outs." : ""}`),
    h1: `Your local ${c.tradeNoun} in ${area}`,
    heroP: `${c.emergency ? "Fast response, including emergencies, " : "Reliable, tidy work "}across ${area} and the surrounding area.`,
    proseTitle: `Why homeowners in ${area} call us`,
    paras: [
      intro,
      `Our services in ${area} include ${listJoin(c.services.slice(0, 5).map((s) => lc(s.name)))}.`,
      c.different,
      trustLine(c),
    ].filter(Boolean),
    crumbs: [["Home", ""], ["Areas", "/#areas"], [area, null]],
    links: c.services.map((s) => [
      inCombo && comboServices(c).some((x) => x.slug === s.slug) ? `${s.name} in ${area}` : s.name,
      inCombo && comboServices(c).some((x) => x.slug === s.slug) ? `/services/${s.slug}/${slug}` : `/services/${s.slug}`,
    ]),
    linksTitle: `Our services in ${area}`,
    faqs: [
      {
        q: `Do you cover all of ${area}?`,
        a: `Yes, we cover ${area} and the surrounding area${near.length ? `, including ${listJoin(near)}` : ""}.`,
      },
      {
        q: `How quickly can you get to ${area}?`,
        a: c.emergency
          ? `For emergencies we'll get to you in ${area} as quickly as possible. For planned work, we'll book a time that suits you.`
          : `Call us and we'll book a time that suits you, usually within a few days.`,
      },
      { q: "Do you give free quotes?", a: "Yes. We'll give you a clear, fixed price before any work starts." },
    ],
    area,
  };
}

export function comboPage(c: SiteContent, serviceSlug: string, slug: string): SeoPage | null {
  const s = comboServices(c).find((x) => x.slug === serviceSlug);
  const area = comboAreas(c).find((a) => areaSlug(a) === slug);
  if (!s || !area) return null;
  const key = `${s.slug}:${slug}`;
  const near = nearby(c, area);
  const svc = lc(s.name);
  const opener = pick(
    [
      `Need ${svc} in ${area}? ${c.businessName} is a local ${c.tradeNoun} covering ${area} and the surrounding area, ${c.emergency ? "with emergency call-outs available" : "with appointments to suit you"}.`,
      `If you're in ${area} and looking for ${svc}, we can help. We work across ${area}${near.length ? `, ${listJoin(near.slice(0, 3))}` : ""} and give every customer a clear price before we start.`,
      `${c.businessName} provides ${svc} for homes across ${area}. We turn up when we say we will, explain the work in plain English and leave everything tidy.`,
      `Looking for someone reliable for ${svc} in ${area}? Local customers choose ${c.businessName} for honest advice, fair prices and work that's done properly the first time.`,
    ],
    key,
  );
  const closer = pick(
    [
      `Every ${svc} job in ${area} comes with a fixed price agreed upfront, so there are no surprises.`,
      `We regularly work in ${area}, so we can usually fit you in quickly.`,
      `From the first call to the finished job, you'll deal with a local team that cares about doing it right.`,
    ],
    key + "c",
  );
  return {
    path: `/services/${s.slug}/${slug}`,
    title: titleFor(`${s.name} in ${area}`, c.businessName),
    description: descFor(c, `${s.name} in ${area} from ${c.businessName}. ${s.summary}`),
    h1: `${s.name} in ${area}`,
    heroP: s.summary,
    proseTitle: `${s.name} in ${area}`,
    paras: [opener, ...s.body, closer, trustLine(c)],
    crumbs: [["Home", ""], [s.name, `/services/${s.slug}`], [area, null]],
    links: [
      ...comboAreas(c).filter((a) => a !== area).map((a): [string, string] => [`${s.name} in ${a}`, `/services/${s.slug}/${areaSlug(a)}`]),
      [`All services in ${area}`, `/areas/${slug}`],
    ],
    linksTitle: `${s.name} in nearby areas`,
    faqs: serviceFaqs(c, s, area),
    service: s,
    area,
  };
}

function serviceFaqs(c: SiteContent, s: SiteService, area: string) {
  const svc = lc(s.name);
  return [
    {
      q: `How much does ${svc} cost in ${area}?`,
      a: "Every job is different, so we give you a clear, fixed price after a quick look. There's no charge for the quote.",
    },
    {
      q: `How soon can you start?`,
      a: c.emergency ? "For emergencies, as quickly as possible. For planned work we'll book a time that suits you." : "We'll book a time that suits you, usually within a few days.",
    },
    ...(c.accreditations.length ? [{ q: "Are you accredited?", a: `Yes: ${listJoin(c.accreditations)}.` }] : []),
    { q: "Is your work guaranteed?", a: "Yes. If anything isn't right, we'll come back and put it right." },
  ];
}

/** Every page on the site, for the sitemap and the admin page count. */
export function allPaths(c: SiteContent): string[] {
  return [
    "/",
    ...c.services.map((s) => `/services/${s.slug}`),
    ...c.areas.map((a) => `/areas/${areaSlug(a)}`),
    ...comboServices(c).flatMap((s) => comboAreas(c).map((a) => `/services/${s.slug}/${areaSlug(a)}`)),
  ];
}

export { areaSlug };

/** Builds the template page for a path from allPaths (not "/"). */
export function pageForPath(c: SiteContent, path: string): SeoPage | null {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "services" && parts.length === 2) return servicePage(c, parts[1]);
  if (parts[0] === "services" && parts.length === 3) return comboPage(c, parts[1], parts[2]);
  if (parts[0] === "areas" && parts.length === 2) return areaPage(c, parts[1]);
  return null;
}
