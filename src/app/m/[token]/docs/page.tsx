import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import { currencyFor, DOC_STATUS, docTitle, money, type Doc } from "@/lib/crm";
import { loadClient, shortWhen } from "../data";
import { SubHeader } from "../ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "quotes", label: "Quotes" },
  { key: "invoices", label: "Invoices" },
  { key: "unpaid", label: "Unpaid" },
] as const;

type Row = Doc & { contacts: { name: string | null; phone: string } | null };

/** Quotes and invoices, newest first, with what's still owed. */
export default async function Docs({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ f?: string }> }) {
  const { token } = await params;
  const { f } = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const filter = FILTERS.some((x) => x.key === f) ? f! : "all";
  let q = db().from("documents").select("*, contacts(name, phone)").eq("client_id", c.id);
  if (filter === "quotes") q = q.eq("kind", "quote");
  if (filter === "invoices") q = q.eq("kind", "invoice");
  if (filter === "unpaid") q = q.eq("kind", "invoice").in("status", ["draft", "sent"]);
  const [{ data: rows }, { data: owed }] = await Promise.all([
    q.order("created_at", { ascending: false }).limit(100).returns<Row[]>(),
    db().from("documents").select("total_pence").eq("client_id", c.id).eq("kind", "invoice").eq("status", "sent").returns<{ total_pence: number }[]>(),
  ]);
  const outstanding = (owed ?? []).reduce((s, r) => s + r.total_pence, 0);
  const tz = c.timezone || "Europe/London";
  const locale = localeFor(c.country);

  return (
    <>
      <SubHeader
        back={`/m/${token}/more`}
        title="Quotes and invoices"
        action={
          <div className="flex gap-1.5 text-sm font-semibold">
            <Link href={`/m/${token}/docs/new?kind=quote`} className="rounded-full bg-neutral-100 px-3 py-1.5">+ Quote</Link>
            <Link href={`/m/${token}/docs/new?kind=invoice`} className="rounded-full bg-[#2a78d6] px-3 py-1.5 text-white">+ Invoice</Link>
          </div>
        }
      />
      <main className="mx-auto max-w-xl pb-16">
        <div className="space-y-2 px-4 pt-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-sm text-neutral-500">Owed to you (sent, unpaid invoices)</p>
            <p className="text-2xl font-bold">{money(outstanding, currencyFor(c))}</p>
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {FILTERS.map((x) => (
              <Link key={x.key} href={`/m/${token}/docs?f=${x.key}`} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${filter === x.key ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-neutral-200"}`}>
                {x.label}
              </Link>
            ))}
          </div>
        </div>
        {(rows ?? []).length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-neutral-500">Nothing here yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100 bg-white">
            {(rows ?? []).map((d) => (
              <li key={d.id}>
                <Link href={`/m/${token}/docs/${d.id}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-neutral-50">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.contacts ? (d.contacts.name ?? displayPhone(d.contacts.phone)) : "Customer"}</p>
                    <p className="text-xs text-neutral-500">
                      {docTitle(d)} · {shortWhen(d.created_at, tz, locale)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold">{money(d.total_pence, d.currency)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DOC_STATUS[d.status].tone}`}>{DOC_STATUS[d.status].label}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
