// Reading a site's HTML the way a search engine or AI crawler does (no JavaScript), and what's missing.
// Pure functions: fetching lives in crawl.ts.
import type { ActionType, Confidence, Draft, Effort, Finding, SeoConfig } from "./types";
import { valueOf } from "./value";

export const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Google-Extended", "Bingbot", "Applebot"];

export type PageAudit = {
  url: string;
  path: string;
  status: number;
  title: string;
  description: string;
  h1: string[];
  words: number;
  noindex: boolean;
  schemaTypes: string[];
  sameAs: string[];
  tel: string[];
  hasForm: boolean;
  faqHeadings: number;
  imgs: number;
  imgsNoAlt: number;
  links: string[]; // internal paths
  hasTracking: boolean;
  hasCta: boolean;
  hasReviews: boolean;
  text: string; // first 600 characters of visible text
};

export type SiteAudit = {
  pages: PageAudit[];
  robots: string | null;
  llms: boolean;
  sitemapFound: boolean;
  broken: { from: string; to: string }[];
  botWall: string[]; // crawlers that got an error page while a normal browser got the site
};

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const strip = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>|<!--[\s\S]*?-->/gi, " ").replace(/<[^>]+>/g, " "));
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((v) => v !== undefined) ?? "");
export const digits = (s: string) => s.replace(/\D/g, "").replace(/^(44|1)/, "").replace(/^0/, "");

function schemaOf(html: string): { types: string[]; sameAs: string[] } {
  const types: string[] = [];
  const sameAs: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const t = o["@type"];
    if (typeof t === "string") types.push(t);
    else if (Array.isArray(t)) types.push(...t.filter((x): x is string => typeof x === "string"));
    if (Array.isArray(o.sameAs)) sameAs.push(...o.sameAs.filter((x): x is string => typeof x === "string"));
    else if (typeof o.sameAs === "string") sameAs.push(o.sameAs);
    Object.values(o).forEach(walk);
  };
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]));
    } catch {}
  }
  return { types, sameAs };
}

export function parseHtml(url: string, html: string, status = 200): PageAudit {
  const u = new URL(url);
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? html;
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (name: string) => attr(metas.find((t) => new RegExp(`(name|property)\\s*=\\s*["']${name}["']`, "i").test(t)) ?? "", "content");
  const text = strip(html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html);
  const s = schemaOf(html);
  const links = new Set<string>();
  const tel: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    const href = decode(m[1]);
    if (/^tel:/i.test(href)) tel.push(href.slice(4));
    else if (!/^(mailto:|sms:|javascript:|#|whatsapp:)/i.test(href)) {
      try {
        const t = new URL(href, url);
        if (t.hostname.replace(/^www\./, "") === u.hostname.replace(/^www\./, "") && !/\.(png|jpe?g|webp|gif|svg|pdf|ico|css|js|xml|txt)$/i.test(t.pathname)) links.add(t.pathname.replace(/\/$/, "") || "/");
      } catch {}
    }
  }
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const headings = [...html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>|<summary[^>]*>([\s\S]*?)<\/summary>/gi)].map((m) => strip(m[1] ?? m[2] ?? ""));
  return {
    url,
    path: u.pathname.replace(/\/$/, "") || "/",
    status,
    title: decode(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    description: meta("description"),
    h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1])).filter(Boolean),
    words: text ? text.split(/\s+/).length : 0,
    noindex: /noindex/i.test(meta("robots")),
    schemaTypes: s.types,
    sameAs: s.sameAs,
    tel,
    hasForm: /<form\b/i.test(html),
    faqHeadings: headings.filter((h) => h.endsWith("?")).length,
    imgs: imgs.length,
    imgsNoAlt: imgs.filter((t) => !attr(t, "alt")).length,
    links: [...links],
    hasTracking: /seo-t\.js|\/api\/seo\/t|\/api\/track/.test(html),
    hasCta: /get a (free )?quote|free quote|call (us|now|today)|book (now|online|a)|request a|contact us|get in touch|enquir/i.test(text),
    hasReviews: /review|testimonial|★|⭐|rated \d|checkatrade|trustpilot/i.test(text),
    text: text.slice(0, 600),
  };
}

