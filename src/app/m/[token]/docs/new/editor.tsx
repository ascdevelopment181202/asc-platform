"use client";

import { useState } from "react";
import { saveDocument } from "../../doc-actions";

type Row = { key: number; description: string; quantity: string; price: string };

/** Line-item editor with a live total. */
export function DocEditor(props: {
  token: string;
  kind: "quote" | "invoice";
  id?: string;
  contactId?: string;
  contactLabel?: string;
  currency: string;
  locale: string;
  defaultVat: number;
  initial?: { description: string; quantity: number; unitPence: number }[];
  notes?: string;
  due?: string;
  us: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(
    props.initial?.length
      ? props.initial.map((r, i) => ({ key: i, description: r.description, quantity: String(r.quantity), price: (r.unitPence / 100).toFixed(2) }))
      : [{ key: 0, description: "", quantity: "1", price: "" }],
  );
  const [vat, setVat] = useState(String(props.defaultVat));
  const fmt = (pence: number) => new Intl.NumberFormat(props.locale, { style: "currency", currency: props.currency }).format(pence / 100);
  const subtotal = rows.reduce((s, r) => s + Math.round((Number(r.quantity) || 0) * Math.round((Number(r.price) || 0) * 100)), 0);
  const vatPence = Math.round((subtotal * (Number(vat) || 0)) / 100);
  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const input = "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base";

  return (
    <form action={saveDocument} className="space-y-4">
      <input type="hidden" name="token" value={props.token} />
      <input type="hidden" name="kind" value={props.kind} />
      {props.id && <input type="hidden" name="id" value={props.id} />}

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">Customer</h2>
        {props.contactId ? (
          <>
            <input type="hidden" name="contactId" value={props.contactId} />
            <p className="rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium">{props.contactLabel}</p>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input name="name" placeholder="Name" className={input} />
            <input name="phone" type="tel" inputMode="tel" required placeholder={props.us ? "Cell number" : "Mobile"} className={input} />
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">Items</h2>
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.key} className="space-y-2 rounded-xl bg-neutral-50 p-3">
              <div className="flex gap-2">
                <input name="description" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} placeholder={i === 0 ? "e.g. Replace kitchen tap" : "Description"} className={input} />
                {rows.length > 1 && (
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove line" className="shrink-0 px-2 text-xl text-neutral-400">
                    ×
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-neutral-500">
                  Qty
                  <input name="quantity" inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} className={input} />
                </label>
                <label className="text-xs text-neutral-500">
                  Price each
                  <input name="price" inputMode="decimal" value={r.price} onChange={(e) => update(r.key, { price: e.target.value })} placeholder="0.00" className={input} />
                </label>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRows((rs) => [...rs, { key: Date.now(), description: "", quantity: "1", price: "" }])} className="mt-3 text-sm font-semibold text-[#2a78d6]">
          + Add line
        </button>

        <div className="mt-4 space-y-1 border-t border-neutral-100 pt-3 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2">
              {props.us ? "Tax" : "VAT"}
              <input name="vat" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-right" />%
            </label>
            <span>{fmt(vatPence)}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span>{fmt(subtotal + vatPence)}</span>
          </div>
        </div>
      </section>

      <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
        <textarea name="notes" rows={3} defaultValue={props.notes} placeholder={props.kind === "quote" ? "Notes (e.g. valid for 30 days, includes parts and labour)" : "Notes (e.g. thanks for your business)"} className={input} />
        {props.kind === "invoice" && (
          <label className="block text-sm text-neutral-600">
            Due date
            <input name="due" type="date" defaultValue={props.due} className={`${input} mt-1`} />
          </label>
        )}
      </section>

      <button className="w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-base font-semibold text-white">Save {props.kind}</button>
    </form>
  );
}
