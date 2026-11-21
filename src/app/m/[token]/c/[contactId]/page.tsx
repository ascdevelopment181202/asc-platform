import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayUk } from "@/lib/phone";
import type { Contact } from "@/lib/sms";
import { fullWhen, loadClient } from "../../data";
import { Avatar } from "../../ui";
import { AutoRefresh } from "../../auto-refresh";
import { ScrollToEnd } from "./scroll-to-end";
import { markUnread, sendMessage, toggleStar } from "../../actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string; contactId: string }>; searchParams: Promise<{ err?: string }> };

type Item =
  | { kind: "in"; at: string; body: string }
  | { kind: "out"; at: string; body: string; status: string; auto: string | null }
  | { kind: "call"; at: string; note: string }
  | { kind: "event"; at: string; note: string };

const AUTO_LABEL: Record<string, string> = { missed_call: "Auto-text after missed call", review: "Review request" };
const SKIP_NOTE: Record<string, string> = {
  repeat_caller: "called again",
  opted_out: "no text, opted out",
  sms_disabled: "no text, texts off",
  send_failed: "auto-text failed",
};

/** One conversation: every call, text and review event with this customer, plus a reply box. */
export default async function Thread({ params, searchParams }: Props) {
  const { token, contactId } = await params;
  const { err } = await searchParams;
  const c = await loadClient(token);
  if (!c || !/^[0-9a-f-]{36}$/.test(contactId)) notFound();
  const { data: contact } = await db().from("contacts").select("*").eq("id", contactId).eq("client_id", c.id).maybeSingle<Contact>();
  if (!contact) notFound();
  const tz = c.timezone || "Europe/London";

  const [{ data: calls }, { data: sent }, { data: replies }, { data: jobs }] = await Promise.all([
    db().from("calls").select("created_at, text_sent, skipped_reason").eq("contact_id", contact.id).returns<{ created_at: string; text_sent: boolean; skipped_reason: string | null }[]>(),
    db().from("sms_log").select("created_at, body, status, kind").eq("contact_id", contact.id).in("kind", ["missed_call", "review", "manual"]).returns<{ created_at: string; body: string; status: string; kind: string }[]>(),
    db().from("replies").select("created_at, body").eq("contact_id", contact.id).returns<{ created_at: string; body: string | null }[]>(),
    db().from("jobs").select("created_at, review_clicked_at").eq("contact_id", contact.id).returns<{ created_at: string; review_clicked_at: string | null }[]>(),
  ]);

  const items: Item[] = [
    ...(calls ?? []).map((x): Item => ({ kind: "call", at: x.created_at, note: x.text_sent ? "auto-text sent" : (SKIP_NOTE[x.skipped_reason ?? ""] ?? "") })),
    ...(sent ?? []).map((x): Item => ({ kind: "out", at: x.created_at, body: x.body, status: x.status, auto: AUTO_LABEL[x.kind] ?? null })),
    ...(replies ?? []).map((x): Item => ({ kind: "in", at: x.created_at, body: x.body ?? "" })),
    ...(jobs ?? []).flatMap((j): Item[] => [
      { kind: "event", at: j.created_at, note: "Job marked done, review request scheduled" },
      ...(j.review_clicked_at ? [{ kind: "event", at: j.review_clicked_at, note: "Opened the review link" } as Item] : []),
    ]),
  ].sort((a, b) => a.at.localeCompare(b.at));

  // "New" divider before the messages that were unread when they opened this, like GoHighLevel. Then mark read.
  const inboundIdx = items.map((it, i) => (it.kind === "in" || it.kind === "call" ? i : -1)).filter((i) => i >= 0);
  const newFrom = contact.unread_count > 0 ? inboundIdx[Math.max(0, inboundIdx.length - contact.unread_count)] : -1;
  if (contact.unread_count > 0) await db().from("contacts").update({ unread_count: 0 }).eq("id", contact.id);

  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz });
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });

  return (
    <div className="flex min-h-dvh flex-col">
      <AutoRefresh seconds={8} />
      <ScrollToEnd />
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-xl items-center gap-2 px-2 py-2">
          <Link href={`/m/${token}`} aria-label="Back to inbox" className="flex size-10 items-center justify-center rounded-full active:bg-neutral-100">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <Avatar name={contact.name} phone={contact.phone} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{contact.name ?? displayUk(contact.phone)}</p>
            <p className="truncate text-xs text-neutral-500">{contact.name ? displayUk(contact.phone) : "Customer"}{contact.opted_out_at ? " · opted out" : ""}</p>
          </div>
          <form action={toggleStar}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="contactId" value={contact.id} />
            <button aria-label={contact.starred ? "Unstar" : "Star"} className={`flex size-10 items-center justify-center rounded-full text-xl active:bg-neutral-100 ${contact.starred ? "text-amber-500" : "text-neutral-400"}`}>
              {contact.starred ? "★" : "☆"}
            </button>
          </form>
          <a href={`tel:${contact.phone}`} aria-label="Call" className="flex size-10 items-center justify-center rounded-full bg-green-600 text-white active:bg-green-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
            </svg>
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 space-y-2 px-3 py-4">
        {items.length === 0 && <p className="py-10 text-center text-sm text-neutral-500">No messages yet.</p>}
        {items.map((it, i) => {
          const showDay = i === 0 || day(items[i - 1].at) !== day(it.at);
          return (
            <div key={i}>
              {showDay && <p className="my-3 text-center text-xs font-medium text-neutral-500">{day(it.at)}</p>}
              {i === newFrom && (
                <div className="my-3 flex items-center gap-2 text-xs font-semibold text-red-500">
                  <span className="h-px flex-1 bg-red-300" />New<span className="h-px flex-1 bg-red-300" />
                </div>
              )}
              {it.kind === "in" && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 shadow-sm ring-1 ring-neutral-200">
                    <p className="whitespace-pre-wrap break-words text-[15px]">{it.body}</p>
                    <p className="mt-0.5 text-[11px] text-neutral-400">{time(it.at)}</p>
                  </div>
                </div>
              )}
              {it.kind === "out" && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[#2a78d6] px-3.5 py-2 text-white">
                    {it.auto && <p className="mb-0.5 text-[11px] font-medium text-blue-100">{it.auto}</p>}
                    <p className="whitespace-pre-wrap break-words text-[15px]">{it.body}</p>
                    <p className={`mt-0.5 text-right text-[11px] ${it.status === "failed" || it.status === "undelivered" ? "font-semibold text-red-200" : "text-blue-100"}`}>
                      {time(it.at)} · {it.status === "failed" || it.status === "undelivered" ? "Not delivered" : it.status === "delivered" ? "Delivered" : "Sent"}
                    </p>
                  </div>
                </div>
              )}
              {it.kind === "call" && (
                <p className="mx-auto w-fit rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700" title={fullWhen(it.at, tz)}>
                  ✆ Missed call · {time(it.at)}{it.note ? ` · ${it.note}` : ""}
                </p>
              )}
              {it.kind === "event" && (
                <p className="mx-auto w-fit rounded-full bg-neutral-200/70 px-3 py-1 text-xs text-neutral-600" title={fullWhen(it.at, tz)}>
                  ★ {it.note} · {time(it.at)}
                </p>
              )}
            </div>
          );
        })}
        <div className="flex justify-center pt-2">
          <form action={markUnread}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="contactId" value={contact.id} />
            <button className="text-xs text-neutral-500 underline">Mark as unread</button>
          </form>
        </div>
        <div id="end" />
      </main>

      <footer className="sticky bottom-0 border-t border-neutral-200 bg-white" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {err && <p className="mx-auto max-w-xl px-4 pt-2 text-sm text-red-700">{err}</p>}
        {contact.opted_out_at ? (
          <p className="mx-auto max-w-xl px-4 py-4 text-center text-sm text-neutral-500">This customer replied STOP, so you can&apos;t text them. You can still call.</p>
        ) : (
          <form action={sendMessage} className="mx-auto flex max-w-xl items-end gap-2 px-3 py-2">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="contactId" value={contact.id} />
            <textarea name="body" rows={1} required placeholder="Text message" className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-neutral-300 px-4 py-2.5 text-base" />
            <button aria-label="Send" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#2a78d6] text-white active:bg-[#1f62b3]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M3.4 20.4l17.4-7.5a1 1 0 0 0 0-1.8L3.4 3.6a1 1 0 0 0-1.4 1.2L4.3 12l-2.3 7.2a1 1 0 0 0 1.4 1.2z" />
              </svg>
            </button>
          </form>
        )}
      </footer>
    </div>
  );
}
