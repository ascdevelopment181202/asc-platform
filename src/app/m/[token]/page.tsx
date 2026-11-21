import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import type { Contact } from "@/lib/sms";
import { daysAgoIso, loadClient, shortWhen, unreadTotal } from "./data";
import { AppShell, Avatar, Flash } from "./ui";
import { AutoRefresh } from "./auto-refresh";
import { NotificationsToggle } from "./notifications";
import { vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "unread", label: "Unread" },
  { key: "recent", label: "Recent" },
  { key: "starred", label: "Starred" },
  { key: "all", label: "All" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ tab?: string; q?: string; ok?: string; err?: string }> };

/** Conversations list: one row per customer, newest first, like GoHighLevel's Conversations tab. */
export default async function Inbox({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();

  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "recent";
  const q = (sp.q ?? "").trim();
  const tz = c.timezone || "Europe/London";

  let query = db().from("contacts").select("*").eq("client_id", c.id).not("last_message_at", "is", null);
  if (tab === "unread") query = query.gt("unread_count", 0);
  if (tab === "starred") query = query.eq("starred", true);
  if (tab === "recent") query = query.gte("last_message_at", daysAgoIso(30));
  if (q) {
    const digits = q.replace(/\D/g, "").replace(/^0/, "");
    const safe = q.replace(/[%,()]/g, "");
    query = digits.length >= 3 ? query.or(`name.ilike.%${safe}%,phone.ilike.%${digits}%`) : query.ilike("name", `%${safe}%`);
  }
  const [{ data: rows }, unread, publicKey] = await Promise.all([
    query.order("last_message_at", { ascending: false }).limit(100).returns<Contact[]>(),
    unreadTotal(c.id),
    vapidPublicKey(),
  ]);
  const contacts = rows ?? [];

  const tabHref = (key: TabKey) => `/m/${token}?tab=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <AppShell
      token={token}
      active="inbox"
      unread={unread}
      title="Conversations"
      action={
        <Link href={`/m/${token}/new`} aria-label="New message" className="flex size-10 items-center justify-center rounded-full bg-[#2a78d6] text-white shadow-sm active:bg-[#1f62b3]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Link>
      }
    >
      <AutoRefresh seconds={10} />
      <Flash ok={sp.ok} err={sp.err} />
      <NotificationsToggle token={token} publicKey={publicKey} compact />

      <div className="sticky top-[61px] z-10 space-y-2 bg-[#f4f5f7] px-4 pb-2 pt-3">
        <form action={`/m/${token}`} className="relative">
          <input type="hidden" name="tab" value={tab} />
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input name="q" defaultValue={q} placeholder="Search name or number" className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-10 pr-3 text-base" />
        </form>
        <div className="flex gap-1.5 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${tab === t.key ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200"}`}
            >
              {t.label}
              {t.key === "unread" && unread > 0 ? ` (${unread})` : ""}
            </Link>
          ))}
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="px-6 py-16 text-center text-sm text-neutral-500">
          {q ? "No conversations match that search." : tab === "unread" ? "You're all caught up." : tab === "starred" ? "Tap the star in a conversation to keep it here." : "No conversations yet. Missed calls and customer texts will show up here."}
        </div>
      ) : (
        <ul className="mt-1 divide-y divide-neutral-100 bg-white">
          {contacts.map((ct) => {
            const isUnread = ct.unread_count > 0;
            return (
              <li key={ct.id}>
                <Link href={`/m/${token}/c/${ct.id}`} className={`flex items-center gap-3 px-4 py-3 active:bg-neutral-50 ${isUnread ? "bg-blue-50/40" : ""}`}>
                  <Avatar name={ct.name} phone={ct.phone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`truncate ${isUnread ? "font-bold" : "font-medium"}`}>
                        {ct.name ?? displayPhone(ct.phone)}
                        {ct.starred && <span className="ml-1 text-amber-500" aria-label="Starred">★</span>}
                      </p>
                      <span className={`shrink-0 text-xs ${isUnread ? "font-semibold text-[#2a78d6]" : "text-neutral-500"}`}>{ct.last_message_at && shortWhen(ct.last_message_at, tz, localeFor(c.country))}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${isUnread ? "text-neutral-900" : "text-neutral-500"}`}>
                        {ct.last_message_direction === "call" && <span className="mr-1 text-red-500">✆</span>}
                        {ct.last_message_direction === "outbound" && <span className="text-neutral-400">You: </span>}
                        {ct.last_message_preview}
                      </p>
                      {isUnread && <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#2a78d6] text-[11px] font-bold text-white">{ct.unread_count}</span>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
