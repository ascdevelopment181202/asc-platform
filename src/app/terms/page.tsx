import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of service | ASC Development" };

const UPDATED = "23 November 2026";
const EMAIL = "ayush@ascdev.tech";

/** A paragraph is a string; a bullet list is an array of strings. */
type Block = string | string[];
type Section = { id: string; title: string; body: Block[] };

const SECTIONS: Section[] = [
  {
    id: "about",
    title: "1. About these terms",
    body: [
      "These terms are the agreement between ASC Development (\"we\", \"us\") and the business that signs up for our services (\"you\"). ASC Development is a trading name of Ayush Chavan, a sole trader based in England. You can contact us at " + EMAIL + ".",
      "You accept these terms when you tick the box at checkout, pay for any plan, or start using our services, whichever happens first. The agreement is made up of these terms, the plan you chose at checkout (its price, billing period and any free trial), and anything else we agree with you in writing, including by email.",
      "You confirm that you are signing up for the purposes of your business, and not as a consumer.",
    ],
  },
  {
    id: "services",
    title: "2. Our services",
    body: [
      "Depending on the plan you choose, our services can include:",
      [
        "designing, building and hosting your website",
        "setting up and managing your Google Business Profile",
        "local search engine optimisation (SEO) and optimisation for AI search tools",
        "a business phone number with missed-call text back",
        "automated review requests to your customers",
        "access to our client app (inbox, contacts, calendar, quotes and invoices)",
        "reports on your enquiries, reviews and search performance",
      ],
      "We may change the tools, suppliers and methods we use to deliver the services, as long as the overall service you receive is not materially reduced.",
      "Unless we agree otherwise in writing, the services do not include: money spent on advertising, managing paid adverts, printing, professional photography, domain registration and other third-party fees, legal or regulatory advice, or a full redesign of your website. We will quote separately for extra work.",
      "We use AI tools to help draft content and analyse performance. A person at ASC Development reviews what we publish for you, and you can ask us to change anything at any time.",
    ],
  },
  {
    id: "starting",
    title: "3. Getting started",
    body: [
      "After you sign up we will send you an onboarding form. We aim to have your website and core setup live within 48 hours of receiving a completed form and the access we ask for. This is a target, not a guarantee. Timescales move back if information, approvals or access are late or incomplete.",
      "Some setup depends on third parties, for example Google verifying a Business Profile or US phone carriers approving business texting. We will chase these, but we do not control how long they take.",
    ],
  },
  {
    id: "fees",
    title: "4. Fees and payment",
    body: [
      "You pay the price, at the billing interval, shown at checkout. Payments are taken in advance by card through Stripe and renew automatically until the agreement ends.",
      "If your plan includes a free trial, you will be charged automatically when the trial ends unless you cancel before then.",
      "If a payment fails, we will let you know and Stripe will try again. If it is still unpaid 7 days after it was due, we may pause the services until it is paid. If it is still unpaid 30 days after it was due, we may end the agreement.",
      "We are not currently registered for VAT. If that changes, VAT will be added to our prices at the applicable rate.",
      "We may change our prices by giving you at least 30 days' notice by email. If you do not accept the new price, you can cancel before it takes effect.",
      "Fees are not refundable, except under the Leads Guarantee in section 5 or where the law requires it.",
    ],
  },
  {
    id: "guarantee",
    title: "5. Our Leads Guarantee",
    body: [
      "If, in any full billing period after your website goes live, we record no Qualifying Leads for your business, we will refund the fee you paid for that period. For an annual plan, the refund is one twelfth of the annual fee for each full calendar month with no Qualifying Leads.",
      "A Qualifying Lead is a genuine enquiry from a potential new customer that reaches you through a channel we set up or manage for you, and that is recorded by our systems or in Google's data for your business. This includes calls to the business number we provide, calls and messages from your Google Business Profile, enquiry forms and call taps on your website, and missed calls answered by our text back. It does not include spam, sales calls, job applicants, existing customers, or repeat enquiries from the same person within 7 days. A lead counts whether or not it turns into a job.",
      "The guarantee applies only if, for the whole period:",
      [
        "your account was paid up to date",
        "you had completed onboarding and given us the access we asked for",
        "you had not removed our access, taken the website down, changed or stopped forwarding the phone number we set up, or asked us to pause or stop work",
        "you had not breached these terms",
      ],
      "To claim, email us within 14 days of the end of the period. We will check our records and, if the guarantee applies, refund you within 14 days. A refund under this section is your only remedy for a period without leads.",
    ],
  },
  {
    id: "ending",
    title: "6. Cancelling and ending the agreement",
    body: [
      "Monthly plans run month to month. You can cancel at any time by emailing us. Cancellation takes effect at the end of the billing period you have already paid for, and we do not refund part periods.",
      "Annual plans are a 12-month commitment paid in advance. They renew for another 12 months unless you cancel before the renewal date. Annual fees are not refundable part-way through the year, except under section 5 or if we end the agreement without cause.",
      "If you are on a free trial, you can cancel before it ends and you will not be charged.",
      "We can end the agreement by giving you 30 days' notice by email. We can end it immediately if you have not paid as set out in section 4, if you seriously or repeatedly breach these terms, or if you use our services for anything unlawful, abusive or misleading. If we end the agreement without cause part-way through a prepaid period, we will refund the unused part.",
    ],
  },
  {
    id: "after",
    title: "7. What happens when the agreement ends",
    body: [
      [
        "Google Business Profile: it stays yours. We will remove ourselves as a manager.",
        "Domain name: it stays yours. If we registered it on your behalf, we will transfer it to you on request once all fees are paid.",
        "Website: the website code, design and templates belong to us (see section 8), so we will take the hosted website down 14 days after the agreement ends. If you want to keep it, we can quote for a copy that you can host elsewhere.",
        "Business phone number: the number we set up is held in our account and service on it stops when the agreement ends. Where the carrier allows it, we will transfer the number to you on request, for a fee that covers our costs.",
        "Call forwarding: if you forward calls from your own phone to a number we provide, you must switch that forwarding off when the agreement ends. We are not responsible for calls missed after the end date.",
        "Your data: we will send you an export of your contacts and enquiries if you ask within 30 days of the end date. After that we will delete it, as set out in the Schedule.",
      ],
    ],
  },
  {
    id: "ownership",
    title: "8. Who owns what",
    body: [
      "You own your business name, logo, photos, reviews, Google Business Profile, domain name, and any content you give us. You give us permission to use that content to deliver the services.",
      "We own the ASC Platform, our software, website code, designs, templates, processes and know-how, including anything we create for you unless we agree otherwise in writing. While the agreement is active, we give you the right to use the website and other materials we create for your business.",
      "We may show your website and anonymised or headline results in our portfolio and case studies. If you would rather we did not, tell us by email and we will stop.",
    ],
  },
  {
    id: "you",
    title: "9. Your responsibilities",
    body: [
      "You agree to:",
      [
        "give us accurate and complete information, and tell us when it changes",
        "only give us content (photos, logos, text) that you own or have permission to use",
        "make sure claims about your business are true, including accreditations, insurance, guarantees, prices and reviews, and tell us if anything we publish is inaccurate",
        "give us the access we reasonably need, and not remove it while the agreement is active",
        "respond to the enquiries we send you within a reasonable time",
        "keep your client app and dashboard links private, as anyone with the link can open them",
        "comply with the laws that apply to your business",
      ],
    ],
  },
  {
    id: "texting",
    title: "10. Texts and messages to your customers",
    body: [
      "Our services can send texts and messages to your customers on your behalf, for example missed-call replies and review requests. You are the business those people have a relationship with, and you are responsible for having the right to contact them.",
      "You agree to:",
      [
        "only give us contact details for people who are your genuine customers or who have contacted you",
        "make sure you have a lawful basis to contact them, including under UK GDPR and the Privacy and Electronic Communications Regulations in the UK, and the Telephone Consumer Protection Act and carrier rules in the US",
        "not ask us to message anyone who has opted out",
        "take responsibility for any message wording you write or approve",
      ],
      "We include an opt-out in automated messages and stop messaging anyone who replies STOP. US business texting requires registration with the carriers using your accurate business details. Carriers may block or delay messages, and we are not responsible for that.",
    ],
  },
  {
    id: "google",
    title: "11. Google, reviews and results",
    body: [
      "We work within Google's guidelines. We will not create fake reviews, stuff keywords into your business name, list fake addresses or opening hours, or do anything else that risks your profile. You agree not to buy reviews, write reviews of your own business, or ask us to break Google's rules.",
      "Search rankings, map positions, AI search results and traffic depend on Google and other platforms, your competitors and many other things we do not control. Apart from the Leads Guarantee in section 5, we do not guarantee any particular ranking, number of calls, enquiries, jobs or revenue. Platforms can change their rules or suspend profiles at any time, and we are not responsible for their decisions.",
      "Figures in our reports and dashboards come from our own tracking and from third parties such as Google. They are provided in good faith and may differ from other tools.",
    ],
  },
  {
    id: "third",
    title: "12. Third-party services",
    body: [
      "Our services rely on third-party providers, including Google, Stripe, Twilio and phone carriers, Vercel, Supabase, Resend and Anthropic. We choose reputable providers, but we are not responsible for their outages, errors or changes. Some of their terms may also apply to you, for example Google's terms for your Business Profile.",
    ],
  },
  {
    id: "confidential",
    title: "13. Confidentiality",
    body: [
      "Each of us will keep the other's confidential information private and only use it for this agreement. This does not apply to information that is already public, or that the law requires us to share.",
    ],
  },
  {
    id: "data",
    title: "14. Data protection",
    body: [
      "When we handle personal data about your customers and enquirers to deliver the services, you are the controller and we are your processor. The Schedule below sets out how we handle that data and forms part of these terms. Our privacy policy at app.ascdev.tech/privacy explains how we handle data about you.",
    ],
  },
  {
    id: "liability",
    title: "15. Our liability to you",
    body: [
      "Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be limited by law.",
      "Otherwise, we are not liable for any loss of profit, revenue, jobs, business, goodwill or data, for missed calls or messages, or for any indirect or consequential loss, however it arises.",
      "Our total liability to you under or in connection with this agreement is limited to the fees you paid us in the 3 months before the event that gave rise to the claim.",
      "Except as set out in these terms, the services are provided without any other promises, conditions or warranties, to the extent the law allows.",
    ],
  },
  {
    id: "indemnity",
    title: "16. Your liability to us",
    body: [
      "You will cover our reasonable losses and costs from any claim made against us because of content you gave us, claims about your business that you asked us to publish, messages sent to contacts you gave us or asked us to message, or your breach of these terms or the law.",
    ],
  },
  {
    id: "events",
    title: "17. Events outside our control",
    body: [
      "We are not responsible for delays or failures caused by events outside our reasonable control, such as outages at our providers, carrier or platform decisions, cyber attacks, or extreme weather. We will tell you and do what we reasonably can to limit the impact.",
    ],
  },
  {
    id: "changes",
    title: "18. Changes to these terms",
    body: [
      "We may update these terms from time to time. We will email you at least 30 days before any change that affects you takes effect. If you do not agree, you can cancel before the change takes effect. If you carry on using the services after that, you accept the updated terms.",
    ],
  },
  {
    id: "general",
    title: "19. General",
    body: [
      [
        "Notices: we will contact you at the email address on your account. You can contact us at " + EMAIL + ".",
        "Whole agreement: the agreement described in section 1 replaces anything said or agreed before it.",
        "Transfer: you may not transfer the agreement without our written consent. We may transfer it to another business, for example if ASC Development is sold or incorporated, and we will tell you if we do.",
        "If a court decides any part of these terms is invalid, the rest still applies.",
        "If we do not enforce a right straight away, we can still enforce it later.",
        "Nobody else has a right to enforce these terms under the Contracts (Rights of Third Parties) Act 1999.",
        "These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction. This applies wherever your business is based.",
      ],
    ],
  },
];

