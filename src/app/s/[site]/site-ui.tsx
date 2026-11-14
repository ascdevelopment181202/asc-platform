/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { SiteContent, SiteService } from "@/lib/site-content";

export const wrap = "mx-auto w-full max-w-6xl px-5";

export function SiteHeader({ c, base }: { c: SiteContent; base: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      {c.emergency && (
        <div className="bg-slate-900 text-white">
          <div className={`${wrap} flex items-center justify-between py-1.5 text-xs`}>
            <span>Emergency call-outs available</span>
            <a href={c.phoneHref} className="font-semibold">{c.phone}</a>
          </div>
        </div>
      )}
      <div className={`${wrap} flex items-center justify-between gap-4 py-3`}>
        <Link href={base || "/"} className="flex items-center gap-3">
          {c.logoUrl ? (
            <img src={c.logoUrl} alt={c.businessName} className="h-11 w-auto max-w-[160px] object-contain" />
          ) : (
            <span className="text-lg font-bold tracking-tight">{c.businessName}</span>
          )}
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-700 md:flex">
          <a href={`${base}/#services`} className="hover:text-[var(--brand)]">Services</a>
          <a href={`${base}/#areas`} className="hover:text-[var(--brand)]">Areas</a>
          <a href={`${base}/#faq`} className="hover:text-[var(--brand)]">FAQs</a>
          <a href={`${base}/#contact`} className="hover:text-[var(--brand)]">Contact</a>
        </nav>
        <a
          href={c.phoneHref}
          className="hidden rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 sm:inline-block"
        >
          Call {c.phone}
        </a>
      </div>
    </header>
  );
}

export function SiteFooter({ c, base }: { c: SiteContent; base: string }) {
  return (
    <footer className="mt-20 bg-slate-950 pb-24 pt-14 text-slate-300 sm:pb-14">
      <div className={`${wrap} grid gap-10 sm:grid-cols-3`}>
        <div>
          <p className="text-lg font-semibold text-white">{c.businessName}</p>
          <p className="mt-2 text-sm">Trusted {c.tradeNoun} in {c.mainArea}.</p>
          {c.accreditations.length > 0 && <p className="mt-3 text-sm">{c.accreditations.join(" · ")}</p>}
        </div>
        <div>
          <p className="font-semibold text-white">Services</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {c.services.slice(0, 8).map((s) => (
              <li key={s.slug}>
                <Link href={`${base}/services/${s.slug}`} className="hover:text-white">{s.name}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="text-sm">
          <p className="font-semibold text-white">Contact</p>
          <p className="mt-3"><a href={c.phoneHref} className="hover:text-white">{c.phone}</a></p>
          {c.email && <p className="mt-1"><a href={`mailto:${c.email}`} className="hover:text-white">{c.email}</a></p>}
          {c.hours && <p className="mt-3 whitespace-pre-line">{c.hours}</p>}
        </div>
      </div>
      <div className={`${wrap} mt-10 border-t border-slate-800 pt-6 text-xs text-slate-500`}>
        © {new Date().getFullYear()} {c.businessName}. All rights reserved.
      </div>
    </footer>
  );
}

export function Hero({ c, title, subtitle }: { c: SiteContent; title: string; subtitle: string }) {
  return (
    <section className="relative isolate overflow-hidden bg-slate-900 text-white">
      {c.heroImage && <img src={c.heroImage} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-40" />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950/90 via-slate-950/70 to-slate-950/20" />
      <div className={`${wrap} py-20 sm:py-28`}>
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-5 text-lg text-slate-200">{subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={c.phoneHref} className="rounded-full bg-[var(--brand)] px-7 py-3.5 font-semibold text-white hover:opacity-90">
              Call {c.phone}
            </a>
            <a href="#contact" className="rounded-full bg-white px-7 py-3.5 font-semibold text-slate-900 hover:bg-slate-100">
              Get a free quote
            </a>
          </div>
          <TrustChips c={c} />
        </div>
      </div>
    </section>
  );
}

function TrustChips({ c }: { c: SiteContent }) {
  const chips = [
    c.yearsTrading && `${c.yearsTrading} years' experience`,
    ...c.accreditations.slice(0, 2),
    c.emergency && "Emergency call-outs",
    "Free quotes",
  ].filter(Boolean) as string[];
  return (
    <ul className="mt-8 flex flex-wrap gap-2">
      {chips.map((t) => (
        <li key={t} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white ring-1 ring-white/20">
          <Tick /> {t}
        </li>
      ))}
    </ul>
  );
}

export function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ServiceGrid({ services, base, exclude }: { services: SiteService[]; base: string; exclude?: string }) {
  const list = services.filter((s) => s.slug !== exclude);
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((s) => (
        <Link
          key={s.slug}
          href={`${base}/services/${s.slug}`}
          className="group rounded-2xl border border-slate-200 p-6 transition hover:border-[var(--brand)] hover:shadow-lg"
        >
          <h3 className="text-lg font-semibold group-hover:text-[var(--brand)]">{s.name}</h3>
          <p className="mt-2 text-sm text-slate-600">{s.summary}</p>
          <span className="mt-4 inline-block text-sm font-semibold text-[var(--brand)]">Find out more →</span>
        </Link>
      ))}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, intro }: { eyebrow?: string; title: string; intro?: string }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-[var(--brand)]">{eyebrow}</p>}
      <h2 className="mt-2 text-3xl font-bold tracking-tight">{title}</h2>
      {intro && <p className="mt-3 text-slate-600">{intro}</p>}
    </div>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

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
