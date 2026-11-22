import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandOf } from "@/lib/brand";
import { loadFunnel } from "@/lib/review-funnel";
import { rate, sendFeedback } from "./actions";
import { ReviewFunnel } from "@/components/review-funnel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ step?: string; err?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadFunnel((await params).token);
  return { title: data ? `How did ${brandOf(data.c).name} do?` : "Review", robots: { index: false, follow: false } };
}

/** The page behind the link in every review text (one per job). */
export default async function ReviewPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { step, err } = await searchParams;
  const data = await loadFunnel(token);
  if (!data) notFound();
  const { job, c, customerName } = data;
  const brand = brandOf(c);
  const first = customerName?.trim().split(/\s+/)[0];
  const googleLink = c.google_review_url ? `/v/${token}/google` : null;
  const view = step === "thanks" || job.feedback_at ? "thanks" : step === "feedback" ? "feedback" : "rate";

  return (
    <ReviewFunnel
      brand={brand}
      first={first}
      view={view}
      err={!!err}
      id={["token", token]}
      rateAction={rate}
      feedbackAction={sendFeedback}
      googleLink={googleLink}
      sentFeedback={!!job.feedback_at}
      wentToGoogle={!!job.review_clicked_at}
    />
  );
}
