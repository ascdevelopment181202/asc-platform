import "server-only";
import { db, type Client } from "./supabase";

/**
 * Claims a one-off message slot for a client (e.g. "welcome_email", "chase_24").
 * Returns true if this call claimed it, false if it was already claimed.
 * Claim first, send second; call releaseOnce if the send fails so it retries next time.
 */
export async function claimOnce(clientId: string, kind: string, detail?: unknown): Promise<boolean> {
  const { error } = await db()
    .from("client_messages")
    .insert({ client_id: clientId, kind, detail: detail ?? null });
  if (!error) return true;
  if (error.code === "23505") return false; // unique violation: already done
  throw error;
}

export async function releaseOnce(clientId: string, kind: string) {
  await db().from("client_messages").delete().eq("client_id", clientId).eq("kind", kind);
}

/** Runs `send` at most once per client and kind. Returns true if it ran now. */
export async function once(clientId: string, kind: string, send: () => Promise<unknown>): Promise<boolean> {
  if (!(await claimOnce(clientId, kind))) return false;
  try {
    await send();
    return true;
  } catch (err) {
    await releaseOnce(clientId, kind);
    throw err;
  }
}

export async function createTask(clientId: string | null, title: string, dueAt?: Date) {
  const { error } = await db()
    .from("tasks")
    .insert({ client_id: clientId, title, due_at: dueAt?.toISOString() ?? null });
  if (error) throw error;
}

export function clientLabel(c: Pick<Client, "business_name" | "full_name" | "email">) {
  return c.business_name || c.full_name || c.email;
}

/** Status a client should return to once a missed payment is paid. */
export function activeStatusFor(c: Pick<Client, "launched_at" | "form_submitted_at">) {
  if (c.launched_at) return "live" as const;
  if (c.form_submitted_at) return "building" as const;
  return "awaiting_form" as const;
}
