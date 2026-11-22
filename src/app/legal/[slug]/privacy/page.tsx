import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandOf } from "@/lib/brand";
import { loadClientBySlug } from "@/lib/review-funnel";
import { LegalShell } from "../shell";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await loadClientBySlug((await params).slug);
  return { title: c ? `Privacy policy | ${brandOf(c).name}` : "Privacy policy" };
}

/** Each client's privacy policy, written for what the platform actually does with customer data and texts. */
export default async function Privacy({ params }: Props) {
  const c = await loadClientBySlug((await params).slug);
  if (!c) notFound();
  const b = brandOf(c);
  const updated = new Date(c.created_at).toLocaleDateString(c.country === "US" ? "en-US" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  return (
    <LegalShell brand={b} title="Privacy policy">
      <p className="text-sm text-neutral-500">Last updated {updated}</p>
      <p>This policy explains how {b.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects and uses your information when you call us, text us, request a quote or use our services.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Your name, phone number, email address and property address when you contact us or book a job.</li>
        <li>Records of calls and text messages between you and us.</li>
        <li>Details of quotes, invoices, appointments and feedback you give us.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To reply to you, including sending a text message if we miss your call.</li>
        <li>To provide quotes, book and carry out work, send invoices and take payment.</li>
        <li>To send appointment reminders and, after a job, a request for feedback or a review.</li>
      </ul>
      <h2>Text messages</h2>
      <p>
        If you call us and we can&apos;t answer, or after we complete a job for you, we may send you text messages about your enquiry or job. Message frequency varies. Message and data rates may apply. Reply STOP at any time to stop receiving texts, and HELP for help.
      </p>
      <p>
        <strong>We do not sell, rent or share your mobile number or text message consent with third parties or affiliates for marketing or promotional purposes.</strong> Information is only shared with the service providers who help us run our business (for example our phone, messaging and software providers), and only so they can provide that service to us.
      </p>
      <h2>How long we keep it</h2>
      <p>We keep your information for as long as we need it to provide our services and meet our legal and accounting obligations, then delete it.</p>
      <h2>Your rights</h2>
      <p>You can ask us for a copy of the information we hold about you, ask us to correct it, or ask us to delete it, by contacting us using the details below.</p>
    </LegalShell>
  );
}
