import "server-only";
import { z } from "zod";
import type { SiteContent } from "./site-content";
import type { SeoPage } from "./seo-pages";

/** The parts of a page that Claude writes. Everything else (links, schema) is structural. */
export const seoCopySchema = z.object({
  title: z.string().min(10).max(70),
  description: z.string().min(50).max(165),
  h1: z.string().min(5).max(80),
  heroP: z.string().min(20).max(220),
  proseTitle: z.string().min(5).max(80),
  paras: z.array(z.string().min(40).max(900)).min(3).max(6),
  faqs: z.array(z.object({ q: z.string().min(8).max(140), a: z.string().min(20).max(500) })).min(3).max(5),
});
export type SeoCopy = z.infer<typeof seoCopySchema>;

export function seoAiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function facts(c: SiteContent) {
  return [
    `Business: ${c.businessName}`,
    c.ownerName && `Owner: ${c.ownerName}`,
    `Trade: ${c.trade} (${c.tradeNoun})`,
    `Phone: ${c.phone}`,
    `Based in: ${c.mainArea}${c.address ? ` (${c.address})` : ""}`,
    `Areas covered: ${c.areas.join(", ")}`,
    `Services: ${c.services.map((s) => s.name).join(", ")}`,
    `Emergency call-outs: ${c.emergency ? "yes" : "no"}`,
    c.yearsTrading && `Years trading: ${c.yearsTrading}`,
    c.accreditations.length && `Accreditations: ${c.accreditations.join(", ")}`,
    c.hours && `Hours: ${c.hours.replace(/\n/g, "; ")}`,
    c.different && `In their own words, what makes them different: "${c.different}"`,
  ]
    .filter(Boolean)
    .join("\n");
}

function pageBrief(page: SeoPage) {
  if (page.service && page.area) return `A page targeting people searching for "${page.service.name} in ${page.area}". Focus on this one service for customers in ${page.area}.`;
  if (page.service) return `A page about the service "${page.service.name}" across the whole area covered. Explain the service in depth: what it involves, common problems it solves, what the customer can expect.`;
  if (page.area) return `A page targeting people in ${page.area} searching for a local ${"tradesperson"}. Cover the range of services offered to customers in ${page.area}.`;
  return "A general page.";
}

const SYSTEM = `You write local SEO page copy for UK trades businesses' websites.

Rules:
- Every page must be genuinely unique: a different angle, structure, opening and wording from any other page on the site. Never reuse stock sentences. Vary sentence length.
- Use only the facts provided. Never invent reviews, prices, guarantees beyond those given, years, awards, staff names, response times, landmarks, street names, or local trivia.
- Write in plain, warm British English, first person plural ("we"). No hype words like "top-notch", "unparalleled", "look no further". No em dashes.
- Work the target keyword (service and/or place) in naturally: in the title, the h1, the first paragraph and one FAQ. Don't stuff it.
- Title: under 60 characters, keyword first, ending with the business name if it fits.
- Description: 140 to 155 characters, ending with a call to action that includes the phone number.
- Paragraphs: 3 to 5, each 2 to 4 sentences, useful to a homeowner deciding who to call.
- FAQs: 3 to 4 questions a real customer would ask about this specific page topic, with honest answers based on the facts.

Reply with JSON only, no prose, matching:
{"title":"","description":"","h1":"","heroP":"","proseTitle":"","paras":["",""],"faqs":[{"q":"","a":""}]}`;

/** Asks Claude for unique copy for one page. Returns null if not configured or the reply is unusable. */
export async function writeSeoCopy(c: SiteContent, page: SeoPage, siblings: string[]): Promise<SeoCopy | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const user = `Business facts:
${facts(c)}

Page to write: ${page.path}
${pageBrief(page)}

Other pages on this site (yours must read differently from all of them): ${siblings.slice(0, 40).join(", ")}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 2000,
      temperature: 0.9,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    console.error("Anthropic error", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    const parsed = seoCopySchema.safeParse(JSON.parse(json));
    if (!parsed.success) return null;
    // House rule: no em dashes anywhere.
    const strip = (s: string) => s.replace(/\s*—\s*/g, ", ");
    const v = parsed.data;
    return {
      title: strip(v.title),
      description: strip(v.description),
      h1: strip(v.h1),
      heroP: strip(v.heroP),
      proseTitle: strip(v.proseTitle),
      paras: v.paras.map(strip),
      faqs: v.faqs.map((f) => ({ q: strip(f.q), a: strip(f.a) })),
    };
  } catch {
    return null;
  }
}
