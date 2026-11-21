import { db, type Client } from "@/lib/supabase";
import { notifyClient } from "@/lib/push";

export const runtime = "nodejs";

/** "Send a test" button in the app. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token || !/^[0-9a-f]{32}$/.test(body.token)) return Response.json({ error: "Bad request" }, { status: 400 });
  const { data: c } = await db().from("clients").select("id, dashboard_token").eq("dashboard_token", body.token).maybeSingle<Pick<Client, "id" | "dashboard_token">>();
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  await notifyClient(c.id, { title: "Notifications are on", body: "You'll get a notification for missed calls and new customer messages.", url: `/m/${c.dashboard_token}` });
  return Response.json({ ok: true });
}
