import { z } from "zod";
import { db, type Client } from "@/lib/supabase";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/),
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  }),
});

async function clientFor(token: string) {
  const { data } = await db().from("clients").select("id").eq("dashboard_token", token).maybeSingle<Pick<Client, "id">>();
  return data;
}

/** Saves a phone's push subscription for the client whose app link it came from. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const c = await clientFor(parsed.data.token);
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  const { endpoint, keys } = parsed.data.subscription;
  const { error } = await db()
    .from("push_subscriptions")
    .upsert({ client_id: c.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null }, { onConflict: "endpoint" });
  if (error) return Response.json({ error: "Could not save" }, { status: 500 });
  return Response.json({ ok: true });
}

/** Turning notifications off on this phone. */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: string; endpoint?: string } | null;
  if (!body?.token || !body.endpoint) return Response.json({ error: "Bad request" }, { status: 400 });
  const c = await clientFor(body.token);
  if (!c) return Response.json({ error: "Not found" }, { status: 404 });
  await db().from("push_subscriptions").delete().eq("client_id", c.id).eq("endpoint", body.endpoint);
  return Response.json({ ok: true });
}
