import { db, type Client } from "@/lib/supabase";
import { textToHtml } from "@/lib/email";
import { lastThirtyDays, reportEmail, reportStats } from "@/lib/reports";
import type { Site } from "@/lib/sites";

export const dynamic = "force-dynamic";

/** Preview of the report email for the last 30 days (admin only, via proxy auth). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data: c }, { data: site }] = await Promise.all([
    db().from("clients").select("*").eq("id", id).maybeSingle<Client>(),
    db().from("sites").select("*").eq("client_id", id).maybeSingle<Site>(),
  ]);
  if (!c || !site) return new Response("No client or site", { status: 404 });
  const mail = reportEmail(c, site, await reportStats(site, lastThirtyDays()));
  const body = `<!doctype html><meta charset="utf-8"><title>Report preview</title>
<div style="max-width:640px;margin:32px auto;font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p style="color:#666;font-size:13px">To: ${c.email}<br>Subject: <strong>${mail.subject.replace(/</g, "&lt;")}</strong></p><hr>
${textToHtml(mail.text)}</div>`;
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}
