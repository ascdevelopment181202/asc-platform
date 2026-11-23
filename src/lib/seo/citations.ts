import "server-only";
import { db } from "@/lib/supabase";
import type { Finding, SeoConfig } from "./types";
import { claudeJson, MODELS } from "./ai";
import { factSheet } from "./drafts";
import { valueOf } from "./value";

export type Directory = { key: string; name: string; url: string; why: string };

const BOTH: Directory[] = [
  { key: "bing", name: "Bing Places", url: "https://www.bingplaces.com/", why: "Feeds Bing, Copilot and ChatGPT search. Import straight from the Google profile." },
  { key: "apple", name: "Apple Business Connect", url: "https://businessconnect.apple.com/", why: "Apple Maps and Siri on every iPhone." },
  { key: "facebook", name: "Facebook Page", url: "https://www.facebook.com/pages/create", why: "A profile Google and AI tools use to confirm the business is real." },
  { key: "nextdoor", name: "Nextdoor", url: "https://business.nextdoor.com/", why: "Neighbours recommending trades; AI tools quote it." },
];
const UK: Directory[] = [
  { key: "yell", name: "Yell", url: "https://business.yell.com/free-listing/", why: "The UK's biggest directory; widely quoted." },
  { key: "checkatrade", name: "Checkatrade", url: "https://www.checkatrade.com/trades/join", why: "The trust badge UK homeowners look for. Paid, but AI answers cite it heavily." },
  { key: "trustatrader", name: "TrustATrader", url: "https://www.trustatrader.com/join", why: "Vetted trades directory." },
  { key: "mybuilder", name: "MyBuilder", url: "https://www.mybuilder.com/tradesmen", why: "Job leads plus a public profile." },
  { key: "ratedpeople", name: "Rated People", url: "https://www.ratedpeople.com/tradesmen", why: "Job leads plus a public profile." },
  { key: "bark", name: "Bark", url: "https://www.bark.com/en/gb/sellers/create/", why: "Free profile that ranks for local searches." },
  { key: "thomsonlocal", name: "Thomson Local", url: "https://www.thomsonlocal.com/add-business", why: "Long-standing UK directory." },
  { key: "yelp", name: "Yelp UK", url: "https://biz.yelp.co.uk/", why: "Feeds Apple Maps and is cited by ChatGPT." },
  { key: "scoot", name: "Scoot", url: "https://www.scoot.co.uk/", why: "Feeds several newspaper directories." },
  { key: "freeindex", name: "FreeIndex", url: "https://www.freeindex.co.uk/", why: "Free listing with reviews." },
];
const US: Directory[] = [
  { key: "yelp", name: "Yelp", url: "https://biz.yelp.com/", why: "The directory ChatGPT cites most for local businesses." },
  { key: "bbb", name: "Better Business Bureau", url: "https://www.bbb.org/get-listed", why: "A trust signal AI answers quote." },
  { key: "angi", name: "Angi", url: "https://www.angi.com/pro/", why: "Home services directory AI answers quote." },
  { key: "homeadvisor", name: "HomeAdvisor", url: "https://pro.homeadvisor.com/", why: "Home services leads and a profile." },
  { key: "thumbtack", name: "Thumbtack", url: "https://www.thumbtack.com/pro", why: "Local services marketplace." },
  { key: "yellowpages", name: "Yellow Pages", url: "https://adsolutions.yp.com/free-listing", why: "Long-standing directory." },
  { key: "houzz", name: "Houzz", url: "https://www.houzz.com/for-pros", why: "For home improvement trades." },
  { key: "mapquest", name: "MapQuest", url: "https://www.mapquest.com/", why: "Still cited by AI tools." },
  { key: "foursquare", name: "Foursquare", url: "https://foursquare.com/add-place", why: "Location data used by many apps." },
];

export const directoriesFor = (cfg: SeoConfig): Directory[] => [...BOTH, ...(cfg.country === "US" ? US : UK)];

export type CitationRow = { directory: string; status: "todo" | "listed" | "skip"; url: string | null; checked_at: string | null };

export async function citationRows(clientId: string): Promise<Map<string, CitationRow>> {
  const { data } = await db().from("seo_citations").select("directory, status, url, checked_at").eq("client_id", clientId).returns<CitationRow[]>();
  return new Map((data ?? []).map((r) => [r.directory, r]));
}

/** The text each directory asks for, written once from the fact sheet so every listing matches. */
export function citationCopy(cfg: SeoConfig): { label: string; value: string }[] {
  const f = cfg.facts ?? {};
  const desc = f.about || `${f.businessName ?? "We"} provide${f.businessName ? "s" : ""} ${(cfg.services ?? []).slice(0, 5).join(", ").toLowerCase()} across ${(cfg.towns ?? []).slice(0, 6).join(", ")}.${f.yearsTrading ? ` ${f.yearsTrading}.` : ""}${f.accreditations?.length ? ` ${f.accreditations.join(", ")}.` : ""}`;
  return [{ label: "Business name", value: f.businessName ?? "" }, { label: "Phone", value: f.phone ?? "" }, { label: "Address", value: f.address ?? "" }, { label: "Website", value: cfg.domain ? `https://${cfg.domain}` : "" }, { label: "Email", value: f.email ?? "" }, { label: "Description", value: desc }, { label: "Services", value: (cfg.services ?? []).join(", ") }, { label: "Areas", value: (cfg.towns ?? []).join(", ") }].filter((x) => x.value);
}

