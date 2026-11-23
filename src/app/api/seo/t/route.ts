import { db } from "@/lib/supabase";

export const runtime = "nodejs";

const BOT = /bot|crawl|spider|slurp|preview|lighthouse|headless|monitor|curl|wget|python|axios/i;
const KINDS = new Set(["view", "call", "form", "directions"]);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };

/** Where a visit came from: AI tools, Google Maps or the Business Profile, search, social, or direct. */
function sourceOf(referrer: string, query: string, pageHost: string): string {
  if (/utm_campaign=gbp/i.test(query)) return "maps";
  if (/utm_source=(chatgpt|perplexity|copilot|gemini|claude)/i.test(query)) return "ai";
  if (!referrer) return "direct";
  let h = "";
  let path = "";
  try {
    const u = new URL(referrer);
    h = u.hostname.replace(/^www\./, "");
    path = u.pathname;
  } catch {
    return "other";
  }
  if (h === pageHost.replace(/^www\./, "")) return "internal";
  if (/chatgpt\.com|chat\.openai\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai|you\.com|phind\.com|meta\.ai/.test(h)) return "ai";
  if (/(^|\.)google\./.test(h) && /^\/maps/.test(path)) return "maps";
  if (/(^|\.)google\.|bing\.com|duckduckgo|yahoo\.|ecosia|search\.brave/.test(h)) return "search";
  if (/facebook|instagram|fb\.|t\.co$|twitter|x\.com|linkedin|tiktok|nextdoor|whatsapp/.test(h)) return "social";
  return "other";
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Beacon from client sites: { t: token, k: kind, p: path, r: referrer, q: query string }. Always 204. Counts only. */
export async function POST(request: Request) {
  const done = new Response(null, { status: 204, headers: CORS });
  if (BOT.test(request.headers.get("user-agent") ?? "")) return done;
  let body: { t?: string; k?: string; p?: string; r?: string; q?: string };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return done;
  }
  if (!body.t || !/^[0-9a-f]{16}$/.test(body.t) || !KINDS.has(body.k ?? "") || typeof body.p !== "string" || !body.p.startsWith("/")) return done;
  let host = "";
  try {
    host = new URL(request.headers.get("origin") ?? request.headers.get("referer") ?? "").hostname;
  } catch {}
  const source = sourceOf(typeof body.r === "string" ? body.r : "", typeof body.q === "string" ? body.q : "", host);
  await db().rpc("track_seo_event", { p_token: body.t, p_kind: body.k, p_path: body.p, p_source: source });
  return done;
}
