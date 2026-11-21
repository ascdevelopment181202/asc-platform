import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import type { Contact, Stage } from "@/lib/sms";
import { currencyFor, money, STAGES } from "@/lib/crm";
import { loadClient, shortWhen, unreadTotal } from "../data";
import { AppShell, Avatar } from "../ui";
import { changeStage } from "../crm-actions";

export const dynamic = "force-dynamic";

/** Jobs pipeline: tabs per stage with counts and value, and a one-tap move to the next stage. */
export default async function Jobs({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const stage = (STAGES.some((s) => s.key === sp.stage) ? sp.stage : "new") as Stage;
  const [{ data: all }, unread] = await Promise.all([
    db().from("contacts").select("*").eq("client_id", c.id).not("stage", "is", null).order("stage_changed_at", { ascending: false, nullsFirst: false }).limit(500).returns<Contact[]>(),
    unreadTotal(c.id),
  ]);
  const rows = all ?? [];
  const inStage = rows.filter((r) => r.stage === stage);
  const currency = currencyFor(c);
  const tz = c.timezone || "Europe/London";
  const locale = localeFor(c.country);
  const nextOf: Partial<Record<Stage, Stage>> = { new: "quoted", quoted: "booked", booked: "done", done: "paid" };
  const next = nextOf[stage];
  const nextLabel = STAGES.find((s) => s.key === next)?.label;

  return (
    <AppShell token={token} active="jobs" unread={unread} title="Jobs">
      <div className="sticky top-[61px] z-10 flex gap-1.5 overflow-x-auto bg-[#f4f5f7] px-4 py-3">
        {STAGES.map((s) => {
          const list = rows.filter((r) => r.stage === s.key);
          const value = list.reduce((sum, r) => sum + (r.job_value_pence ?? 0), 0);
          return (
            <Link key={s.key} href={`/m/${token}/jobs?stage=${s.key}`} className={`shrink-0 rounded-2xl px-3 py-2 text-left ${stage === s.key ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-neutral-200"}`}>
              <p className="text-xs font-medium">{s.label}</p>
              <p className="text-lg font-bold leading-tight">{list.length}</p>
              {value > 0 && <p className="text-[11px] opacity-70">{money(value, currency)}</p>}
            </Link>
          );
        })}
      </div>
      {inStage.length === 0 ? (
        <p className="px-6 py-14 text-center text-sm text-neutral-500">
          Nobody in &ldquo;{STAGES.find((s) => s.key === stage)?.label}&rdquo;. Customers move here automatically when you send a quote, book them in, finish the job or get paid, or set it on their page.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 bg-white">
          {inStage.map((ct) => (
            <li key={ct.id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`/m/${token}/contacts/${ct.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={ct.name} phone={ct.phone} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{ct.name ?? displayPhone(ct.phone)}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {ct.job_value_pence != null ? `${money(ct.job_value_pence, currency)} · ` : ""}
                    {ct.stage_changed_at ? `since ${shortWhen(ct.stage_changed_at, tz, locale)}` : ""}
                    {ct.tags.length ? ` · ${ct.tags.map((t) => `#${t}`).join(" ")}` : ""}
                  </p>
                </div>
              </Link>
              {next && (
                <form action={changeStage}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="contactId" value={ct.id} />
                  <input type="hidden" name="stage" value={next} />
                  <input type="hidden" name="back" value={`/m/${token}/jobs?stage=${stage}`} />
                  <button className="shrink-0 rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold active:bg-neutral-200">→ {nextLabel}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
