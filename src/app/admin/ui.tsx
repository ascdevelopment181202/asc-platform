import type { ClientStatus } from "@/lib/supabase";

const STATUS: Record<ClientStatus, { label: string; cls: string }> = {
  awaiting_form: { label: "Awaiting form", cls: "bg-amber-100 text-amber-800" },
  building: { label: "Building", cls: "bg-blue-100 text-blue-800" },
  live: { label: "Live", cls: "bg-green-100 text-green-800" },
  past_due: { label: "Payment failed", cls: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", cls: "bg-neutral-200 text-neutral-600" },
};

export function StatusPill({ status }: { status: ClientStatus }) {
  const s = STATUS[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function fmt(date: string | null) {
  if (!date) return "-";
  return new Date(date).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

/** "31h left" / "5h overdue" against a deadline. */
export function Countdown({ due }: { due: string | null }) {
  if (!due) return <span className="text-neutral-400">-</span>;
  // Server component, rendered fresh per request (force-dynamic), so reading the clock is intended.
  // eslint-disable-next-line react-hooks/purity
  const hours = Math.round((Date.parse(due) - Date.now()) / 3600_000);
  if (hours < 0) return <span className="font-semibold text-red-600">{-hours}h overdue</span>;
  return <span className={hours <= 12 ? "font-semibold text-amber-700" : "text-neutral-700"}>{hours}h left</span>;
}

export const btn = "rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700";
export const btnQuiet = "rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100";
export const input = "rounded-lg border border-neutral-300 px-3 py-2 text-sm";
