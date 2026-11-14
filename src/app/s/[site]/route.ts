import { env } from "@/lib/env";
import { findSite } from "@/lib/sites";
import { toKitSite } from "@/lib/kit-site";
import { businessSchema } from "./schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** Client homepage, rendered with the asc-site-kit design (public/kit). */
export async function GET(_request: Request, { params }: { params: Promise<{ site: string }> }) {
  const key = decodeURIComponent((await params).site);
  const site = await findSite(key);
  const viaDomain = !!site && key.toLowerCase().replace(/^www\./, "") !== site.slug;
  if (!site || (viaDomain && !site.published)) return new Response("Not found", { status: 404 });

  const base = viaDomain ? "" : `/s/${site.slug}`;
  const preview = !site.published;
  const c = site.content;
  const url = site.domain && site.published ? `https://${site.domain}` : `${env.appUrl}/s/${site.slug}`;
  const kit = toKitSite(c, { siteId: site.id, base, preview });
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  const html = `<!doctype html>
<html lang="en-GB">
<head>
<script>document.documentElement.classList.add("js")</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${preview ? '<meta name="robots" content="noindex, nofollow">' : ""}
<title>${esc(c.seo.title)}</title>
<meta name="description" content="${esc(c.seo.description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(c.seo.title)}">
<meta property="og:description" content="${esc(c.seo.description)}">
${c.heroImage ? `<meta property="og:image" content="${esc(c.heroImage)}">` : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/kit/kit.css">
<script type="application/ld+json">${json(businessSchema(c, url))}</script>
<script type="application/ld+json">${json(faq)}</script>
</head>
<body>
<noscript><h1>${esc(c.headline)}</h1><p>${esc(c.subheadline)}</p><p>Call <a href="${esc(c.phoneHref)}">${esc(c.phone)}</a></p></noscript>
<script>window.SITE=${json(kit)};</script>
<script src="/kit/kit.js"></script>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
