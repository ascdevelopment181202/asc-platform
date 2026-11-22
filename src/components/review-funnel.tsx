import type { Brand } from "@/lib/brand";

const STAR_WORDS = ["Poor", "Not great", "OK", "Good", "Excellent"];

type Props = {
  brand: Brand;
  first?: string | null;
  view: "rate" | "feedback" | "thanks";
  err?: boolean;
  /** Hidden field that identifies the page to the actions: ["token", v] or ["slug", v]. */
  id: [string, string];
  rateAction: (f: FormData) => Promise<void>;
  feedbackAction: (f: FormData) => Promise<void>;
  googleLink: string | null;
  /** The shareable page doesn't know who the customer is, so it asks for a name and number. */
  askContact?: boolean;
  sentFeedback?: boolean;
  wentToGoogle?: boolean;
};

/**
 * The review page customers see. A star rating first: 4 or 5 stars go straight to Google, 1 to 3 stars tell
 * the business privately what went wrong. The Google link stays visible on every step, so nobody is stopped
 * from posting a public review (UK CMA rules on review gating).
 */
export function ReviewFunnel({ brand, first, view, err, id, rateAction, feedbackAction, googleLink, askContact, sentFeedback, wentToGoogle }: Props) {
  const hidden = <input type="hidden" name={id[0]} value={id[1]} />;
  return (
    <div className="min-h-dvh bg-[#f4f5f7] px-4 py-8 text-neutral-900">
      <main className="mx-auto max-w-md overflow-hidden rounded-3xl bg-white shadow-sm">
        <div className="h-2" style={{ backgroundColor: brand.color }} />
        <div className="p-6 text-center sm:p-8">
          {brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo} alt={brand.name} className="mx-auto mb-4 max-h-16 max-w-[220px] object-contain" />
          ) : (
            <p className="mb-4 text-xl font-bold">{brand.name}</p>
          )}

          {view === "rate" && (
            <>
              <h1 className="text-2xl font-bold">{first ? `Hi ${first}, how did we do?` : "How did we do?"}</h1>
              <p className="mt-2 text-neutral-600">Tap a star to rate your experience with {brand.name}.</p>
              <form action={rateAction} className="mt-6 flex justify-center gap-1.5">
                {hidden}
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} name="rating" value={n} aria-label={`${n} star${n > 1 ? "s" : ""}: ${STAR_WORDS[n - 1]}`} className="group flex flex-col items-center rounded-xl px-1.5 py-2 active:scale-95">
                    <svg viewBox="0 0 24 24" className="h-12 w-12 fill-neutral-200 transition-colors group-hover:fill-[#f5b301]" aria-hidden>
                      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
                    </svg>
                    <span className="mt-1 text-[11px] text-neutral-500">{n}</span>
                  </button>
                ))}
              </form>
              {googleLink && (
                <a href={googleLink} className="mt-6 inline-block text-sm text-neutral-500 underline">
                  Or go straight to Google to leave a review
                </a>
              )}
            </>
          )}

          {view === "feedback" && (
            <>
              <h1 className="text-2xl font-bold">Sorry it wasn&apos;t perfect</h1>
              <p className="mt-2 text-neutral-600">Tell {brand.name} what went wrong and they&apos;ll get back to you to put it right.</p>
              <form action={feedbackAction} className="mt-5 space-y-3 text-left">
                {hidden}
                {askContact && (
                  <>
                    <input name="name" required placeholder="Your name" className="w-full rounded-xl border border-neutral-300 p-3 text-base outline-none focus:border-neutral-500" />
                    <input name="phone" type="tel" inputMode="tel" placeholder="Your phone number (so they can call you back)" className="w-full rounded-xl border border-neutral-300 p-3 text-base outline-none focus:border-neutral-500" />
                  </>
                )}
                <textarea
                  name="message"
                  rows={5}
                  required
                  placeholder="What could we have done better?"
                  className="w-full rounded-xl border border-neutral-300 p-3 text-base outline-none focus:border-neutral-500"
                />
                {err && <p className="text-sm text-red-600">Please write a few words first.</p>}
                <button className="w-full rounded-xl px-4 py-3.5 text-lg font-semibold" style={{ backgroundColor: brand.color, color: brand.onColor }}>
                  Send to {brand.name}
                </button>
              </form>
              {googleLink && (
                <p className="mt-5 text-sm text-neutral-500">
                  Prefer to post publicly?{" "}
                  <a href={googleLink} className="underline">
                    Leave a Google review
                  </a>
                </p>
              )}
            </>
          )}

          {view === "thanks" && (
            <>
              <h1 className="text-2xl font-bold">Thank you{first ? `, ${first}` : ""}</h1>
              <p className="mt-2 text-neutral-600">
                {sentFeedback ? `${brand.name} has your message and will be in touch soon.` : `Thanks for choosing ${brand.name}.`}
              </p>
              {brand.phone && (
                <a href={`tel:${brand.phone.replace(/[^\d+]/g, "")}`} className="mt-5 inline-block rounded-xl px-5 py-3 font-semibold ring-1 ring-neutral-300">
                  Call {brand.phone}
                </a>
              )}
              {googleLink && !wentToGoogle && (
                <p className="mt-5 text-sm text-neutral-500">
                  <a href={googleLink} className="underline">
                    Leave a Google review
                  </a>
                </p>
              )}
            </>
          )}
        </div>
      </main>
      <p className="mt-4 text-center text-xs text-neutral-400">Powered by ASC Development</p>
    </div>
  );
}
