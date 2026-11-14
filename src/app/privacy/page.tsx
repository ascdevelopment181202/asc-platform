export const metadata = { title: "Privacy policy | ASC Development" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-12 text-neutral-800">
      <h1 className="text-2xl font-semibold">Privacy policy</h1>
      <p className="text-sm text-neutral-500">ASC Development (ascdev.tech). Last updated 14 November 2026.</p>
      <p>ASC Development builds and runs websites, local SEO and Google Business Profiles for small service businesses. This policy explains what we collect through the ASC Platform (app.ascdev.tech) and the client websites we host.</p>
      <h2 className="pt-2 text-lg font-semibold">What we collect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>From our clients: contact and business details, payment status from Stripe, and the answers, logo and photos sent in our onboarding form.</li>
        <li>From visitors to client websites: what they type into an enquiry form (such as name, phone, email, postcode and message), which we pass to the business they contacted.</li>
        <li>Anonymous visit counts: the page viewed, the day, and the type of site the visitor came from (for example a search engine). We do not use cookies for this and do not store IP addresses or build profiles of visitors.</li>
        <li>Google data: with a client&apos;s permission, we read their Google Search Console and Google Business Profile performance data (searches, positions, calls, views and direction requests) to show them in their reports and dashboard.</li>
      </ul>
      <h2 className="pt-2 text-lg font-semibold">How we use it</h2>
      <p>Only to deliver our service: building and hosting the website, sending enquiries to the business, and sending monthly reports. We do not sell data or use it for advertising.</p>
      <h2 className="pt-2 text-lg font-semibold">Google user data</h2>
      <p>Our use of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements. Google data is read only, used only to produce the client&apos;s own reports and dashboard, never shared with third parties, never used for advertising and never used to train AI models. You can remove our access at any time from your Google account&apos;s third-party connections page.</p>
      <h2 className="pt-2 text-lg font-semibold">Where it is kept</h2>
      <p>Data is stored with our processors Supabase (database and files), Vercel (hosting), Resend (email) and Stripe (payments). We keep client data while we work together and delete it on request after the contract ends.</p>
      <h2 className="pt-2 text-lg font-semibold">Your rights</h2>
      <p>Under UK GDPR you can ask to see, correct or delete your data. Email ayush@ascdev.tech and we will respond within 30 days.</p>
    </main>
  );
}
