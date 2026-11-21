import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { clientLabel } from "@/lib/clients";
import { loadClient, unreadTotal } from "../data";
import { AppShell } from "../ui";

export const dynamic = "force-dynamic";

/** This month's numbers, plus how to add the app to the home screen. */
export default async function Stats({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await loadClient(token);
  if (!c) notFound();
  const tz = c.timezone || "Europe/London";
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const head = { count: "exact" as const, head: true };
  const [caught, replies, asked, clicked, unread] = await Promise.all([
    db().from("calls").select("id", head).eq("client_id", c.id).eq("text_sent", true).gte("created_at", monthStart),
    db().from("replies").select("id", head).eq("client_id", c.id).gte("created_at", monthStart),
    db().from("jobs").select("id", head).eq("client_id", c.id).gte("created_at", monthStart),
    db().from("jobs").select("id", head).eq("client_id", c.id).gte("created_at", monthStart).not("review_clicked_at", "is", null),
    unreadTotal(c.id),
  ]);
  const monthName = now.toLocaleDateString("en-GB", { month: "long", timeZone: tz });

  return (
    <AppShell token={token} active="stats" unread={unread} title="Results">
      <div className="space-y-4 p-4">
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold text-neutral-600">{monthName} so far</h2>
          <div className="grid grid-cols-2 gap-2">
            <Tile value={caught.count ?? 0} label="Missed calls texted back" />
            <Tile value={replies.count ?? 0} label="Customer replies" />
            <Tile value={asked.count ?? 0} label="Review requests" />
            <Tile value={clicked.count ?? 0} label="Opened the review link" />
          </div>
        </section>

        <details className="rounded-2xl bg-white p-4 shadow-sm" open>
          <summary className="cursor-pointer font-semibold">Put this app on your home screen</summary>
          <ul className="mt-2 space-y-1.5 text-sm text-neutral-700">
            <li><strong>iPhone:</strong> open this page in Safari, tap the Share button, then &ldquo;Add to Home Screen&rdquo;.</li>
            <li><strong>Android:</strong> open in Chrome, tap the three dots, then &ldquo;Add to Home screen&rdquo; or &ldquo;Install app&rdquo;.</li>
          </ul>
        </details>

        <p className="pt-2 text-center text-xs text-neutral-500">
          {clientLabel(c)} · looked after by ASC Development. Questions? Call or text {env.contactPhone}.
        </p>
      </div>
    </AppShell>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-3xl font-semibold tracking-tight">{value.toLocaleString("en-GB")}</p>
      <p className="mt-0.5 text-xs text-neutral-600">{label}</p>
    </div>
  );
}
