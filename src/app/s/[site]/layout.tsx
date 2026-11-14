import type { CSSProperties } from "react";
import { loadSite } from "./data";
import { SiteFooter, SiteHeader } from "./site-ui";

export const dynamic = "force-dynamic";

export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ site: string }>;
}) {
  const { site: param } = await params;
  const { site, base, preview } = await loadSite(param);
  const c = site.content;

  return (
    <div style={{ "--brand": c.brandColor } as CSSProperties} className="min-h-screen bg-white text-slate-900">
      {preview && (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
          Preview: this site isn&apos;t published yet
        </div>
      )}
      <SiteHeader c={c} base={base} />
      {children}
      <SiteFooter c={c} base={base} />
      {/* Sticky call button on mobile */}
      <a
        href={c.phoneHref}
        className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-6 py-4 text-base font-semibold text-white shadow-xl sm:hidden"
      >
        <PhoneIcon /> Call {c.phone}
      </a>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}
