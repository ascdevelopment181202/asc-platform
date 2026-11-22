import { loadOwnDoc, pdfFileName, renderDocPdf } from "@/lib/doc-pdf";
import { loadClient } from "../../../data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The owner's PDF of any of their quotes or invoices, drafts included. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const c = await loadClient(token);
  if (!c) return new Response("Not found", { status: 404 });
  const bundle = await loadOwnDoc(c.id, id);
  if (!bundle) return new Response("Not found", { status: 404 });
  const bytes = await renderDocPdf(bundle);
  const download = new URL(request.url).searchParams.has("download");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${pdfFileName(bundle)}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
