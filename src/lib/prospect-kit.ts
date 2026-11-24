// Outbound prospects (clinic cold email): maps a prospect row onto the asc-site-kit data
// format and fills the cold email. Pure functions, no I/O.
import { shade, type KitSite } from "./kit-site";
import { slugify } from "./site-content";

export type ProspectStatus = "sourced" | "enriched" | "checked" | "built" | "review_ready" | "approved" | "sent" | "replied" | "excluded";

/** Page copy written by Claude from the verified fields on the row. */
export type PreviewContent = {
  headline: string;
  subheadline: string;
  pageTitle: string; // heading of the specialty section
  paras: string[];
  services: { t: string; d: string }[];
  faqs: { q: string; a: string }[];
};

export type Prospect = {
  id: string;
  vertical: string;
  status: ProspectStatus;
  name: string;
  address: string | null;
  postcode: string | null;
  area: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  owner_name: string | null;
  owner_email: string | null;
  specialties: string[] | null;
  has_online_booking: boolean | null;
  booking_system: string | null;
  missing_specialty_page: string | null;
  is_incorporated: boolean | null;
  ai_query: string | null;
  ai_named_competitors: string[] | null;
  ai_mentions_clinic: boolean | null;
  preview_slug: string | null;
  preview_url: string | null;
  preview_content: PreviewContent | null;
  email_subject: string | null;
  email_body: string | null;
  view_count: number;
  first_viewed_at: string | null;
  notes: string | null;
};

export const VERTICAL: Record<string, { label: string; color: string; cta: string; how: string; steps: [string, string][] }> = {
  physio: {
    label: "Physiotherapy",
    color: "#0f766e",
    cta: "Book an appointment",
    how: "How booking works",
    steps: [
      ["Get in touch", "Call, or send a request at any time of day. You get a reply the same day."],
      ["Assessment", "Your first session is a full assessment, so treatment is planned around you."],
      ["Treatment plan", "A clear plan with what to expect, how many sessions and what to do at home."],
      ["Follow-up", "We check in after your treatment ends, so progress does not slip."],
    ],
  },
  specialist: {
    label: "Private consultant",
    color: "#1e3a8a",
    cta: "Request an appointment",
    how: "How an appointment works",
    steps: [
      ["Get in touch", "Call, or send a request at any time of day. The practice replies the next working day."],
      ["Consultation", "An unhurried appointment with the consultant to go through your history and concerns."],
      ["Clear next steps", "You leave knowing the plan, any tests needed and the costs involved."],
      ["Follow-up", "Results and follow-up are arranged directly with the practice."],
    ],
  },
  meded: {
    label: "Medical training",
    color: "#7c2d12",
    cta: "Book a place",
    how: "How booking works",
    steps: [
      ["Pick a date", "Choose the course and date that suits you."],
      ["Book your place", "Reserve online or by phone in a couple of minutes."],
      ["Attend", "Small groups and practical teaching from experienced instructors."],
      ["Certificate", "Your certificate is sent once you complete the course."],
    ],
  },
};

export const prospectSlug = (p: Pick<Prospect, "id" | "name">) => `${slugify(p.name).slice(0, 40).replace(/-+$/, "")}-${p.id.slice(0, 4)}`;

/** window.SITE for the preview page. Only uses facts stored on the row. */
export function prospectKit(p: Prospect, c: PreviewContent): KitSite {
  const v = VERTICAL[p.vertical] ?? VERTICAL.physio;
  const area = p.area || "London";
  const proof = [
    p.rating ? { v: Number(p.rating).toFixed(1), count: Number(p.rating), dec: 1, l: "Google rating" } : null,
    p.review_count ? { v: String(p.review_count), count: p.review_count, l: "Google reviews" } : null,
    { v: "24/7", l: "online requests" },
  ].filter(Boolean);
  return {
    concept: p.name,
    brand: p.name,
    tagline: `${v.label} · ${area}`,
    phone: p.phone || "",
    theme: {
      main: v.color,
      deep: shade(v.color, -0.45),
      accent: shade(v.color, 0.25),
      mist: shade(v.color, 0.82),
      chalk: shade(v.color, 0.95),
    },
    hero: { h1: c.headline, p: c.subheadline, cta: v.cta },
    mosaic: [],
    proof,
    prose: { title: c.pageTitle, paras: c.paras },
    services: { title: "What we treat", intro: `Care from ${p.name} in ${area}.`, cards: c.services.slice(0, 6), extras: [] },
    work: {},
    howTitle: v.how,
    steps: v.steps,
    areasNav: "Find us",
    areas: { title: "Where to find us", intro: p.address || area, towns: [area], q: p.address || `${p.name}, ${area}`, z: 15 },
    faqs: c.faqs,
    quote: {
      title: v.cta,
      intro: "Send a request at any time and get a reply the same day.",
      hours: "Preview only. On the live site, requests go straight to the practice.",
      options: [...c.services.map((s) => s.t), "Something else"],
      button: "Send request",
      sent: "This is a preview, so nothing was sent. On the live site this request would reach the practice straight away.",
    },
    footer: { company: p.name, lines: [p.address || "", "Preview built by ASC Development. Not affiliated with the practice."].filter(Boolean), links: [] },
    mobileCta: v.cta,
  };
}

/**
 * Fills the fixed cold email from verified fields. Returns null when there is no honest
 * opening line (the clinic is already named by AI search, or no competitor was named).
 */
export function prospectEmail(p: Prospect, previewUrl: string, phone: string): { subject: string; body: string } | null {
  const rivals = (p.ai_named_competitors ?? []).slice(0, 2);
  if (p.ai_mentions_clinic !== false || !rivals.length || !p.ai_query) return null;
  const first = (p.owner_name ?? "").trim().split(/\s+/)[0];
  // The stored query can carry a trailing instruction to the model; the email quotes the question only.
  const question = p.ai_query.includes("?") ? `${p.ai_query.split("?")[0]}?` : p.ai_query;
  const noun = VERTICAL[p.vertical]?.label.toLowerCase() ?? "clinic";
  const problems = [
    p.review_count && p.rating ? `You have ${p.review_count} Google reviews at ${Number(p.rating).toFixed(1)}, so the reputation is already there` : null,
    p.missing_specialty_page ? `Your site lists ${p.missing_specialty_page} but has no page about it for AI search to read` : null,
    p.has_online_booking === false ? "I could not find a way to book online on your site" : null,
  ].filter(Boolean);
  const body = [
    first ? `Hi ${first},` : "Hi,",
    "",
    `I asked AI search "${question}" It named ${rivals.join(" and ")}, not ${p.name}.`,
    "",
    ...problems.map((x) => `- ${x}`),
    "",
    `I built a page that fixes this for you: ${previewUrl}`,
    "",
    `- Written around your own ${noun} services in ${p.area || "London"}`,
    "- Set up to be picked up by ChatGPT and Google",
    "- Free to set up, you only pay per new patient booked",
    "",
    `Worth a 10 minute call this week? I'm on ${phone}.`,
    "",
    "Ayush",
    "ASC Development",
    "",
    "If this isn't relevant, reply \"no thanks\" and I won't email again.",
  ].join("\n");
  return { subject: `${p.name} and AI search`, body };
}
