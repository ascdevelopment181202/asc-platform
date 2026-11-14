import { db } from "@/lib/supabase";

export const runtime = "nodejs";

const BOT = /bot|crawl|spider|slurp|preview|lighthouse|headless|monitor|curl|wget|python|axios/i;
const UUID = /^[0-9a-f-]{36}$/i;

/** Where a visit came from, from the referrer. */
function sourceOf(referrer: string, host: string) {
  if (!referrer) return "direct";
  let h = "";
  try {
    h = new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return "other";
  }
  if (h === host.replace(/^www\./, "") || h.endsWith("ascdev.tech")) return "internal";
  if (/(^|\.)google\.|bing\.com|duckduckgo|yahoo\.|ecosia|search\.brave/.test(h)) return "search";
  if (/facebook|instagram|fb\.|t\.co$|twitter|x\.com|linkedin|tiktok|nextdoor|whatsapp/.test(h)) return "social";
  return "other";
}

/** Beacon from client sites: { s: siteId, k: "view" | "call", p: path, r: referrer }. Always 204. */
export async function POST(request: Request) {
  const done = new Response(null, { status: 204 });
  if (BOT.test(request.headers.get("user-agent") ?? "")) return done;
  let body: { s?: string; k?: string; p?: string; r?: string };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return done;
  }
  const kind = body.k === "call" ? "call" : "view";
  if (!body.s || !UUID.test(body.s) || typeof body.p !== "string" || !body.p.startsWith("/")) return done;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const source = sourceOf(typeof body.r === "string" ? body.r : "", host);
  await db().rpc("track_site_event", { p_site: body.s, p_kind: kind, p_path: body.p, p_source: source });
  return done;
}
