import { notFound } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { env } from "@/lib/env";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboarding | ASC Development", robots: { index: false } };

export default async function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) notFound();

  const { data: client } = await db()
    .from("clients")
    .select("*")
    .eq("onboarding_token", token)
    .maybeSingle<Client>();
  if (!client) notFound();

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm font-medium text-blue-700">ASC Development</p>
        {client.form_submitted_at ? (
          <Done bookingUrl={env.bookingUrl} />
        ) : (
          <>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Let&apos;s get you set up</h1>
            <p className="mt-3 text-neutral-600">
              This takes about 10 minutes. Your 48-hour build starts the moment you press submit.
            </p>
            <OnboardingForm
              token={token}
              supabaseUrl={env.supabaseUrl}
              supabaseAnonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}
              managerEmail={env.adminEmail}
              defaults={{
                businessName: client.business_name ?? "",
                contactName: client.full_name ?? "",
                mobile: client.phone ?? "",
                email: client.email,
              }}
            />
          </>
        )}
      </div>
    </main>
  );
}

function Done({ bookingUrl }: { bookingUrl: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-8">
      <h1 className="text-2xl font-semibold">Thanks, we&apos;ve got everything</h1>
      <p className="mt-3 text-neutral-600">
        Your build has started and you&apos;ll be live within 48 hours. We&apos;ve emailed you a confirmation.
      </p>
      <p className="mt-3 text-neutral-600">
        Haven&apos;t booked your onboarding call yet?{" "}
        <a className="font-medium text-blue-700 underline" href={bookingUrl}>
          Grab a 20-minute slot
        </a>
        .
      </p>
    </div>
  );
}
