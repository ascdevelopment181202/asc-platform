import { areaPage } from "@/lib/seo-pages";
import { renderSeoPage } from "@/lib/seo-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ site: string; area: string }> }) {
  const p = await params;
  return renderSeoPage(p.site, (ctx) => areaPage(ctx.site.content, p.area));
}