/** Which crawlers robots.txt shuts out of the whole site. */
export function blockedByRobots(robots: string | null, bots = AI_BOTS): string[] {
  if (!robots) return [];
  const groups: { agents: string[]; disallowAll: boolean; allowAll: boolean }[] = [];
  let cur: { agents: string[]; disallowAll: boolean; allowAll: boolean } | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallowAll: false, allowAll: false };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (k === "disallow" && v === "/") cur.disallowAll = true;
      if (k === "allow" && v === "/") cur.allowAll = true;
    }
  }
  const star = groups.find((g) => g.agents.includes("*"));
  return bots.filter((bot) => {
    const own = groups.find((g) => g.agents.includes(bot.toLowerCase()));
    const g = own ?? star;
    return !!g && g.disallowAll && !g.allowAll;
  });
}

export const sitemapsInRobots = (robots: string | null) => [...(robots ?? "").matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);

// ---------- What the fixes look like (written from the fact sheet, never invented) ----------

export function localBusinessSchema(cfg: SeoConfig): string {
  const f = cfg.facts ?? {};
  const sameAs = Object.values(cfg.profiles ?? {}).filter(Boolean);
  const o: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: f.businessName,
    url: cfg.domain ? `https://${cfg.domain}` : undefined,
    telephone: f.phone,
    email: f.email,
    address: f.address ? { "@type": "PostalAddress", streetAddress: f.address, addressCountry: cfg.country ?? "GB" } : undefined,
    areaServed: (cfg.towns ?? []).length ? (cfg.towns ?? []).map((t) => ({ "@type": "City", name: t })) : undefined,
    makesOffer: (cfg.services ?? []).length ? (cfg.services ?? []).map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s } })) : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
  };
  return `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
}

export function llmsTxt(cfg: SeoConfig, pages: PageAudit[]): string {
  const f = cfg.facts ?? {};
  const base = `https://${cfg.domain}`;
  const lines = [`# ${f.businessName ?? cfg.domain}`, ""];
  const where = (cfg.towns ?? []).slice(0, 12).join(", ");
  lines.push(`> ${f.businessName ?? "This business"} provides ${(cfg.services ?? []).slice(0, 8).join(", ").toLowerCase() || "local services"}${where ? ` in ${where}` : ""}.`, "");
  const facts = [f.phone && `Phone: ${f.phone}`, f.email && `Email: ${f.email}`, f.address && `Address: ${f.address}`, f.yearsTrading && `Trading: ${f.yearsTrading}`, f.accreditations?.length && `Accreditations: ${f.accreditations.join(", ")}`, f.guarantees && `Guarantee: ${f.guarantees}`, f.priceRanges && `Prices: ${f.priceRanges}`].filter(Boolean);
  if (facts.length) lines.push("## Key facts", "", ...facts.map((x) => `- ${x}`), "");
  if ((cfg.services ?? []).length) lines.push("## Services", "", ...(cfg.services ?? []).map((s) => `- ${s}`), "");
  if (where) lines.push("## Areas covered", "", ...(cfg.towns ?? []).map((t) => `- ${t}`), "");
  const listed = pages.filter((p) => p.status === 200 && !p.noindex).slice(0, 30);
  if (listed.length) lines.push("## Pages", "", ...listed.map((p) => `- [${p.title || p.path}](${base}${p.path === "/" ? "" : p.path})${p.description ? `: ${p.description}` : ""}`), "");
  return lines.join("\n");
}

export function robotsTxt(domain: string): string {
  return ["User-agent: *", "Allow: /", "", ...AI_BOTS.flatMap((b) => [`User-agent: ${b}`, "Allow: /", ""]), `Sitemap: https://${domain}/sitemap.xml`, ""].join("\n");
}

export function sitemapXml(domain: string, paths: string[]): string {
  const urls = [...new Set(paths)].map((p) => `  <url><loc>https://${domain}${p === "/" ? "/" : p}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const trackingSnippet = (appUrl: string, token: string) => `<script defer src="${appUrl}/seo-t.js" data-t="${token}"></script>`;

// ---------- Findings ----------

function tech(
  cfg: SeoConfig,
  kind: string,
  type: ActionType,
  dedupe: string,
  summary: string,
  why: string,
  gain: { clicks?: number; calls?: number },
  o: { confidence?: Confidence; effort?: Effort; alert?: boolean; autoOk?: boolean; draft?: Draft; page?: string; numbers?: { label: string; value: string }[]; assume?: string },
): Finding {
  const v = valueOf(gain, cfg, o.assume ? [{ label: o.assume, value: "estimate", assumed: true }] : undefined);
  const page = o.page ?? o.draft?.page;
  return {
    kind,
    type,
    dedupe,
    summary,
    detail: {
      evidence: { why, numbers: o.numbers, page },
      gain: { ...gain, gbp: Math.round(v.gbp) },
      chain: v.chain,
      confidence: o.confidence ?? "Medium",
      effort: o.effort ?? "1 click",
      risk: "Low",
      undoable: true,
      autoOk: o.autoOk,
      alert: o.alert,
      links: page && cfg.domain ? [{ label: "Live page", url: `https://${cfg.domain}${page === "/" ? "" : page}` }] : undefined,
    },
    draft: o.draft,
  };
}

