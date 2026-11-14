import { servicePage } from "@/lib/seo-pages";
import { renderSeoPage } from "@/lib/seo-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ site: string; service: string }> }) {
  const p = await params;
  return renderSeoPage(p.site, (ctx) => servicePage(ctx.site.content, p.service));
}
