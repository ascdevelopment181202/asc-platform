import type { Brand } from "@/lib/brand";

/** Plain branded page for a client's privacy policy and SMS terms. */
export function LegalShell({ brand, title, children }: { brand: Brand; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f4f5f7] px-4 py-8 text-neutral-900">
      <main className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="h-2" style={{ backgroundColor: brand.color }} />
        <div className="space-y-4 p-6 text-[15px] leading-relaxed sm:p-10 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
          {brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo} alt={brand.name} className="max-h-14 max-w-[200px] object-contain" />
          ) : (
            <p className="text-xl font-bold">{brand.name}</p>
          )}
          <h1 className="text-2xl font-bold">{title}</h1>
          {children}
          <h2>Contact us</h2>
          <p>
            {brand.name}
            {brand.address && <><br />{brand.address}</>}
            {brand.phone && <><br />Phone: {brand.phone}</>}
            {brand.email && <><br />Email: {brand.email}</>}
          </p>
        </div>
      </main>
    </div>
  );
}
