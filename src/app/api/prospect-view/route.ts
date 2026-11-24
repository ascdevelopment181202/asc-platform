import { notifyAdmin } from "@/lib/email";
import { recordProspectView } from "@/lib/prospects";

export const runtime = "nodejs";

const BOT = /bot|crawl|spider|slurp|preview|lighthouse|headless|monitor|curl|wget|python|axios/i;

/** Beacon from /p/<slug> preview pages: { slug }. Emails ASC the first time a prospect opens theirs. Always 204. */
export async function POST(request: Request) {
  const done = new Response(null, { status: 204 });
  if (BOT.test(request.headers.get("user-agent") ?? "")) return done;
  let slug = "";
  try {
    slug = String(JSON.parse(await request.text()).slug ?? "");
  } catch {
    return done;
  }
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return done;
  try {
    const first = await recordProspectView(slug);
    if (first) {
      await notifyAdmin(`${first.name} just opened their preview`, [
        `${first.name} (${first.area || first.postcode || "London"}) opened their preview page for the first time.`,
        "",
        `Call now: ${first.phone || "no phone on file"}`,
        first.owner_name ? `Ask for: ${first.owner_name}` : "",
        `Page: ${first.preview_url ?? ""}?review`,
      ]);
    }
  } catch (e) {
    console.error("prospect-view", e);
  }
  return done;
}
