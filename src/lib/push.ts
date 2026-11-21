import "server-only";
import webpush from "web-push";
import { db } from "./supabase";
import { env } from "./env";

type Vapid = { publicKey: string; privateKey: string };
let cached: Vapid | null = null;

/**
 * Web push signing keys. Generated on first use and kept in Supabase (service role only),
 * so there's nothing to copy into Vercel and the private key never leaves the server.
 */
async function vapid(): Promise<Vapid> {
  if (cached) return cached;
  const { data } = await db().from("app_secrets").select("value").eq("name", "vapid").maybeSingle<{ value: Vapid }>();
  if (data?.value?.publicKey) return (cached = data.value);
  const keys = webpush.generateVAPIDKeys();
  // If two requests race, the first insert wins and both read it back.
  await db().from("app_secrets").insert({ name: "vapid", value: keys });
  const { data: saved } = await db().from("app_secrets").select("value").eq("name", "vapid").single<{ value: Vapid }>();
  return (cached = saved!.value);
}

export async function vapidPublicKey() {
  return (await vapid()).publicKey;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

/** Sends a notification to every phone that switched them on for this client. Never throws. */
export async function notifyClient(clientId: string, msg: PushMessage) {
  try {
    const { data: subs } = await db()
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("client_id", clientId)
      .returns<{ id: string; endpoint: string; p256dh: string; auth: string }[]>();
    if (!subs?.length) return;
    const keys = await vapid();
    const options = { vapidDetails: { subject: `mailto:${env.adminEmail}`, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 3600, urgency: "high" as const };
    const payload = JSON.stringify(msg);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
          await db().from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", s.id);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 404/410: the phone removed the app or turned notifications off.
          if (status === 404 || status === 410) await db().from("push_subscriptions").delete().eq("id", s.id);
          else console.error("Push failed", clientId, status, err instanceof Error ? err.message : err);
        }
      }),
    );
  } catch (err) {
    console.error("notifyClient failed", clientId, err instanceof Error ? err.message : err);
  }
}
