import { after } from "next/server";
import { db, type Client } from "@/lib/supabase";
import { notifyClient } from "@/lib/push";
import type { Job } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Link previews (iMessage, WhatsApp, etc.) fetch the link before anyone taps it. Those don't count as clicks.
const PREVIEW_BOT = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slack|discord|telegram|skype|embedly|vkshare|linkedin/i;

/** Review link in the texts: records the click, stops the reminders, sends the customer to Google. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{12}$/.test(token)) return new Response("Not found", { status: 404 });

  const { data: job } = await db().from("jobs").select("*").eq("review_token", token).maybeSingle<Job>();
  if (!job) return new Response("Not found", { status: 404 });
  const { data: client } = await db().from("clients").select("google_review_url, dashboard_token").eq("id", job.client_id).maybeSingle<Pick<Client, "google_review_url" | "dashboard_token">>();
  if (!client?.google_review_url) return new Response("This review link is no longer active.", { status: 404 });

  const isPreview = PREVIEW_BOT.test(request.headers.get("user-agent") ?? "");
  if (!isPreview && !job.review_clicked_at) {
    const now = new Date().toISOString();
    await db().from("jobs").update({ review_clicked_at: now }).eq("id", job.id);
    await db().from("review_messages").update({ cancelled_at: now }).eq("job_id", job.id).is("sent_at", null).is("cancelled_at", null);
    after(async () => {
      const { data: contact } = await db().from("contacts").select("name").eq("id", job.contact_id).maybeSingle<{ name: string | null }>();
      await notifyClient(job.client_id, {
        title: "Review link opened ⭐",
        body: `${contact?.name ?? "A customer"} just opened your Google review link.`,
        url: `/m/${client.dashboard_token}/c/${job.contact_id}`,
      });
    });
  }
  return Response.redirect(client.google_review_url, 302);
}
