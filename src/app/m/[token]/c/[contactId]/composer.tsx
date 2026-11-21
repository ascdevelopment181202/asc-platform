"use client";

import { useRef, useState } from "react";
import { sendMessage } from "../../actions";
import { addNote } from "../../crm-actions";

type Snippet = { id: string; title: string; text: string };

/** Reply box with saved replies and a private-note mode, like LeadConnector's composer. */
export function Composer({ token, contactId, snippets, back }: { token: string; contactId: string; snippets: Snippet[]; back: string }) {
  const [mode, setMode] = useState<"sms" | "note">("sms");
  const [showSnippets, setShowSnippets] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const insert = (text: string) => {
    if (box.current) {
      box.current.value = text;
      box.current.focus();
    }
    setShowSnippets(false);
  };

  return (
    <div className="mx-auto max-w-xl px-3 pb-2 pt-1.5">
      {showSnippets && (
        <div className="mb-2 max-h-60 overflow-y-auto rounded-2xl bg-white shadow-lg ring-1 ring-neutral-200">
          {snippets.length === 0 && <p className="p-3 text-sm text-neutral-500">No saved replies yet. Add them under More, then Templates.</p>}
          {snippets.map((s) => (
            <button key={s.id} type="button" onClick={() => insert(s.text)} className="block w-full border-b border-neutral-100 px-4 py-2.5 text-left last:border-0 active:bg-neutral-50">
              <span className="block text-sm font-semibold">{s.title}</span>
              <span className="block truncate text-xs text-neutral-500">{s.text}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mb-1.5 flex gap-1.5 text-xs font-medium">
        <button type="button" onClick={() => setMode("sms")} className={`rounded-full px-3 py-1 ${mode === "sms" ? "bg-[#2a78d6] text-white" : "bg-neutral-100 text-neutral-600"}`}>
          Text
        </button>
        <button type="button" onClick={() => setMode("note")} className={`rounded-full px-3 py-1 ${mode === "note" ? "bg-amber-400 text-neutral-900" : "bg-neutral-100 text-neutral-600"}`}>
          Private note
        </button>
        {mode === "sms" && (
          <button type="button" onClick={() => setShowSnippets((v) => !v)} className="ml-auto rounded-full bg-neutral-100 px-3 py-1 text-neutral-700">
            ⚡ Templates
          </button>
        )}
      </div>
      <form action={mode === "sms" ? sendMessage : addNote} className="flex items-end gap-2">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="back" value={back} />
        <textarea
          ref={box}
          name="body"
          rows={1}
          required
          placeholder={mode === "sms" ? "Text message" : "Note for you only, never sent"}
          className={`max-h-40 min-h-11 flex-1 resize-none rounded-2xl border px-4 py-2.5 text-base ${mode === "note" ? "border-amber-300 bg-amber-50" : "border-neutral-300"}`}
        />
        <button aria-label={mode === "sms" ? "Send" : "Save note"} className={`flex size-11 shrink-0 items-center justify-center rounded-full text-white ${mode === "sms" ? "bg-[#2a78d6]" : "bg-amber-500"}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M3.4 20.4l17.4-7.5a1 1 0 0 0 0-1.8L3.4 3.6a1 1 0 0 0-1.4 1.2L4.3 12l-2.3 7.2a1 1 0 0 0 1.4 1.2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
