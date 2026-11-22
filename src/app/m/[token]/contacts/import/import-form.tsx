"use client";

import { useState } from "react";
import { parseImport, type ImportRow } from "@/lib/import-parse";
import { importContacts } from "../../crm-actions";

export function ImportForm({ token, us }: { token: string; us: boolean }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setErr("");
    if (!file) return;
    if (file.size > 5_000_000) return setErr("That file is too big. Keep it under 5MB, or send it to ASC.");
    const found = parseImport(await file.text(), file.name);
    if (!found.length) return setErr("Couldn't find any phone numbers in that file. Is it a CSV or a contacts (.vcf) file?");
    setRows(found);
  }

  if (!rows)
    return (
      <div className="space-y-3">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-300 bg-white px-4 py-10 text-center active:bg-neutral-50">
          <span className="text-3xl">📄</span>
          <span className="mt-2 font-semibold">Choose a file</span>
          <span className="mt-1 text-sm text-neutral-500">A spreadsheet (CSV) or contacts file (.vcf)</span>
          <input type="file" accept=".csv,.txt,.vcf,text/csv,text/vcard,text/x-vcard" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <p className="text-center text-sm text-neutral-500">or paste a list</p>
        <textarea
          rows={5}
          placeholder={us ? "Sarah, (214) 555-0123\nMike Jones, (214) 555-0145" : "Sarah, 07700 900123\nMike Jones, 07700 900456"}
          className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-base"
          onBlur={(e) => {
            const found = parseImport(e.target.value);
            if (found.length) setRows(found);
          }}
        />
        {err && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      </div>
    );

  return (
    <form
      action={async (f) => {
        setBusy(true);
        await importContacts(f);
      }}
      className="space-y-3"
    >
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <p className="font-semibold">Found {rows.length} customer{rows.length === 1 ? "" : "s"}</p>
      <ul className="max-h-80 divide-y divide-neutral-100 overflow-y-auto rounded-2xl bg-white shadow-sm">
        {rows.slice(0, 100).map((r, i) => (
          <li key={i} className="px-4 py-2 text-sm">
            <p className="font-medium">{r.name || "No name"}</p>
            <p className="text-neutral-500">{[r.phone, r.email].filter(Boolean).join(" · ")}</p>
          </li>
        ))}
        {rows.length > 100 && <li className="px-4 py-2 text-sm text-neutral-500">and {rows.length - 100} more</li>}
      </ul>
      <input name="tags" placeholder="Tag them (optional), e.g. past customer" className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base" />
      <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm shadow-sm">
        <input type="checkbox" name="review" className="mt-0.5 h-5 w-5" />
        <span>Also ask them for a Google review (one text each, spread over a few days). Only tick this for customers from the last few months.</span>
      </label>
      <button disabled={busy} className="w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-base font-semibold text-white disabled:opacity-60">
        {busy ? "Importing…" : `Import ${rows.length}`}
      </button>
      <button type="button" onClick={() => setRows(null)} className="w-full py-2 text-sm text-neutral-500">Choose a different file</button>
    </form>
  );
}
