"use client";

import { useEffect, useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** Keyboard shortcuts on the inbox: j and k move, Enter opens, a approves, d dismisses. */
export function InboxKeys() {
  useEffect(() => {
    let i = -1;
    const items = () => Array.from(document.querySelectorAll<HTMLElement>("[data-seo-item]"));
    const focus = (n: number) => {
      const all = items();
      if (!all.length) return;
      all.forEach((el) => el.classList.remove("ring-2", "ring-neutral-900"));
      i = Math.max(0, Math.min(all.length - 1, n));
      all[i].classList.add("ring-2", "ring-neutral-900");
      all[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      const all = items();
      if (e.key === "j") focus(i + 1);
      else if (e.key === "k") focus(i - 1);
      else if (i >= 0 && all[i]) {
        if (e.key === "Enter") (all[i] as HTMLDetailsElement).open = !(all[i] as HTMLDetailsElement).open;
        else if (e.key === "a") all[i].querySelector<HTMLButtonElement>("[data-approve]")?.click();
        else if (e.key === "d") all[i].querySelector<HTMLButtonElement>("[data-dismiss]")?.click();
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

/** Refreshes the page every few seconds while the first audit runs. */
export function AutoRefresh({ seconds = 6 }: { seconds?: number }) {
  useEffect(() => {
    const t = setInterval(() => window.location.reload(), seconds * 1000);
    return () => clearInterval(t);
  }, [seconds]);
  return null;
}
