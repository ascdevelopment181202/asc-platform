import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { brandOf } from "@/lib/brand";
import { qrSvg } from "@/lib/qr";
import { loadClient } from "../../../data";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/** A4 sheet: 10 business-card-size review cards to leave with customers, and a large sticker for the van or shop. */
export default async function PrintCards({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ type?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const b = brandOf(c);
  const svg = await qrSvg(`${env.appUrl}/review/${c.review_slug}`);
  const sticker = sp.type === "sticker";

  return (
    <div className="min-h-dvh bg-neutral-200 print:bg-white">
      <style>{`@page{size:A4;margin:10mm}@media print{.no-print{display:none!important}}`}</style>
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-2 bg-white px-4 py-3 shadow">
        <a href={`/m/${token}/reviews`} className="text-sm text-[#2a78d6]">← Back</a>
        <div className="flex gap-2 text-sm">
          <a href="?type=cards" className={`rounded-full px-3 py-1.5 ${!sticker ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}>Cards</a>
          <a href="?type=sticker" className={`rounded-full px-3 py-1.5 ${sticker ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}>Sticker</a>
        </div>
        <PrintButton />
      </div>
      <div className="mx-auto my-6 w-[190mm] bg-white p-0 shadow print:my-0 print:shadow-none">
        {sticker ? (
          <div className="flex h-[277mm] flex-col items-center justify-center gap-6 p-10 text-center" style={{ border: `4mm solid ${b.color}` }}>
            <Logo logo={b.logo} name={b.name} cls="max-h-[30mm] max-w-[120mm]" />
            <p className="text-5xl font-extrabold leading-tight">Happy with our work?</p>
            <p className="text-2xl text-neutral-600">Scan to leave us a Google review</p>
            <div className="h-[110mm] w-[110mm]" dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="text-5xl tracking-widest text-amber-500">★★★★★</p>
            <p className="text-xl font-semibold">{[b.phone, b.website].filter(Boolean).join("  ·  ")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex h-[55mm] w-[95mm] items-center gap-4 border border-dashed border-neutral-300 p-4" style={{ borderLeft: `3mm solid ${b.color}` }}>
                <div className="h-[38mm] w-[38mm] shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />
                <div className="min-w-0 text-left">
                  <Logo logo={b.logo} name={b.name} cls="mb-1.5 max-h-[10mm] max-w-[40mm]" />
                  <p className="text-[13px] font-bold leading-tight">Thanks for choosing us!</p>
                  <p className="mt-1 text-[11px] leading-snug text-neutral-600">Scan to tell us how we did. It takes 30 seconds and really helps.</p>
                  <p className="mt-1.5 text-[14px] tracking-wider text-amber-500">★★★★★</p>
                  {b.phone && <p className="text-[11px] font-medium">{b.phone}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="no-print pb-8 text-center text-sm text-neutral-600">Print at 100% (no &ldquo;fit to page&rdquo;). Any printer or local print shop can do these.</p>
    </div>
  );
}

function Logo({ logo, name, cls }: { logo: string | null; name: string; cls: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return logo ? <img src={logo} alt={name} className={`${cls} object-contain`} /> : <p className="font-bold">{name}</p>;
}
