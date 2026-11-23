import { env, seoEnv } from "@/lib/env";
import { db } from "@/lib/supabase";
import { progressPr } from "@/lib/seo/apply";
import { prune, runClient } from "@/lib/seo/engine";
import { morningEmail } from "@/lib/seo/mail";
import { globalPaused, listActions, londonHour, todayLondon } from "@/lib/seo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Runs hourly (see vercel.json) and does nothing unless SEO_AUTOPILOT=1.
 * From 5am UK time it works through each enabled client once a day, a few at a time,
 * carrying any it didn't reach into the next hour. A client that has never run is picked up at any hour. Clients are claimed in the database,
 * so two runs never work on the same client. At 8am it sends the morning email.
 */
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) return new Response("Unauthorized", { status: 401 });
  if (!seoEnv.on()) return Response.json({ ok: true, off: true });

  const started = Date.now();
  const left = () => 240_000 - (Date.now() - started);
  const hour = londonHour();
  const log: string[] = [];

  try {
    // Daily runs start at 5am. A client that has never run gets its first audit on the next tick, whatever the hour.
    {
      while (left() > 90_000) {
        const { data: ids, error } = await db().rpc("claim_seo_runs", { p_today: todayLondon(), p_limit: 1, p_first_only: hour < 5 });
        if (error) {
          log.push(`claim failed: ${error.message}`);
          break;
        }
        const id = (ids as string[] | null)?.[0];
        if (!id) break;
        try {
          const out = await runClient(id, "daily", started + 215_000);
          log.push(`${id}: ${out.join("; ") || "ok"}`);
        } catch (err) {
          log.push(`${id} failed: ${err instanceof Error ? err.message : String(err)}`);
          await db().from("seo_settings").update({ run_claimed_at: null }).eq("client_id", id);
        }
      }
    }
    // Pull requests waiting on a preview build move along every hour, unless everything is paused.
    if (left() > 30_000 && !(await globalPaused())) {
      const open = (await listActions({ statuses: ["new", "approved"], limit: 300 })).filter((a) => a.apply?.prNumber && (a.apply.build !== "ok" || a.status === "approved" || !a.apply.visual));
      for (const a of open.slice(0, 8)) {
        if (left() < 20_000) break;
        log.push(`PR ${a.apply!.prNumber}: ${await progressPr(a.id).catch((e) => (e instanceof Error ? e.message : String(e)))}`);
      }
    }
    if (hour === 8) log.push(`morning email: ${await morningEmail()}`);
    if (hour === 4) await prune();
  } catch (err) {
    log.push(`cron error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return Response.json({ ok: true, hour, ms: Date.now() - started, log });
}
