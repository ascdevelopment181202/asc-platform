"use client";

import { useState } from "react";

/** Open, copy or share the client's review page link. */
export function ShareLink({ url, business }: { url: string; business: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Thanks for choosing ${business}! If you've got a minute, we'd love to hear how we did: ${url}`;
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* cancelled: fall through to copy */
      }
    }
    await copy();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <p className="break-all rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{url}</p>
      <div className="grid grid-cols-3 gap-2">
        <a href={url} target="_blank" rel="noreferrer" className="rounded-xl px-3 py-2.5 text-center text-sm font-medium ring-1 ring-neutral-300">
          Preview
        </a>
        <button type="button" onClick={copy} className="rounded-xl px-3 py-2.5 text-sm font-medium ring-1 ring-neutral-300">
          {copied ? "Copied" : "Copy link"}
        </button>
        <button type="button" onClick={share} className="rounded-xl bg-[#2a78d6] px-3 py-2.5 text-sm font-semibold text-white">
          Share
        </button>
      </div>
    </div>
  );
}
