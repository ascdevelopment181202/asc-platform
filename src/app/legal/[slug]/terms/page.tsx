import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandOf } from "@/lib/brand";
import { loadClientBySlug } from "@/lib/review-funnel";
import { LegalShell } from "../shell";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await loadClientBySlug((await params).slug);
  return { title: c ? `Text message terms | ${brandOf(c).name}` : "Text message terms" };
}

/** Each client's SMS terms, with the wording US carriers check for during A2P registration. */
export default async function Terms({ params }: Props) {
  const c = await loadClientBySlug((await params).slug);
  if (!c) notFound();
  const b = brandOf(c);
  return (
    <LegalShell brand={b} title="Text message terms">
      <p>These terms cover text messages (SMS) sent by {b.name}.</p>
      <h2>What you&apos;ll receive</h2>
      <ul>
        <li>A text reply if you call us and we miss your call.</li>
        <li>Replies to messages you send us about your enquiry, quote or job.</li>
        <li>Appointment reminders, quotes and invoices you&apos;ve asked for.</li>
        <li>After a completed job, a request for feedback or a review (no more than three).</li>
      </ul>
      <p>We don&apos;t send marketing or promotional texts.</p>
      <h2>How you agree to receive them</h2>
      <p>You agree to receive these texts by calling or texting {b.name}{b.phone ? ` (${b.phone})` : ""}, or by giving us your number when you request a quote or book a job.</p>
      <h2>Frequency and cost</h2>
      <p>Message frequency varies depending on your enquiry. Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</p>
      <h2>Stopping texts and help</h2>
      <p>
        Reply <strong>STOP</strong> to any message to stop receiving texts. You&apos;ll get one message confirming you&apos;ve been unsubscribed and won&apos;t receive any more. Reply <strong>START</strong> to opt back in. Reply <strong>HELP</strong> for help, or contact us using the details below.
      </p>
      <h2>Privacy</h2>
      <p>
        We do not sell, rent or share your mobile number or text message consent with third parties for marketing. See our <a className="underline" href={`/legal/${c.review_slug}/privacy`}>privacy policy</a>.
      </p>
    </LegalShell>
  );
}
