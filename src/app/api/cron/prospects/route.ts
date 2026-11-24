import { env } from "@/lib/env";
import { notifyAdmin } from "@/lib/email";
import { buildPreviews } from "@/lib/prospects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily (see vercel.json). Turns outbound prospects that passed the AI search check into
 * preview pages with a drafted email, then emails ASC the batch to review. Sends nothing to prospects.
 */
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit")) || 10, 30);
  const log = await buildPreviews(limit);
  const ready = log.filter((l) => l.startsWith("ready:"));
  if (ready.length) {
    await notifyAdmin(`${ready.length} clinic previews ready to review`, [
      "Check each page and its drafted email before sending. Add ?review to a link so your visit is not counted.",
      "",
      ...ready.map((l) => `- ${l.slice(7)}?review`),
    ]).catch((e) => console.error("prospects cron email", e));
  }
  return Response.json({ ok: true, log });
}
