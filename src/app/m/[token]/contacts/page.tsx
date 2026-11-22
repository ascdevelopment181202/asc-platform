import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone } from "@/lib/phone";
import type { Contact } from "@/lib/sms";
import { stageInfo } from "@/lib/crm";
import { loadClient, unreadTotal } from "../data";
import { AppShell, Avatar, Flash, PlusButton } from "../ui";

export const dynamic = "force-dynamic";

/** Every customer, A to Z, with search and tag filters. */
export default async function Contacts({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ q?: string; tag?: string; ok?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const q = (sp.q ?? "").trim();
  const tag = (sp.tag ?? "").trim().toLowerCase();

  let query = db().from("contacts").select("*").eq("client_id", c.id);
  if (q) {
    const digits = q.replace(/\D/g, "").replace(/^0/, "");
    const safe = q.replace(/[%,()]/g, "");
    query = digits.length >= 3 ? query.or(`name.ilike.%${safe}%,phone.ilike.%${digits}%`) : query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%,address.ilike.%${safe}%`);
  }
  if (tag) query = query.contains("tags", [tag]);
  const [{ data: rows }, unread, { data: tagRows }] = await Promise.all([
    query.order("name", { ascending: true, nullsFirst: false }).limit(300).returns<Contact[]>(),
    unreadTotal(c.id),
    db().from("contacts").select("tags").eq("client_id", c.id).not("tags", "eq", "{}").limit(500).returns<{ tags: string[] }[]>(),
  ]);
  const allTags = [...new Set((tagRows ?? []).flatMap((r) => r.tags))].sort().slice(0, 20);
  const contacts = rows ?? [];

  return (
    <AppShell token={token} active="contacts" unread={unread} title="Contacts" action={<PlusButton href={`/m/${token}/contacts/new`} label="New contact" />}>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="sticky top-[61px] z-10 space-y-2 bg-[#f4f5f7] px-4 pb-2 pt-3">
        <form action={`/m/${token}/contacts`}>
          {tag && <input type="hidden" name="tag" value={tag} />}
          <input name="q" defaultValue={q} placeholder="Search name, number, email or address" className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-base" />
        </form>
        {!q && !tag && (
          <div className="grid grid-cols-2 gap-2">
            <Link href={`/m/${token}/jobs`} className="rounded-xl bg-white px-3 py-2.5 text-center text-sm font-medium text-neutral-800 ring-1 ring-neutral-200 active:bg-neutral-50">📋 Jobs pipeline</Link>
            <Link href={`/m/${token}/campaigns`} className="rounded-xl bg-white px-3 py-2.5 text-center text-sm font-medium text-neutral-800 ring-1 ring-neutral-200 active:bg-neutral-50">📣 Win back customers</Link>
          </div>
        )}
        {!q && !tag && (
          <Link href={`/m/${token}/contacts/import`} className="block rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-[#2a78d6] ring-1 ring-neutral-200 active:bg-neutral-50">
            Import customers from a file or your phone →
          </Link>
        )}
        {allTags.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto">
            <Link href={`/m/${token}/contacts${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={`shrink-0 rounded-full px-3 py-1 text-sm ${!tag ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-neutral-200"}`}>
              All
            </Link>
            {allTags.map((t) => (
              <Link key={t} href={`/m/${token}/contacts?tag=${encodeURIComponent(t)}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`shrink-0 rounded-full px-3 py-1 text-sm ${tag === t ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-neutral-200"}`}>
                #{t}
              </Link>
            ))}
          </div>
        )}
      </div>
      {contacts.length === 0 ? (
        <p className="px-6 py-16 text-center text-sm text-neutral-500">{q || tag ? "No customers match." : "No customers yet. Everyone who calls or texts is added automatically, or tap + to add one."}</p>
      ) : (
        <ul className="mt-1 divide-y divide-neutral-100 bg-white">
          {contacts.map((ct) => {
            const st = stageInfo(ct.stage);
            return (
              <li key={ct.id}>
                <Link href={`/m/${token}/contacts/${ct.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-neutral-50">
                  <Avatar name={ct.name} phone={ct.phone} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{ct.name ?? displayPhone(ct.phone)}</p>
                    <p className="truncate text-sm text-neutral-500">
                      {ct.name ? displayPhone(ct.phone) : "No name yet"}
                      {ct.tags.length > 0 && ` · ${ct.tags.map((t) => `#${t}`).join(" ")}`}
                    </p>
                  </div>
                  {st && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.tone}`}>{st.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
