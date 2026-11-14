import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { loadSite } from "../../data";
import { ContactSection } from "../../contact-section";
import { Hero, JsonLd, SectionTitle, ServiceGrid, wrap } from "../../site-ui";

type Props = { params: Promise<{ site: string; service: string }> };

async function load(params: Props["params"]) {
  const p = await params;
  const { site, base, preview } = await loadSite(p.site);
  const service = site.content.services.find((s) => s.slug === p.service);
  if (!service) notFound();
  return { site, base, preview, service };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site, service, preview } = await load(params);
  const c = site.content;
  const title = `${service.name} in ${c.mainArea} | ${c.businessName}`.slice(0, 65);
  const description = `${service.summary} Call ${c.businessName} on ${c.phone} for a free quote.`.slice(0, 158);
  return { title, description, robots: preview ? { index: false } : undefined };
}

export default async function ServicePage({ params }: Props) {
  const { site, base, service } = await load(params);
  const c = site.content;
  const url = site.domain && site.published ? `https://${site.domain}` : `${env.appUrl}/s/${site.slug}`;

  return (
    <main>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: service.name,
          serviceType: service.name,
          areaServed: c.areas.map((a) => ({ "@type": "Place", name: a })),
          provider: { "@type": c.schemaType, name: c.businessName, telephone: c.phone, url },
        }}
      />
      <Hero c={c} title={`${service.name} in ${c.mainArea}`} subtitle={service.summary} />

      <section className={`${wrap} grid gap-12 py-20 lg:grid-cols-3`}>
        <div className="lg:col-span-2">
          <nav className="text-sm text-slate-500">
            <Link href={base || "/"} className="hover:underline">Home</Link> / <span>{service.name}</span>
          </nav>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">{service.name} you can trust</h2>
          {service.body.map((p) => (
            <p key={p} className="mt-4 text-lg leading-relaxed text-slate-700">{p}</p>
          ))}
          {c.different && <p className="mt-4 text-lg leading-relaxed text-slate-700">{c.different}</p>}
        </div>
        <aside className="h-fit rounded-2xl bg-slate-900 p-6 text-white">
          <p className="text-lg font-semibold">Need {service.name.toLowerCase()}?</p>
          <p className="mt-2 text-sm text-slate-300">Call now for a free, no-obligation quote.</p>
          <a href={c.phoneHref} className="mt-5 block rounded-full bg-[var(--brand)] px-5 py-3 text-center font-semibold">Call {c.phone}</a>
          {c.areas.length > 0 && <p className="mt-5 text-sm text-slate-300">Covering {c.areas.slice(0, 6).join(", ")}{c.areas.length > 6 ? " and more" : ""}.</p>}
        </aside>
      </section>

      {c.services.length > 1 && (
        <section className={`${wrap} pb-8`}>
          <SectionTitle title="Other services" />
          <ServiceGrid services={c.services} base={base} exclude={service.slug} />
        </section>
      )}

      <ContactSection siteId={site.id} c={c} defaultService={service.name} />
    </main>
  );
}