const SCHEDULE: Section = {
  id: "schedule",
  title: "Schedule: data processing terms",
  body: [
    "This Schedule applies when we process personal data on your behalf under Article 28 of the UK GDPR.",
    [
      "Subject matter and duration: delivering the services, for as long as the agreement lasts and until the data is deleted under this Schedule.",
      "Nature and purpose: hosting and storing data, receiving and passing on enquiries, sending calls, texts and emails, requesting reviews, and producing reports.",
      "Types of personal data: names, phone numbers, email addresses, postal addresses and postcodes, enquiry and message content, call records, booking and job details, and review content.",
      "Categories of people: your customers, prospective customers and enquirers, and your staff.",
    ],
    "We will:",
    [
      "only process the data on your documented instructions, which include these terms and how you use our services, unless the law requires otherwise, in which case we will tell you unless the law prevents it",
      "make sure anyone who processes the data is under a duty of confidentiality",
      "take appropriate technical and organisational measures to keep the data secure",
      "only use the sub-processors listed below or added under this Schedule, under written terms that protect the data to the same standard",
      "help you, as far as we reasonably can, to respond to requests from people exercising their data protection rights",
      "help you meet your obligations on security, personal data breaches and data protection impact assessments",
      "tell you without undue delay, and in any case within 48 hours, after becoming aware of a personal data breach affecting your data",
      "at the end of the agreement, return the data to you if you ask within 30 days, then delete it, unless the law requires us to keep it",
      "give you the information you reasonably need to show compliance, and allow a reasonable audit once a year on 30 days' notice, at your cost",
      "tell you straight away if we think an instruction from you breaks data protection law",
    ],
    "Sub-processors we use:",
    [
      "Supabase: database and file storage",
      "Vercel: website and app hosting",
      "Twilio: phone numbers, calls and text messages",
      "Resend: email delivery",
      "Stripe: payments",
      "Anthropic: AI drafting and analysis",
      "Google: Business Profile and Search Console services",
    ],
    "Some of these providers process data outside the UK, including in the US and the EU. Where they do, we rely on UK adequacy regulations or appropriate safeguards such as the UK International Data Transfer Addendum.",
    "We will tell you by email before adding or replacing a sub-processor. If you object, you can end the agreement before the change takes effect.",
    "You are responsible for having a lawful basis for the personal data you give us or ask us to collect, and for giving the people concerned any privacy information the law requires.",
  ],
};

