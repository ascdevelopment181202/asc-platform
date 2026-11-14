import type { SiteContent } from "@/lib/site-content";
import { EnquiryForm } from "./enquiry-form";
import { SectionTitle, wrap } from "./site-ui";

export function ContactSection({ siteId, c, defaultService }: { siteId: string; c: SiteContent; defaultService?: string }) {
  return (
    <section id="contact" className="scroll-mt-24 bg-slate-50 py-20">
      <div className={`${wrap} grid gap-12 lg:grid-cols-2`}>
        <div>
          <SectionTitle eyebrow="Get in touch" title="Get a free, no-obligation quote" intro="Tell us what you need and we'll get back to you quickly. Prefer to talk? Give us a call." />
          <a href={c.phoneHref} className="mt-8 block text-3xl font-bold text-[var(--brand)]">{c.phone}</a>
          {c.hours && <p className="mt-4 whitespace-pre-line text-slate-600">{c.hours}</p>}
          {c.emergency && <p className="mt-2 font-medium text-slate-800">Emergency call-outs available.</p>}
        </div>
        <EnquiryForm siteId={siteId} services={c.services.map((s) => s.name)} defaultService={defaultService} />
      </div>
    </section>
  );
}
