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

/**
 * The client's real Google reviews for the website's reviews section (kit "reviews").
 * Only 5 star reviews with a few words, newest first. Nothing shows until there are at least three.
 */
export async function siteReviews(clientId: string) {
  const [{ data: c }, { data: rows }] = await Promise.all([
    db().from("clients").select("google_rating, google_review_count").eq("id", clientId).maybeSingle<{ google_rating: number | null; google_review_count: number | null }>(),
    db()
      .from("google_reviews")
      .select("reviewer_name, comment, created_at")
      .eq("client_id", clientId)
      .eq("rating", 5)
      .not("comment", "is", null)
      .order("created_at", { ascending: false })
      .limit(40)
      .returns<{ reviewer_name: string | null; comment: string; created_at: string }[]>(),
  ]);
  const good = (rows ?? []).filter((r) => r.comment.trim().length >= 25).slice(0, 16);
  if (good.length < 3 || !c?.google_rating) return undefined;
  const short = (t: string) => (t.length > 260 ? `${t.slice(0, 257).replace(/\s+\S*$/, "")}…` : t);
  // Display name only as first name + initial, like most review widgets.
  const who = (n: string | null) => {
    const parts = (n ?? "").trim().split(/\s+/).filter(Boolean);
    return parts.length ? `${parts[0]}${parts[1] ? ` ${parts[1][0]}.` : ""}` : "Google user";
  };
  const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const cards = good.map((r) => ({ q: short(r.comment.trim()), n: who(r.reviewer_name), s: `Google review · ${when(r.created_at)}` }));
  const headline =
    good
      .map((r) => (r.comment.trim().match(/^[^.!?]+[.!?]/)?.[0] ?? r.comment).trim())
      .filter((t) => t.length >= 30 && t.length <= 120)
      .sort((a, b) => a.length - b.length)[0] ?? "Brilliant job from start to finish.";
  const rating = Number(c.google_rating);
  const count = c.google_review_count ?? good.length;
  const half = Math.ceil(cards.length / 2);
  return {
    quote: headline.replace(/^["“]|["”]$/g, ""),
    sub: `Rated ${rating.toFixed(1)} out of 5 from ${count} Google review${count === 1 ? "" : "s"}.`,
    plats: [{ n: "Google", v: rating.toFixed(1), dec: 1, stars: "★★★★★", small: `${count} reviews` }],
    rows: cards.length >= 6 ? [cards.slice(0, half), cards.slice(half)] : [cards],
  };
}
