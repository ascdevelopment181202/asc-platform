import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClient } from "../data";
import { startConversation } from "../actions";

export const dynamic = "force-dynamic";

/** The + button: start a text conversation with a customer. */
export default async function NewMessage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string }> }) {
  const { token } = await params;
  const { err } = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-xl items-center gap-2 px-2 py-2">
          <Link href={`/m/${token}`} className="rounded-full px-3 py-2 text-[#2a78d6] active:bg-neutral-100">Cancel</Link>
          <h1 className="flex-1 text-center font-semibold">New message</h1>
          <span className="w-16" />
        </div>
      </header>
      <main className="mx-auto max-w-xl p-4">
        {err && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900" role="alert">{err}</p>}
        <form action={startConversation} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <input type="hidden" name="token" value={token} />
          <label className="block text-sm font-medium">
            {c.country === "US" ? "Cell number" : "Mobile number"}
            <input name="phone" type="tel" inputMode="tel" required autoFocus placeholder={c.country === "US" ? "(214) 555-0123" : "07..."} className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-3 text-base font-normal" />
          </label>
          <label className="block text-sm font-medium">
            Name (optional)
            <input name="name" placeholder="Customer's name" className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-3 text-base font-normal" />
          </label>
          <label className="block text-sm font-medium">
            Message
            <textarea name="body" rows={4} required placeholder="Hi, it's ..." className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-3 text-base font-normal" />
          </label>
          <button className="w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-base font-semibold text-white active:bg-[#1f62b3]">Send text</button>
          <p className="text-xs text-neutral-500">Sent from your business number. Replies come back to your inbox.</p>
        </form>
      </main>
    </>
  );
}
