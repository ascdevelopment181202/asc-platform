import "server-only";
import { businessSchema } from "./site-schema";
import type { SeoPage } from "./seo-pages";
import { breadcrumbSchema, faqSchema, innerKit, notFound, renderHtml, resolveSite, withStoredCopy, type SiteCtx } from "./site-render";

/** Shared handler for service, area and service-in-area pages. */
export async function renderSeoPage(siteParam: string, build: (ctx: SiteCtx) => SeoPage | null) {
  const ctx = await resolveSite(siteParam);
  if (!ctx) return notFound();
  const template = build(ctx);
  if (!template) return notFound();
  const page = await withStoredCopy(ctx, template);
  const c = ctx.site.content;
  const url = `${ctx.origin}${page.path}`;

  const jsonld: unknown[] = [
    businessSchema(c, ctx.origin),
    breadcrumbSchema(ctx, page.crumbs, page.path),
    faqSchema(page.faqs),
  ];
  if (page.service) {
    jsonld.push({
      "@context": "https://schema.org",
      "@type": "Service",
      name: page.service.name,
      serviceType: page.service.name,
      url,
      areaServed: page.area ? { "@type": "Place", name: page.area } : c.areas.map((a) => ({ "@type": "Place", name: a })),
      provider: { "@type": c.schemaType, name: c.businessName, telephone: c.phone, url: ctx.origin },
    });
  }

  return renderHtml(ctx, {
    path: page.path,
    title: page.title,
    description: page.description,
    h1: page.h1,
    lead: page.heroP,
    kit: innerKit(ctx, page),
    jsonld,
  });
}
