import "server-only";
import { db, type Client } from "@/lib/supabase";
import type { SiteContent } from "@/lib/site-content";
import { clientLabel } from "@/lib/clients";
import type { SeoConfig } from "./types";
import { get } from "./crawl";
import { getLocation, summarise } from "./gbp";
import { parseHtml } from "./onsite";

/** The client's site on the platform, if they have one. */
export async function hostedSite(clientId: string) {
  const { data } = await db().from("sites").select("id, slug, domain, content, gsc_property, gbp_location").eq("client_id", clientId).maybeSingle<{ id: string; slug: string; domain: string | null; content: SiteContent; gsc_property: string | null; gbp_location: string | null }>();
  return data;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Picks the Search Console property for a domain: the domain property first, then a matching address. */
export function matchProperty(properties: string[], domain?: string): string | undefined {
  if (!domain) return undefined;
  const d = domain.replace(/^www\./, "");
  return properties.find((p) => p === `sc-domain:${d}`) ?? properties.find((p) => p.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") === d);
}

export function matchLocation<T extends { name: string; title: string }>(locations: T[], businessName?: string | null): T | undefined {
  if (!businessName) return undefined;
  const n = norm(businessName);
  return locations.find((l) => norm(l.title) === n) ?? locations.find((l) => norm(l.title).includes(n) || n.includes(norm(l.title)));
}

/**
 * First guess at the plan and fact sheet, from what's already known: the client record, their platform site,
 * the Business Profile and the live home page. Ayush confirms or edits every field before it's used.
 */
export async function prefill(c: Client, cfg: SeoConfig): Promise<SeoConfig> {
  const out: SeoConfig = { ...cfg, facts: { ...cfg.facts }, country: cfg.country ?? c.country };
  const f = out.facts!;
  f.businessName ??= c.business_name ?? clientLabel(c);
  f.email ??= c.invoice_details?.businessEmail ?? undefined;
  f.address ??= c.invoice_details?.businessAddress ?? undefined;
  f.phone ??= c.invoice_details?.businessPhone ?? undefined;

  const site = await hostedSite(c.id).catch(() => null);
  if (site?.content) {
    const s = site.content;
    out.trade ??= s.trade;
    if (!out.services?.length) out.services = s.services.map((x) => x.name);
    if (!out.towns?.length) out.towns = [s.mainArea, ...s.areas].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
    f.phone ??= s.phone;
    f.yearsTrading ??= s.yearsTrading || undefined;
    if (!f.accreditations?.length) f.accreditations = s.accreditations;
    f.about ??= s.different || undefined;
  }
  if (cfg.gbpLocation) {
    try {
      const raw = await getLocation(cfg.gbpLocation);
      const p = summarise(raw);
      f.businessName ??= p.title;
      f.phone ??= p.phone;
      out.trade ??= p.primaryCategory?.replace(/ (contractor|service|company)$/i, "").toLowerCase();
      if (!out.towns?.length && p.serviceAreas?.length) out.towns = p.serviceAreas.map((a) => a.split(",")[0]);
      f.about ??= p.description;
      if (raw.latlng) Object.assign(out, { lat: raw.latlng.latitude, lng: raw.latlng.longitude });
    } catch {}
  }
  if (cfg.domain) {
    const g = await get(`https://${cfg.domain}`);
    if (g.status === 200) {
      const page = parseHtml(g.url, g.text);
      f.phone ??= page.tel[0];
      // Service pages often show in the main navigation: use their link text paths as a first guess.
      if (!out.services?.length) out.services = page.links.filter((l) => l !== "/" && !/contact|about|privacy|terms|gallery|blog|review|faq|area/.test(l) && l.split("/").length <= 3).slice(0, 8).map((l) => l.split("/").pop()!.replace(/-/g, " ").replace(/^\w/, (m) => m.toUpperCase()));
    }
  }
  if (!out.brandTerms?.length && f.businessName) out.brandTerms = [f.businessName.toLowerCase()];
  return out;
}
