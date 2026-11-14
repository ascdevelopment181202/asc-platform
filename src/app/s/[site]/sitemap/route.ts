import { allPaths } from "@/lib/seo-pages";
import { notFound, resolveSite } from "@/lib/site-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ site: string }> }) {
  const ctx = await resolveSite((await params).site);
  if (!ctx || ctx.preview) return notFound();
  const lastmod = ctx.site.updated_at.slice(0, 10);
  const urls = allPaths(ctx.site.content)
    .map((p) => `<url><loc>${ctx.origin}${p === "/" ? "/" : p}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, s-maxage=3600" },
  });
}
