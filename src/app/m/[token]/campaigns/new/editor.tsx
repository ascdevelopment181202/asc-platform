"use client";

import { useState } from "react";
import { CAMPAIGN_PRESETS, fillCampaign, segments } from "@/lib/campaign-presets";
import { costLabel } from "@/lib/sms-text";

type Saved = { id: string; name: string; body: string };

/** Message box with ready-made and saved messages, and a live preview of what the first customer gets. */
export function MessageEditor({ sender, business, sampleName, saved, country, count }: { sender: string; business: string; sampleName: string | null; saved: Saved[]; country: "GB" | "US"; count: number }) {
  const [body, setBody] = useState(CAMPAIGN_PRESETS[0].body);
  const [name, setName] = useState(CAMPAIGN_PRESETS[0].name);
  const preview = fillCampaign(body, { name: sampleName, sender, business });
  const parts = segments(preview);
  const pick = (n: string, b: string) => {
    setName(n);
    setBody(b);
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-sm font-medium">Start from</p>
        <div className="flex flex-wrap gap-1.5">
          {CAMPAIGN_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => pick(p.name, p.body)} className={`rounded-full px-3 py-1.5 text-sm ${body === p.body ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-neutral-300"}`}>
              {p.name}
            </button>
          ))}
          {saved.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p.name, p.body)} className={`rounded-full px-3 py-1.5 text-sm ${body === p.body ? "bg-neutral-900 text-white" : "bg-amber-50 ring-1 ring-amber-300"}`}>
              ★ {p.name}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="text-sm font-medium">Campaign name (just for you)</span>
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base" />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Message</span>
        <textarea name="body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base" />
        <span className="text-xs text-neutral-500">Change the offer to anything you like. {"{name}"} becomes their first name, {"{sender}"} becomes &ldquo;{sender}&rdquo;.</span>
      </label>
      <div>
        <p className="text-sm font-medium">What {sampleName?.split(/\s+/)[0] ?? "they"} will get</p>
        <p className="mt-1 rounded-2xl rounded-bl-sm bg-neutral-100 p-3 text-sm">{preview}</p>
        <p className={`mt-1 rounded-lg p-2 text-xs ${parts > 1 ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900"}`}>
          {preview.length}/160 characters · {parts === 1 ? "1 text each" : `${parts} texts each, so it costs ${parts} times as much. Shorten it to fit 160`} · about {costLabel(parts * count, country)} to send to {count} {count === 1 ? "person" : "people"}.
        </p>
        <p className="mt-1 text-xs text-neutral-500">&ldquo;Reply STOP to opt out&rdquo; is added if you leave it off. Emoji and curly quotes are swapped for plain ones so it stays one text.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="save" className="h-5 w-5" /> Save this message to use again
      </label>
    </div>
  );
}
