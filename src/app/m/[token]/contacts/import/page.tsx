import { notFound } from "next/navigation";
import { loadClient } from "../../data";
import { Flash, SubHeader } from "../../ui";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  return (
    <div className="min-h-dvh bg-[#f4f5f7]">
      <SubHeader back={`/m/${token}/contacts`} title="Import customers" />
      <Flash err={sp.err} />
      <div className="space-y-4 p-4">
        <p className="text-sm text-neutral-600">
          Bring in your existing customers from your job software, a spreadsheet, or your phone&apos;s contacts. Anyone already here is updated, not doubled up.
        </p>
        <ImportForm token={token} us={c.country === "US"} />
        <details className="rounded-2xl bg-white p-4 text-sm shadow-sm">
          <summary className="cursor-pointer font-semibold">How do I get my contacts out?</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-neutral-700">
            <li><strong>Job software</strong> (Tradify, Jobber, ServiceM8, Housecall Pro): Customers or Clients, then Export, then CSV.</li>
            <li><strong>iPhone</strong>: on a computer go to icloud.com/contacts, select all, then Export vCard.</li>
            <li><strong>Android</strong>: Contacts app, Fix and manage, Export to file.</li>
            <li><strong>Excel or Google Sheets</strong>: File, Download, CSV.</li>
            <li>Stuck? Send the file to ASC and we&apos;ll load it for you.</li>
          </ul>
        </details>
      </div>
    </div>
  );
}
