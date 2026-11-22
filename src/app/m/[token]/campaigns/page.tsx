import Link from "next/link";
import { notFound } from "next/navigation";
import { localeFor } from "@/lib/phone";
import { campaignStats } from "@/lib/campaigns";
import { fullWhen, loadClient, unreadTotal } from "../data";
import { AppShell, Flash, PlusButton } from "../ui";
import { stopCampaign } from "./actions";

export const dynamic = "force-dynamic";

/** Reactivation campaigns: past sends with how many went and how many replied. */
export default async function Campaigns({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const [list, unread] = await Promise.all([campaignStats(c.id), unreadTotal(c.id)]);
  const tz = c.timezone || "Europe/London";

  return (
    <AppShell token={token} active="more" unread={unread} title="Campaigns" action={<PlusButton href={`/m/${token}/campaigns/new`} label="New campaign" />}>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4 p-4">
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Win back past customers</h2>
          <p className="mt-0.5 text-sm text-neutral-600">Send a text offer to customers you haven&apos;t heard from in a while. Quiet week? This is the quickest way to fill it.</p>
          <Link href={`/m/${token}/campaigns/new`} className="mt-3 block w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-center text-base font-semibold text-white active:bg-[#1f62b3]">
            New campaign
          </Link>
        </section>
        {list.length > 0 && (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl bg-white shadow-sm">
            {list.map((x) => (
              <li key={x.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{x.name}</p>
                    <p className="text-xs text-neutral-500">{fullWhen(x.created_at, tz, localeFor(c.country))}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800">{x.replies} repl{x.replies === 1 ? "y" : "ies"}</span>
                </div>
                <p className="mt-1 text-sm text-neutral-600">
                  Sent {x.sent} of {x.recipients}
                  {x.queued ? ` · ${x.queued} still to go` : ""}
                </p>
                {x.queued > 0 && (
                  <form action={stopCampaign} className="mt-1">
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="id" value={x.id} />
                    <button className="text-xs font-medium text-red-700 underline">Stop the rest</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