function Blocks({ body }: { body: Block[] }) {
  return (
    <>
      {body.map((b, i) =>
        typeof b === "string" ? (
          <p key={i}>{b}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 pl-5">
            {b.map((li) => (
              <li key={li}>{li}</li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-12 leading-relaxed text-neutral-800">
      <h1 className="text-2xl font-semibold">Terms of service</h1>
      <p className="text-sm text-neutral-500">ASC Development (ascdev.tech). Last updated {UPDATED}.</p>
      <p>Please read these terms carefully. They explain what we do for you, what we need from you, how payment and cancellation work, and the limits of our responsibility.</p>
      <nav aria-label="Contents" className="rounded-xl bg-neutral-50 p-4 text-sm">
        <ol className="grid gap-1 sm:grid-cols-2">
          {[...SECTIONS, SCHEDULE].map((s) => (
            <li key={s.id}>
              <a className="underline-offset-2 hover:underline" href={`#${s.id}`}>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {[...SECTIONS, SCHEDULE].map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-6 space-y-3 pt-4">
          <h2 className="text-lg font-semibold">{s.title}</h2>
          <Blocks body={s.body} />
        </section>
      ))}
      <p className="pt-6 text-sm text-neutral-500">Questions about these terms? Email {EMAIL}.</p>
    </main>
  );
}