export function detectOnSite(cfg: SeoConfig, a: SiteAudit, opts: { monthlyClicks: number; appUrl: string; trackingToken: string }): Finding[] {
  const out: Finding[] = [];
  const pages = a.pages.filter((p) => p.status === 200);
  const home = pages.find((p) => p.path === "/");
  const visits = Math.max(opts.monthlyClicks, 60); // search clicks understate visits; never assume less than 60 a month
  const domain = cfg.domain ?? "";
  if (!home) return out;

  const blocked = blockedByRobots(a.robots);
  if (blocked.length) {
    out.push(tech(cfg, "robots_ai", "AI search", "robots_ai", `Unblock ${blocked.length} crawler${blocked.length === 1 ? "" : "s"} in robots.txt so AI search and Bing can read the site.`, `robots.txt tells ${blocked.join(", ")} to stay out. A crawler that can't read the site can't recommend the business.`, { clicks: visits * 0.05 }, { alert: true, confidence: "High", draft: { target: "site", files: [{ path: "robots.txt", content: robotsTxt(domain) }] }, assume: "AI and Bing visitors regained" }));
  }
  if (a.botWall.length) {
    out.push(tech(cfg, "bot_wall", "AI search", "bot_wall", `The site's bot protection is turning away ${a.botWall.join(", ")}.`, `A normal browser gets the site, but these crawlers get an error or a challenge page. That usually means Vercel or Cloudflare bot protection is on.`, { clicks: visits * 0.05 }, {
      alert: true, confidence: "High", effort: "5 min manual",
      draft: { target: "manual", minutes: 5, steps: [{ text: "Open the site's Vercel project, then Firewall.", url: "https://vercel.com/dashboard" }, { text: "Under Bot Management, set AI bots to Allow (or turn off the challenge for known bots)." }, { text: "If the domain runs through Cloudflare: Security, Bots, then turn off 'Block AI bots'." }, { text: "Press Mark done. The autopilot re-checks tomorrow morning." }] },
      assume: "AI and Bing visitors regained",
    }));
  }
  if (home.words < 80 || (cfg.facts?.phone && !home.tel.length && !digits(home.text).includes(digits(cfg.facts.phone).slice(-7)) && home.words < 200)) {
    out.push(tech(cfg, "no_js_content", "AI search", "no_js_content", "The home page's content only appears after scripts run, so AI crawlers see an almost empty page.", `Fetched without JavaScript, the home page has ${home.words} words of text. Most AI crawlers don't run JavaScript, so the services, prices and phone number are invisible to them.`, { clicks: visits * 0.08 }, { alert: true, confidence: "High", effort: "30 min manual", draft: { target: "site", page: "/", needsAi: true }, assume: "AI and search visibility regained" }));
  }
  if (!a.llms) {
    out.push(tech(cfg, "llms_txt", "AI search", "llms_txt", "Add an llms.txt file: a plain summary of the business for AI tools.", "The site has no /llms.txt. It gives AI tools the facts (services, areas, phone, prices) in one clean file, written from the fact sheet.", { clicks: visits * 0.01 }, { confidence: "Low", draft: { target: "site", files: [{ path: "llms.txt", content: llmsTxt(cfg, pages) }] }, assume: "Small lift in AI mentions" }));
  }
  if (!a.sitemapFound) {
    out.push(tech(cfg, "sitemap", "Technical", "sitemap", "Add a sitemap so Google and Bing find every page.", `No sitemap.xml was found. The site has ${pages.length} pages that search engines currently have to discover by following links.`, { clicks: visits * 0.02 }, { draft: { target: "site", files: [{ path: "sitemap.xml", content: sitemapXml(domain, pages.filter((p) => !p.noindex).map((p) => p.path)) }, ...(a.robots && !blocked.length ? [] : [{ path: "robots.txt", content: robotsTxt(domain) }])] }, assume: "Pages found and indexed sooner" }));
  } else if (a.robots !== null && !sitemapsInRobots(a.robots).length) {
    out.push(tech(cfg, "sitemap_robots", "Technical", "sitemap_robots", "List the sitemap in robots.txt.", "The sitemap exists but robots.txt doesn't point to it, so Bing and AI crawlers may not find it.", { clicks: visits * 0.005 }, { confidence: "Low", draft: { target: "site", files: [{ path: "robots.txt", content: `${a.robots.trim()}\n\nSitemap: https://${domain}/sitemap.xml\n` }] } }));
  }

  const isLocal = (t: string) => /LocalBusiness|Contractor|Plumber|Electrician|Roofing|HomeAndConstruction|ProfessionalService|HVAC|Locksmith|MovingCompany|HousePainter/i.test(t);
  if (!home.schemaTypes.some(isLocal)) {
    out.push(tech(cfg, "schema_local", "Technical", "schema_local", "Add business schema to the home page so Google and AI tools read the name, phone, services and areas.", "The home page has no LocalBusiness structured data. It's the machine-readable version of the business details, and ties the site to its other profiles.", { clicks: visits * 0.02 }, { autoOk: true, draft: { target: "site", page: "/", html: localBusinessSchema(cfg), note: cfg.facts?.confirmed ? undefined : "Written from the fact sheet, which isn't confirmed yet: check it first." }, assume: "Richer results and clearer entity" }));
  } else {
    const want = Object.values(cfg.profiles ?? {}).filter(Boolean);
    const missing = want.filter((u) => !home.sameAs.some((s) => s.replace(/\/$/, "") === u.replace(/\/$/, "")));
    if (missing.length) out.push(tech(cfg, "schema_sameas", "AI search", "schema_sameas", `Link ${missing.length} profile${missing.length === 1 ? "" : "s"} in the site's business schema so Google and AI tools tie them together.`, `The schema doesn't list: ${missing.join(", ")}.`, { clicks: visits * 0.005 }, { confidence: "Low", autoOk: true, draft: { target: "site", page: "/", html: localBusinessSchema(cfg) } }));
  }

  if (!home.tel.length) {
    out.push(tech(cfg, "phone_click", "Technical", "phone_click", "Make the phone number tappable at the top of the home page.", "There is no tap-to-call link on the home page. On a phone, people have to copy the number by hand, and many don't bother.", { calls: Math.max(1, visits * 0.01) }, { confidence: "High", draft: { target: "site", page: "/", needsAi: true }, assume: "About 1 in 100 visitors calls when it's one tap" }));
  } else if (cfg.facts?.phone && !home.tel.some((t) => digits(t).slice(-9) === digits(cfg.facts!.phone!).slice(-9))) {
    out.push(tech(cfg, "nap_mismatch", "Technical", "nap_mismatch", "The phone number on the site doesn't match the fact sheet.", `The site links to ${home.tel[0]} but the fact sheet says ${cfg.facts.phone}. Mismatched details confuse Google and AI tools. If the site is right, fix the fact sheet in Settings.`, { clicks: visits * 0.01 }, { effort: "5 min manual", confidence: "Medium", draft: { target: "manual", minutes: 2, steps: [{ text: `Check which number is right: ${home.tel[0]} (site) or ${cfg.facts.phone} (fact sheet).` }, { text: "If the fact sheet is wrong, correct it under Settings and press Mark done." }, { text: "If the site is wrong, dismiss this and the autopilot will raise the site fix." }] } }));
  }
  if (!home.hasCta) out.push(tech(cfg, "no_cta", "Technical", "no_cta", "Add a clear call to action (\"Get a free quote\") near the top of the home page.", "No quote, call or contact prompt was found in the home page text. Visitors need telling what to do next.", { calls: Math.max(0.5, visits * 0.005) }, { draft: { target: "site", page: "/", needsAi: true }, assume: "About 1 in 200 visitors enquires more" }));
  if (!pages.some((p) => p.hasReviews)) out.push(tech(cfg, "no_reviews_shown", "Technical", "no_reviews_shown", "Show customer reviews on the site.", "No reviews or testimonials were found on any page. Reviews on the page are one of the strongest reasons a visitor calls.", { calls: Math.max(0.5, visits * 0.005) }, { confidence: "Medium", draft: { target: "site", page: "/", needsAi: true }, assume: "About 1 in 200 visitors enquires more" }));
  if (!home.hasTracking) {
    out.push(tech(cfg, "tracking", "Technical", "tracking", "Add the tracking script so calls, forms and AI visits are counted.", "The site has no tracking script, so the Results tab can't show taps on the call button, form enquiries or visits from ChatGPT and other AI tools. It's a few KB, uses no cookies and collects no personal data.", {}, { confidence: "High", draft: { target: "site", page: "*", html: trackingSnippet(opts.appUrl, opts.trackingToken) } }));
  }

  // Titles and descriptions.
  const titles = new Map<string, string[]>();
  for (const p of pages) if (p.title) titles.set(p.title, [...(titles.get(p.title) ?? []), p.path]);
  const metaIssues = pages.filter((p) => !p.noindex).map((p) => {
    const issues: string[] = [];
    if (!p.title) issues.push("no title");
    else if (p.title.length > 65) issues.push(`title is ${p.title.length} characters (Google cuts it at about 60)`);
    else if (p.title.length < 20) issues.push("title is very short");
    if ((titles.get(p.title)?.length ?? 0) > 1) issues.push(`same title as ${titles.get(p.title)!.filter((x) => x !== p.path).slice(0, 2).join(", ")}`);
    if (!p.description) issues.push("no description");
    else if (p.description.length > 165) issues.push(`description is ${p.description.length} characters (cut at about 155)`);
    return { p, issues };
  }).filter((x) => x.issues.length);
  for (const { p, issues } of metaIssues.slice(0, 5)) {
    out.push(tech(cfg, "meta_fix", "Page", `title_rewrite:${p.path}`, `Fix the ${p.path === "/" ? "home" : p.path.replace(/^\//, "").replace(/[-/]+/g, " ")} page's title and description: ${issues[0]}.`, `Problems found on this page: ${issues.join("; ")}.`, { clicks: Math.max(1, visits * 0.01) }, { autoOk: true, page: p.path, numbers: [{ label: "Title now", value: p.title || "(none)" }, { label: "Description now", value: p.description || "(none)" }], draft: { target: "site", page: p.path, needsAi: true }, assume: "A clearer result earns more clicks" }));
  }
  const noH1 = pages.filter((p) => !p.h1.length && !p.noindex);
  if (noH1.length) out.push(tech(cfg, "h1_missing", "Page", "h1_missing", `${noH1.length} page${noH1.length === 1 ? " has" : "s have"} no main heading.`, `Pages without an H1 heading: ${noH1.slice(0, 8).map((p) => p.path).join(", ")}. The main heading tells Google what the page is about.`, { clicks: Math.max(1, visits * 0.005 * noH1.length) }, { confidence: "Low", draft: { target: "site", page: noH1[0].path, needsAi: true } }));
  if (a.broken.length) out.push(tech(cfg, "broken_links", "Technical", "broken_links", `Fix ${a.broken.length} broken link${a.broken.length === 1 ? "" : "s"} on the site.`, `These links lead to missing pages: ${a.broken.slice(0, 6).map((b) => `${b.from} → ${b.to}`).join("; ")}.`, { clicks: Math.max(1, a.broken.length) }, { numbers: a.broken.slice(0, 8).map((b) => ({ label: b.from, value: b.to })), draft: { target: "site", page: a.broken[0].from, needsAi: true } }));
  const noAlt = pages.reduce((n, p) => n + p.imgsNoAlt, 0);
  if (noAlt >= 3) out.push(tech(cfg, "alt_text", "Page", "alt_text", `Describe ${noAlt} images (alt text) with the service and town.`, `${noAlt} images have no description. Alt text helps Google Images and AI tools understand job photos, and is needed for accessibility.`, { clicks: Math.max(1, visits * 0.005) }, { confidence: "Low", draft: { target: "site", page: pages.find((p) => p.imgsNoAlt)?.path ?? "/", needsAi: true } }));
  const faq = pages.find((p) => p.faqHeadings >= 3 && !p.schemaTypes.includes("FAQPage"));
  if (faq) out.push(tech(cfg, "faq_schema", "AI search", `faq_schema:${faq.path}`, `Mark up the questions on the ${faq.path === "/" ? "home" : faq.path.replace(/^\//, "")} page as FAQs.`, `The page has ${faq.faqHeadings} question headings but no FAQ structured data, so Google and AI tools can't lift the answers cleanly.`, { clicks: Math.max(1, visits * 0.01) }, { autoOk: true, confidence: "Medium", draft: { target: "site", page: faq.path, needsAi: true } }));
  const thin = pages.filter((p) => p.words < 150 && !p.noindex && !/contact|privacy|terms|thank|cookie/.test(p.path));
  if (thin.length) out.push(tech(cfg, "thin_pages", "Content", "thin_pages", `${thin.length} page${thin.length === 1 ? " is" : "s are"} too thin to rank.`, `Pages with under 150 words: ${thin.slice(0, 8).map((p) => `${p.path} (${p.words})`).join(", ")}.`, { clicks: Math.max(1, thin.length * 2) }, { confidence: "Low", draft: { target: "site", page: thin[0].path, needsAi: true } }));
  return out;
}