export function citationFinding(cfg: SeoConfig, rows: Map<string, CitationRow>): Finding[] {
  const todo = directoriesFor(cfg).filter((d) => (rows.get(d.key)?.status ?? "todo") === "todo");
  if (todo.length < 3) return [];
  const v = valueOf({ calls: 1 }, cfg, [{ label: "Matching listings help Maps and AI answers", value: "about 1 extra call a month", assumed: true }]);
  return [{ kind: "citations", type: "Manual", dedupe: "citations", summary: `List the business on ${todo.length} directories (one-off, details pre-filled).`, detail: { evidence: { why: `Not yet marked as listed: ${todo.map((d) => d.name).join(", ")}. AI tools and Google trust a business whose name, address and phone match across several sources.` }, gain: { calls: 1, gbp: Math.round(v.gbp) }, chain: v.chain, confidence: "Medium", effort: "30 min manual", risk: "Low", undoable: false }, draft: { target: "manual", minutes: 35, steps: [{ text: "Open the Citations tab for this client. Each directory has its sign-up link and copy buttons for every field." }, { text: "Start with Bing Places (import from Google) and Apple Business Connect: 5 minutes each." }, { text: "Paste each listing's address into the tab and set it to Listed." }, { text: "Press Mark done when the important ones are in." }] } }];
}

type Found = { links?: { site: string; url: string; why: string; email: string }[]; mentions?: { url: string; where: string }[]; threads?: { url: string; title: string; reply: string }[] };

/** Monthly: real local link chances, unlinked mentions and forum threads, found with web search. Nothing is ever sent automatically. */
export async function findLinks(clientId: string, cfg: SeoConfig): Promise<Finding[]> {
  const j = await claudeJson<Found>({ clientId, purpose: "link-finder", model: MODELS.write(), maxTokens: 2500, webSearch: 5, system: "You are a local SEO link researcher for a trades business. Search the web for real, specific opportunities. Only return pages you actually found. No directories that take anyone, no paid link schemes. No em dashes.", user: `FACTS\n${factSheet(cfg)}\n\nFind:\n1. Up to 4 local link chances: suppliers' "find an installer" or "approved contractor" pages for products this trade uses, local sponsorships (sports clubs, school fairs, charities) that list sponsors with a link, trade bodies, and local news or community sites that feature local businesses. For each write a short, friendly outreach email (under 90 words) from the owner.\n2. Up to 3 pages that mention the business by name without linking to its website.\n3. Up to 2 recent local forum, Reddit or community threads asking for a recommendation in this trade and area, each with a helpful, honest reply the owner could post (it must say they are the owner).\n\n{"links":[{"site":"","url":"","why":"","email":""}],"mentions":[{"url":"","where":""}],"threads":[{"url":"","title":"","reply":""}]}` });
  if (!j) return [];
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u.slice(0, 40);
    }
  };
  const mk = (kind: string, dedupe: string, summary: string, why: string, url: string, steps: { text: string; copy?: string; url?: string }[]): Finding => {
    const v = valueOf({ clicks: 3 }, cfg, [{ label: "One good local link lifts the whole site a little", value: "about 3 clicks a month", assumed: true }]);
    return { kind, type: "Manual", dedupe, summary, detail: { evidence: { why }, gain: { clicks: 3, gbp: Math.round(v.gbp) }, chain: v.chain, confidence: "Low", effort: "5 min manual", risk: "Low", undoable: false, links: [{ label: "The page", url }] }, draft: { target: "manual", minutes: 5, steps } };
  };
  const out: Finding[] = [];
  for (const l of (j.links ?? []).slice(0, 4)) if (l.url && l.email) out.push(mk("link_outreach", `link:${host(l.url)}`, `Ask ${l.site || host(l.url)} for a link.`, l.why, l.url, [{ text: "Open the page and find the contact email or form.", url: l.url }, { text: "Send this (edit to taste):", copy: l.email }, { text: "Press Mark done once it's sent." }]));
  for (const m of (j.mentions ?? []).slice(0, 3)) if (m.url) out.push(mk("mention_link", `mention:${host(m.url)}`, `${host(m.url)} mentions the business without a link: ask for one.`, `Found on: ${m.where || m.url}. A mention that becomes a link is the easiest link there is.`, m.url, [{ text: "Open the page and find who runs it.", url: m.url }, { text: "Send this:", copy: `Hi, thanks for mentioning ${cfg.facts?.businessName ?? "us"} on your site. Would you mind linking the name to our website, https://${cfg.domain}? It helps people find us. Much appreciated.` }, { text: "Press Mark done once it's sent." }]));
  for (const t of (j.threads ?? []).slice(0, 2)) if (t.url && t.reply) out.push(mk("forum_reply", `thread:${t.url.slice(-60)}`, `A local thread is asking for a recommendation: "${(t.title || "").slice(0, 70)}".`, "AI tools quote local forum threads often. A helpful reply from the owner, saying who they are, is fair game. This one is optional.", t.url, [{ text: "Send the owner this thread and the suggested reply. They post it from their own account.", url: t.url }, { text: "Suggested reply:", copy: t.reply }, { text: "Press Mark done, or Dismiss to skip." }]));
  return out;
}
