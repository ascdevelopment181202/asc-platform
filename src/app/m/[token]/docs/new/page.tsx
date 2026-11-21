import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { displayPhone, localeFor } from "@/lib/phone";
import { addDays, currencyFor, todayYmd, type Doc } from "@/lib/crm";
import { loadClient, loadContact } from "../../data";
import { SubHeader } from "../../ui";
import { DocEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function NewDoc({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ kind?: string; contact?: string; id?: string; err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const existing = sp.id ? (await db().from("documents").select("*").eq("id", sp.id).eq("client_id", c.id).eq("status", "draft").maybeSingle<Doc>()).data : null;
  const kind = existing?.kind ?? (sp.kind === "invoice" ? "invoice" : "quote");
  const contact = await loadContact(c.id, existing?.contact_id ?? sp.contact ?? "");
  const tz = c.timezone || "Europe/London";
  return (
    <>
      <SubHeader back={existing ? `/m/${token}/docs/${existing.id}` : contact ? `/m/${token}/contacts/${contact.id}` : `/m/${token}/docs`} title={`${existing ? "Edit" : "New"} ${kind}`} />
      <main className="mx-auto max-w-xl p-4 pb-16">
        {sp.err && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">{sp.err}</p>}
        <DocEditor
          token={token}
          kind={kind}
          id={existing?.id}
          contactId={contact?.id}
          contactLabel={contact ? (contact.name ?? displayPhone(contact.phone)) : undefined}
          currency={currencyFor(c)}
          locale={localeFor(c.country)}
          defaultVat={existing ? Number(existing.vat_percent) : (c.invoice_details?.defaultVatPercent ?? 0)}
          initial={existing?.items}
          notes={existing?.notes ?? (kind === "invoice" ? c.invoice_details?.paymentTerms : undefined) ?? undefined}
          due={existing?.due_date ?? (kind === "invoice" ? addDays(todayYmd(tz), 14) : undefined)}
          us={c.country === "US"}
        />
      </main>
    </>
  );
}
