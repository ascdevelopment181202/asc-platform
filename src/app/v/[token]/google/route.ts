import { loadFunnel, recordGoogleClick } from "@/lib/review-funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Link previews (iMessage, WhatsApp, etc.) fetch links before anyone taps them. Those don't count.
const PREVIEW_BOT = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slack|discord|telegram|skype|embedly|vkshare|linkedin/i;

/** "Leave a Google review" link on the review page: available to every customer, whatever they rated. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const data = await loadFunnel((await params).token);
  if (!data?.c.google_review_url) return new Response("This review link is no longer active.", { status: 404 });
  if (!PREVIEW_BOT.test(request.headers.get("user-agent") ?? "")) await recordGoogleClick(data, data.job.rating ?? undefined);
  return Response.redirect(data.c.google_review_url, 302);
}
