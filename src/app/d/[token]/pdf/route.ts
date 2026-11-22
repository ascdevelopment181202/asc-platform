import { loadPublicDoc, pdfFileName, renderDocPdf } from "@/lib/doc-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The customer's PDF copy of a sent quote or invoice. ?download=1 saves it instead of opening it. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const bundle = await loadPublicDoc((await params).token);
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
