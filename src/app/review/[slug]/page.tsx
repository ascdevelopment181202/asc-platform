import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandOf } from "@/lib/brand";
import { loadClientBySlug } from "@/lib/review-funnel";
import { ReviewFunnel } from "@/components/review-funnel";
import { feedbackShared, rateShared } from "./actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ step?: string; err?: string; r?: string; sent?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await loadClientBySlug((await params).slug);
  return { title: c ? `How did ${brandOf(c).name} do?` : "Review", robots: { index: false, follow: false } };
}

/** Each client's shareable review page: for QR codes, WhatsApp, email signatures and past customers. */
export default async function SharedReviewPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { step, err, r, sent } = await searchParams;
  const c = await loadClientBySlug(slug);
  if (!c) notFound();
  const rating = Number(r);
  // The rating rides along to the feedback form so it's saved with the message.
  async function feedbackWithRating(f: FormData) {
    "use server";
    if (rating >= 1 && rating <= 5) f.set("rating", String(rating));
    await feedbackShared(f);
  }
  return (
    <ReviewFunnel
      brand={brandOf(c)}
      view={step === "thanks" ? "thanks" : step === "feedback" ? "feedback" : "rate"}
      err={!!err}
      id={["slug", slug]}
      rateAction={rateShared}
      feedbackAction={feedbackWithRating}
      googleLink={c.google_review_url ? `/review/${slug}/google` : null}
      askContact
      sentFeedback={!!sent}
    />
  );
}
