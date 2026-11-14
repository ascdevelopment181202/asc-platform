/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { env } from "@/lib/env";
import { loadSite } from "./data";
import { ContactSection } from "./contact-section";
import { businessSchema, Hero, JsonLd, SectionTitle, ServiceGrid, Tick, wrap } from "./site-ui";

type Props = { params: Promise<{ site: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { site, preview } = await loadSite((await params).site);
  const c = site.content;
  return {
    title: c.seo.title,
    description: c.seo.description,
    robots: preview ? { index: false } : undefined,
    openGraph: { title: c.seo.title, description: c.seo.description, images: c.heroImage ? [c.heroImage] : undefined },
  };
}

export default async function SiteHome({ params }: Props) {
  const { site, base } = await loadSite((await params).site);
  const c = site.content;
  const url = site.domain && site.published ? `https://${site.domain}` : `${env.appUrl}/s/${site.slug}`;

  return (
    <main>
      <JsonLd data={businessSchema(c, url)} />
      <Hero c={c} title={c.headline} subtitle={c.subheadline} />

      <section id="services" className={`${wrap} scroll-mt-24 py-20`}>
        <SectionTitle eyebrow="Services" title={`What we do`} intro={`Everything you'd expect from a professional ${c.tradeNoun} in ${c.mainArea}.`} />
        <ServiceGrid services={c.services} base={base} />
      </section>

      <section className="bg-slate-50 py-20">
        <div className={`${wrap} grid items-center gap-12 lg:grid-cols-2`}>
          <div>
            <SectionTitle eyebrow="Why choose us" title={`A ${c.tradeNoun} you can rely on`} />
            {c.different && <p className="mt-5 text-lg text-slate-700">{c.different}</p>}
            <ul className="mt-6 space-y-3">
              {[
                "Clear, upfront prices before any work starts",
                "We turn up when we say we will",
                "Tidy work, and we clean up after ourselves",
                "All work guaranteed",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white"><Tick /></span>
                  <span className="text-slate-800">{t}</span>
                </li>
              ))}
            </ul>
            {c.reviewsLink && (
              <a href={c.reviewsLink} target="_blank" rel="noreferrer" className="mt-8 inline-block rounded-full border-2 border-[var(--brand)] px-6 py-3 font-semibold text-[var(--brand)] hover:bg-[var(--brand)] hover:text-white">
                Read our reviews
              </a>
            )}
          </div>
          {c.gallery[1] && (
            <img src={c.gallery[1]} alt={`Recent work by ${c.businessName}`} className="aspect-[4/3] w-full rounded-3xl object-cover shadow-xl" />
          )}
        </div>
      </section>

      {c.gallery.length > 2 && (
        <section className={`${wrap} py-20`}>
          <SectionTitle eyebrow="Our work" title="Recent jobs" />
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            {c.gallery.slice(2, 10).map((src, i) => (
              <img key={src} src={src} alt={`${c.businessName} job ${i + 1}`} loading="lazy" className="aspect-square w-full rounded-2xl object-cover" />
            ))}
          </div>
        </section>
      )}

      {c.areas.length > 0 && (
        <section id="areas" className="scroll-mt-24 bg-slate-900 py-20 text-white">
          <div className={wrap}>
            <h2 className="text-3xl font-bold tracking-tight">Areas we cover</h2>
            <p className="mt-3 text-slate-300">Based in {c.mainArea} and covering the surrounding area.</p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {c.areas.map((a) => (
                <li key={a} className="rounded-full bg-white/10 px-4 py-2 text-sm ring-1 ring-white/20">{a}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section id="faq" className={`${wrap} scroll-mt-24 py-20`}>
        <SectionTitle eyebrow="FAQs" title="Common questions" />
        <div className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200">
          {c.faqs.map((f) => (
            <details key={f.q} className="group p-6">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="flex items-center justify-between gap-4">{f.q}<span className="text-[var(--brand)] transition group-open:rotate-45">+</span></span>
              </summary>
              <p className="mt-3 text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: c.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
          }}
        />
      </section>

      <ContactSection siteId={site.id} c={c} />
    </main>
  );
}
