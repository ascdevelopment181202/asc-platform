import { notFound, resolveSite } from "@/lib/site-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ site: string }> }) {
  const ctx = await resolveSite((await params).site);
  if (!ctx) return notFound();
  const body = ctx.preview ? "User-agent: *\nDisallow: /\n" : `User-agent: *\nAllow: /\n\nSitemap: ${ctx.origin}/sitemap.xml\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
