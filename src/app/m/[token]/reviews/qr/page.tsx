import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { brandOf } from "@/lib/brand";
import { qrSvg } from "@/lib/qr";
import { loadClient } from "../../data";

export const dynamic = "force-dynamic";

/** Full-screen QR to show the customer at the end of the job. They scan it and leave a review there and then. */
export default async function ReviewQr({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await loadClient(token);
  if (!c) notFound();
  const b = brandOf(c);
  const svg = await qrSvg(`${env.appUrl}/review/${c.review_slug}`);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-between bg-white px-6 py-8 text-center" style={{ paddingTop: "max(2rem, env(safe-area-inset-top))" }}>
      <Link href={`/m/${token}/reviews`} className="self-start text-sm text-[#2a78d6]">← Done</Link>
      <div className="flex w-full flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {b.logo ? <img src={b.logo} alt={b.name} className="mb-4 max-h-16 max-w-[220px] object-contain" /> : <p className="mb-4 text-2xl font-bold">{b.name}</p>}
        <p className="text-2xl font-bold leading-tight">How did we do?</p>
        <p className="mt-1 text-base text-neutral-600">Point your camera here to leave us a quick review</p>
        <div className="mt-6 aspect-square w-full max-w-[340px] rounded-3xl p-3" style={{ border: `6px solid ${b.color}` }} dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="mt-4 text-3xl tracking-widest text-amber-500">★★★★★</p>
      </div>
      <p className="text-sm text-neutral-500">Turn your screen brightness up if it won&apos;t scan.</p>
    </div>
  );
}
