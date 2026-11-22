import Link from "next/link";
import { displayPhone, localeFor } from "@/lib/phone";
import { WHEN_PRESETS, type ContactTask } from "@/lib/tasks";
import { addTask, finishTask } from "./crm-actions";

const QUICK = ["Call back", "Send quote", "Chase quote", "Chase payment", "Book the job"];

/** Add a follow-up. With a contactId it's tied to that customer. */
export function AddTaskForm({ token, contactId, back }: { token: string; contactId?: string; back: string }) {
  return (
    <form action={addTask} className="space-y-2">
      <input type="hidden" name="token" value={token} />
      {contactId && <input type="hidden" name="contactId" value={contactId} />}
      <input type="hidden" name="back" value={back} />
      <input name="title" required list="task-quick" placeholder="What needs doing? e.g. Call back about the quote" className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-base" />
      <datalist id="task-quick">
        {QUICK.map((q) => (
          <option key={q} value={q} />
        ))}
      </datalist>
      <div className="flex gap-2">
        <select name="when" defaultValue="tomorrow" className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base">
          {WHEN_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        <button className="shrink-0 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white">Add</button>
      </div>
      <details className="text-sm text-neutral-600">
        <summary className="cursor-pointer">Pick a date and time instead</summary>
        <div className="mt-2 flex gap-2">
          <input type="date" name="date" className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-base" />
          <input type="time" name="time" defaultValue="09:00" className="w-28 rounded-xl border border-neutral-300 px-3 py-2 text-base" />
        </div>
      </details>
    </form>
  );
}

function dueLabel(iso: string, tz: string, locale: string) {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: tz });
  const time = d.toLocaleTimeString(locale, { timeZone: tz, hour: "numeric", minute: "2-digit" });
  if (d < now) return { text: day(d) === day(now) ? `Due ${time}` : `Overdue · ${d.toLocaleDateString(locale, { timeZone: tz, day: "numeric", month: "short" })}`, late: true };
  if (day(d) === day(now)) return { text: `Today ${time}`, late: false };
  const tmr = new Date(now.getTime() + 86400_000);
  if (day(d) === day(tmr)) return { text: `Tomorrow ${time}`, late: false };
  return { text: d.toLocaleDateString(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }) + ` ${time}`, late: false };
}

export function TaskList({ token, tasks, tz, country, back, showContact = true }: { token: string; tasks: ContactTask[]; tz: string; country: string | null; back: string; showContact?: boolean }) {
  const locale = localeFor(country as "GB" | "US" | null);
  if (!tasks.length) return <p className="text-sm text-neutral-500">Nothing to do. Nice.</p>;
  return (
    <ul className="divide-y divide-neutral-100">
      {tasks.map((t) => {
        const due = dueLabel(t.due_at, tz, locale);
        return (
          <li key={t.id} className="flex items-center gap-3 py-2.5">
            <form action={finishTask}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="taskId" value={t.id} />
              <input type="hidden" name="back" value={back} />
              <button aria-label="Mark done" className="flex size-7 items-center justify-center rounded-full border-2 border-neutral-300 text-transparent active:border-green-600 active:text-green-600">✓</button>
            </form>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.title}</p>
              <p className="truncate text-xs">
                <span className={due.late ? "font-medium text-red-700" : "text-neutral-500"}>{due.text}</span>
                {showContact && t.contact_id && (
                  <>
                    {" · "}
                    <Link href={`/m/${token}/contacts/${t.contact_id}`} className="text-[#2a78d6]">{t.contacts?.name ?? displayPhone(t.contacts?.phone)}</Link>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
