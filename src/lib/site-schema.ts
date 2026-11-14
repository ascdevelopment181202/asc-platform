import type { SiteContent } from "@/lib/site-content";

export function businessSchema(c: SiteContent, url: string) {
  return {
    "@context": "https://schema.org",
    "@type": c.schemaType,
    name: c.businessName,
    url,
    telephone: c.phone,
    email: c.email || undefined,
    image: c.heroImage ?? c.logoUrl ?? undefined,
    logo: c.logoUrl ?? undefined,
    address: c.address ? { "@type": "PostalAddress", streetAddress: c.address } : undefined,
    areaServed: c.areas.map((a) => ({ "@type": "Place", name: a })),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `${c.trade} services`,
      itemListElement: c.services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.name } })),
    },
  };
}
