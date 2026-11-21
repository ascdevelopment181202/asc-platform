import "server-only";
import { cache } from "react";
import { db, type Client } from "@/lib/supabase";

/** The client behind a private app link, or null. Cached per request so layout and page share one lookup. */
export const loadClient = cache(async (token: string) => {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const { data } = await db().from("clients").select("*").eq("dashboard_token", token).maybeSingle<Client>();
  return data;
});

export async function unreadTotal(clientId: string) {
  const { count } = await db().from("contacts").select("id", { count: "exact", head: true }).eq("client_id", clientId).gt("unread_count", 0);
  return count ?? 0;
}

/** "14:05" today, "Yesterday", "Mon", or "3 Nov" in the client's time zone. Short, like a phone's messages list. */
export function shortWhen(iso: string, tz: string, locale = "en-GB") {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => x.toLocaleDateString("en-GB", { timeZone: tz });
  if (day(d) === day(now)) return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: tz });
  if (day(d) === day(new Date(now.getTime() - 86400_000))) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString(locale, { weekday: "short", timeZone: tz });
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: tz });
}

export function fullWhen(iso: string, tz: string, locale = "en-GB") {
  return new Date(iso).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
}

export const daysAgoIso = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

/** For server actions: the client from the hidden token field, or throw. */
export async function clientFromForm(formData: FormData) {
  const c = await loadClient(String(formData.get("token") ?? ""));
  if (!c) throw new Error("Invalid link");
  return c;
}

export async function loadContact(clientId: string, contactId: string) {
  if (!/^[0-9a-f-]{36}$/.test(contactId)) return null;
  const { data } = await db().from("contacts").select("*").eq("id", contactId).eq("client_id", clientId).maybeSingle<import("@/lib/sms").Contact>();
  return data;
}
