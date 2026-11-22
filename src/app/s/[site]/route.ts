import { toKitSite } from "@/lib/kit-site";
import { businessSchema } from "@/lib/site-schema";
import { faqSchema, notFound, renderHtml, resolveSite, siteReviews } from "@/lib/site-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client homepage, rendered with the asc-site-kit design (public/kit). */
export async function GET(_req: Request, { params }: { params: Promise<{ site: string }> }) {
  const ctx = await resolveSite((await params).site);
  if (!ctx) return notFound();
  const c = ctx.site.content;
  const reviews = await siteReviews(ctx.site.client_id).catch(() => undefined);
  return renderHtml(ctx, {
    path: "/",
    title: c.seo.title,
    description: c.seo.description,
    h1: c.headline,
    lead: c.subheadline,
    kit: { ...toKitSite(c, { siteId: ctx.site.id, base: ctx.base, preview: ctx.preview }), home: ctx.base || "/", faqs: c.faqs, reviews },
    jsonld: [businessSchema(c, ctx.origin), faqSchema(c.faqs)],
  });
}
