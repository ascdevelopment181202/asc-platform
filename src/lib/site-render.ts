import "server-only";
import { env } from "./env";
import { db } from "./supabase";
import { findSite, type Site } from "./sites";
import { toKitSite, type KitSite } from "./kit-site";
import type { SeoPage } from "./seo-pages";
import type { SeoCopy } from "./seo-ai";

export type SiteCtx = { site: Site; base: string; preview: boolean; origin: string };

/** Resolves a /s/[site] param (slug or custom domain). Drafts only show on the slug URL. */
export async function resolveSite(param: string): Promise<SiteCtx | null> {
  const key = decodeURIComponent(param).toLowerCase().replace(/^www\./, "");
  const site = await findSite(key);
  if (!site) return null;
  const viaDomain = key !== site.slug;
  if (viaDomain && !site.published) return null;
  const origin = site.domain && site.published ? `https://${site.domain}` : `${env.appUrl}/s/${site.slug}`;
  return { site, base: viaDomain ? "" : `/s/${site.slug}`, preview: !site.published, origin };
}

/** Applies AI-written copy (if any) over the template copy for a page. */
export async function withStoredCopy(ctx: SiteCtx, page: SeoPage): Promise<SeoPage> {
  const { data } = await db()
    .from("seo_pages")
    .select("content")
    .eq("site_id", ctx.site.id)
    .eq("path", page.path)
    .maybeSingle<{ content: SeoCopy }>();
  return data ? { ...page, ...data.content } : page;
}

const prefix = (base: string, path: string) => (path.startsWith("/") ? `${base}${path}` : path) || "/";

/** Kit data for an inner page: same design and data as the homepage, different hero and body. */
export function innerKit(ctx: SiteCtx, page: SeoPage): KitSite {
  const c = ctx.site.content;
  const kit = toKitSite(c, { siteId: ctx.site.id, base: ctx.base, preview: ctx.preview }) as Record<string, unknown> & {
    services: { cards: { t: string }[]; title: string; intro: string; extras: unknown[] };
    quote: { options: string[] };
  };
  const svcName = page.service?.name;
  return {
    ...kit,
    home: ctx.base || "/",
    hero: { h1: page.h1, p: page.heroP, cta: "Get a free quote" },
    mosaic: page.service ? rotate(c.gallery, c.services.findIndex((s) => s.slug === page.service!.slug) + 1) : c.gallery,
    prose: {
      title: page.proseTitle,
      paras: page.paras,
      crumbs: page.crumbs.map(([t, h]) => [t, h === null ? null : prefix(ctx.base, h || "/")]),
      links: page.links.map(([t, h]) => [t, prefix(ctx.base, h)]),
      linksTitle: page.linksTitle,
    },
    faqs: page.faqs,
    services: {
      ...kit.services,
      title: svcName ? "Other services" : "What we do",
      cards: kit.services.cards.filter((card) => card.t !== svcName),
      extras: [],
    },
    work: {},
    story: undefined,
    quote: { ...kit.quote, options: svcName ? [svcName, ...kit.quote.options.filter((o) => o !== svcName)] : kit.quote.options },
  };
}

function rotate<T>(arr: T[], n: number) {
  if (!arr.length) return arr;
  const k = ((n % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function renderHtml(ctx: SiteCtx, opts: { path: string; title: string; description: string; h1: string; lead: string; kit: KitSite; jsonld: unknown[] }) {
  const c = ctx.site.content;
  const canonical = `${ctx.origin}${opts.path === "/" ? "" : opts.path}`;
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<script>document.documentElement.classList.add("js")</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${ctx.preview ? '<meta name="robots" content="noindex, nofollow">' : ""}
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(canonical)}">
${c.heroImage ? `<meta property="og:image" content="${esc(c.heroImage)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/kit/kit.css">
${opts.jsonld.map((j) => `<script type="application/ld+json">${json(j)}</script>`).join("\n")}
</head>
<body>
<noscript><h1>${esc(opts.h1)}</h1><p>${esc(opts.lead)}</p><p>Call <a href="${esc(c.phoneHref)}">${esc(c.phone)}</a></p></noscript>
<script>window.SITE=${json(opts.kit)};</script>
<script src="/kit/kit.js"></script>
${ctx.preview ? "" : trackScript(ctx.site.id, opts.path)}
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}

/** Counts the visit and taps on the phone number. Skipped on drafts. */
function trackScript(siteId: string, path: string) {
  const d = json({ s: siteId, p: path });
  return `<script>(function(){if(navigator.webdriver)return;var d=${d};function t(k){try{var b=JSON.stringify({s:d.s,p:d.p,k:k,r:document.referrer});navigator.sendBeacon?navigator.sendBeacon("/api/track",b):fetch("/api/track",{method:"POST",body:b,keepalive:true})}catch(e){}}t("view");document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest('a[href^="tel:"]');if(a)t("call")},true)})();</script>`;
}

export const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

export function faqSchema(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function breadcrumbSchema(ctx: SiteCtx, crumbs: [string, string | null][], path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map(([name, href], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: href === null ? `${ctx.origin}${path}` : `${ctx.origin}${href && href !== "/" ? href : ""}`,
    })),
  };
}
