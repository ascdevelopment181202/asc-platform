import { loadClientBySlug } from "@/lib/review-funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Leave a Google review" on the shareable page: open to everyone, whatever they rated. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await loadClientBySlug((await params).slug);
  if (!c?.google_review_url) return new Response("This review page isn't set up yet.", { status: 404 });
  return Response.redirect(c.google_review_url, 302);
}
