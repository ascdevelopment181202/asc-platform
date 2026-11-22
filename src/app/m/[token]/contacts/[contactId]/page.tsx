import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import { currencyFor, money, STAGES } from "@/lib/crm";
import { fullWhen, loadClient, loadContact, shortWhen } from "../../data";
import { Avatar, Card, field, Flash, primaryBtn, SubHeader } from "../../ui";
import { addNote, changeStage, reaskReview, requestReview, retryTexts, updateContact } from "../../crm-actions";
import { openTasks } from "@/lib/tasks";
import { AddTaskForm, TaskList } from "../../tasks-ui";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string; contactId: string }>; searchParams: Promise<{ ok?: string; err?: string }> };

/** One customer: quick actions, pipeline stage, details, notes, bookings, quotes and invoices. */
export default async function ContactPage({ params, searchParams }: Props) {
  const { token, contactId } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const contact = await loadContact(c.id, contactId);
  if (!contact) notFound();
  const tz = c.timezone || "Europe/London";
  const locale = localeFor(c.country);
  const currency = currencyFor(c);
  const here = `/m/${token}/contacts/${contact.id}`;

  const [{ data: notes }, { data: appts }, { data: docs }, tasks] = await Promise.all([
    db().from("contact_notes").select("id, body, created_at").eq("contact_id", contact.id).order("created_at", { ascending: false }).limit(50).returns<{ id: string; body: string; created_at: string }[]>(),
    db().from("appointments").select("id, title, starts_at, status").eq("contact_id", contact.id).order("starts_at", { ascending: false }).limit(20).returns<{ id: string; title: string; starts_at: string; status: string }[]>(),
    db().from("documents").select("id, kind, number, total_pence, currency, status, created_at").eq("contact_id", contact.id).order("created_at", { ascending: false }).limit(20).returns<{ id: string; kind: string; number: number; total_pence: number; currency: string; status: string; created_at: string }[]>(),
    openTasks(c.id, { contactId: contact.id, limit: 20 }),
  ]);
  // An unhappy rating with no second ask yet: offer one once it's been put right.
  const { data: lastJobs } = await db().from("jobs").select("id, source, rating, created_at").eq("contact_id", contact.id).order("created_at", { ascending: false }).limit(5).returns<{ id: string; source: string; rating: number | null; created_at: string }[]>();
  const unhappy = (lastJobs ?? []).find((j) => j.rating !== null && j.rating <= 3);
  const reasked = unhappy && (lastJobs ?? []).some((j) => j.source === "reask" && j.created_at > unhappy.created_at);
  const offerReask = !!unhappy && !reasked && !contact.opted_out_at;

  const hidden = (
    <>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="contactId" value={contact.id} />
      <input type="hidden" name="back" value={here} />
    </>
  );

  return (
    <>
      <SubHeader back={`/m/${token}/contacts`} title={contact.name ?? displayPhone(contact.phone)} />
      <Flash ok={sp.ok} err={sp.err} />
      <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
        <div className="flex items-center gap-3">
          <Avatar name={contact.name} phone={contact.phone} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{contact.name ?? "No name yet"}</p>
            <p className="text-sm text-neutral-500">{displayPhone(contact.phone)}{contact.opted_out_at ? " · opted out of texts" : ""}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm font-medium">
          <QuickAction href={`tel:${contact.phone}`} label="Call" icon="📞" />
          <QuickAction href={`/m/${token}/c/${contact.id}`} label="Message" icon="💬" />
          <QuickAction href={`/m/${token}/calendar/new?contact=${contact.id}`} label="Book" icon="📅" />
          <QuickAction href={`/m/${token}/docs/new?kind=quote&contact=${contact.id}`} label="Quote" icon="📝" />
          <QuickAction href={`/m/${token}/docs/new?kind=invoice&contact=${contact.id}`} label="Invoice" icon={c.country === "US" ? "💵" : "💷"} />
          <form action={requestReview}>
            {hidden}
            <button className="flex w-full flex-col items-center gap-1 rounded-2xl bg-white py-3 shadow-sm active:bg-neutral-50">
              <span className="text-xl" aria-hidden>⭐</span>Review
            </button>
          </form>
        </div>

        <Card title="Job stage">
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <form key={s.key} action={changeStage}>
                {hidden}
                <input type="hidden" name="stage" value={s.key} />
                <button className={`rounded-full px-3 py-1.5 text-sm font-medium ${contact.stage === s.key ? s.tone : "bg-neutral-100 text-neutral-600"}`}>{s.label}</button>
              </form>
            ))}
          </div>
          {contact.job_value_pence != null && <p className="mt-2 text-sm text-neutral-600">Job value: {money(contact.job_value_pence, currency)}</p>}
        </Card>

        {contact.sms_undeliverable_at && (
          <section className="rounded-2xl bg-red-50 p-4 text-sm text-red-900 ring-1 ring-red-200">
            <p className="font-semibold">Texts to this number keep failing</p>
            <p className="mt-0.5">It may be a landline or no longer in use, so we&apos;ve stopped texting it. Add their email to reach them, or update the number.</p>
            <form action={retryTexts} className="mt-2">
              {hidden}
              <input type="hidden" name="back" value={here} />
              <button className="text-sm font-medium underline">The number works, try again</button>
            </form>
          </section>
        )}

        {offerReask && (
          <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <p className="font-semibold text-amber-950">They rated you {unhappy!.rating}★. Sorted it out?</p>
            <p className="mt-0.5 text-sm text-amber-900">Once you&apos;ve put it right, ask again. Customers whose problem was fixed often leave the best reviews.</p>
            <form action={reaskReview} className="mt-3">
              {hidden}
              <input type="hidden" name="back" value={here} />
              <button className="w-full rounded-xl bg-amber-500 px-4 py-3 text-base font-semibold text-white active:bg-amber-600">It&apos;s sorted, ask {contact.name?.split(/\s+/)[0] ?? "them"} again</button>
            </form>
          </section>
        )}

        <Card title="Follow-ups">
          {tasks.length > 0 && (
            <div className="mb-3">
              <TaskList token={token} tasks={tasks} tz={tz} country={c.country} back={here} showContact={false} />
            </div>
          )}
          <AddTaskForm token={token} contactId={contact.id} back={here} />
        </Card>

        <Card title="Notes">
          <form action={addNote} className="flex gap-2">
            {hidden}
            <input name="body" placeholder="Add a private note (e.g. gate code, boiler model)" className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2.5 text-base" />
            <button className="shrink-0 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white">Add</button>
          </form>
          <ul className="mt-3 space-y-2">
            {(notes ?? []).map((n) => (
              <li key={n.id} className="rounded-xl bg-amber-50 px-3 py-2 text-sm">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{fullWhen(n.created_at, tz, locale)}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Bookings" action={<Link href={`/m/${token}/calendar/new?contact=${contact.id}`} className="text-sm font-medium text-[#2a78d6]">+ Book</Link>}>
          {(appts ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">No bookings yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {(appts ?? []).map((a) => (
                <li key={a.id}>
                  <Link href={`/m/${token}/calendar/${a.id}`} className="flex justify-between gap-2 py-2 text-sm">
                    <span className="truncate">{a.title}</span>
                    <span className={`shrink-0 ${a.status === "cancelled" ? "text-neutral-400 line-through" : "text-neutral-600"}`}>{fullWhen(a.starts_at, tz, locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Quotes and invoices" action={<Link href={`/m/${token}/docs/new?kind=quote&contact=${contact.id}`} className="text-sm font-medium text-[#2a78d6]">+ Quote</Link>}>
          {(docs ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">None yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {(docs ?? []).map((d) => (
                <li key={d.id}>
                  <Link href={`/m/${token}/docs/${d.id}`} className="flex justify-between gap-2 py-2 text-sm">
                    <span>
                      {d.kind === "quote" ? "Quote" : "Invoice"} #{d.number} · {shortWhen(d.created_at, tz, locale)}
                    </span>
                    <span className="shrink-0 font-medium">
                      {money(d.total_pence, d.currency)} · <span className="capitalize text-neutral-500">{d.status}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <details className="rounded-2xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold">Edit details</summary>
          <form action={updateContact} className="mt-3 space-y-2">
            {hidden}
            <input name="name" defaultValue={contact.name ?? ""} placeholder="Name" className={field} />
            <input name="email" type="email" defaultValue={contact.email ?? ""} placeholder="Email" className={field} />
            <input name="address" defaultValue={contact.address ?? ""} placeholder="Address" className={field} />
            <input name="tags" defaultValue={contact.tags.join(", ")} placeholder="Tags, comma separated" className={field} />
            <input name="job_value" inputMode="decimal" defaultValue={contact.job_value_pence != null ? (contact.job_value_pence / 100).toFixed(2) : ""} placeholder="Job value (e.g. 450)" className={field} />
            <button className={primaryBtn}>Save</button>
          </form>
        </details>
        {contact.address && (
          <a href={`https://maps.google.com/?q=${encodeURIComponent(contact.address)}`} className="block text-center text-sm font-medium text-[#2a78d6]">
            Open address in Maps
          </a>
        )}
      </main>
    </>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1 rounded-2xl bg-white py-3 shadow-sm active:bg-neutral-50">
      <span className="text-xl" aria-hidden>{icon}</span>
      {label}
    </Link>
  );
}
