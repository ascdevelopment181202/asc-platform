import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { clientLabel } from "@/lib/clients";
import { vapidPublicKey } from "@/lib/push";
import { bookingUrl } from "@/lib/crm";
import { loadClient, unreadTotal } from "../data";
import { AppShell } from "../ui";
import { NotificationsToggle } from "../notifications";

export const dynamic = "force-dynamic";

/** Everything else: money, reviews, results and settings. */
export default async function More({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await loadClient(token);
  if (!c) notFound();
  const [unread, publicKey] = await Promise.all([unreadTotal(c.id), vapidPublicKey()]);
  const items: { href: string; icon: string; title: string; sub: string }[] = [
    { href: `/m/${token}/docs`, icon: c.country === "US" ? "💵" : "💷", title: "Quotes and invoices", sub: "Create, send by text, see what's owed" },
    { href: `/m/${token}/today`, icon: "✨", title: "Today's customers", sub: "One tap to ask each of them for a review" },
    { href: `/m/${token}/tasks`, icon: "✅", title: "Tasks and follow-ups", sub: "Call-backs and chasers, with reminders" },
    { href: `/m/${token}/reviews`, icon: "⭐", title: "Reviews", sub: "Your Google reviews, replies, review requests" },
    { href: `/m/${token}/contacts/import`, icon: "📥", title: "Import customers", sub: "From a spreadsheet, job software or your phone" },
    { href: `/m/${token}/stats`, icon: "📈", title: "Results", sub: "This month's missed calls, replies and reviews" },
    { href: `/m/${token}/more/templates`, icon: "⚡", title: "Saved replies", sub: "Quick messages you send often" },
    { href: `/m/${token}/more/booking`, icon: "📅", title: "Booking link and hours", sub: c.booking_enabled ? "On: customers can book themselves" : "Off" },
    { href: `/m/${token}/more/payments`, icon: "🏦", title: "Business details and branding", sub: "Logo, colour, address, VAT, how customers pay you" },
  ];
  return (
    <AppShell token={token} active="more" unread={unread} title="More">
      <div className="space-y-4 p-4">
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white shadow-sm">
          {items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="flex items-center gap-3 px-4 py-3.5 active:bg-neutral-50">
                <span className="text-2xl" aria-hidden>{i.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.title}</p>
                  <p className="truncate text-sm text-neutral-500">{i.sub}</p>
                </div>
                <span className="text-neutral-300">›</span>
              </Link>
            </li>
          ))}
        </ul>
        {c.booking_enabled && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="font-semibold">Your booking link</p>
            <p className="mt-1 break-all text-sm text-[#2a78d6]">{bookingUrl(c, env.appUrl)}</p>
            <p className="mt-1 text-xs text-neutral-500">Put it on your website, Google profile and social pages, or send it with the &ldquo;Booking link&rdquo; saved reply.</p>
          </div>
        )}
        <NotificationsToggle token={token} publicKey={publicKey} />
        <p className="pt-2 text-center text-xs text-neutral-500">
          {clientLabel(c)} · looked after by ASC Development. Questions? Call or text {env.contactPhone}.
        </p>
      </div>
    </AppShell>
  );
}
