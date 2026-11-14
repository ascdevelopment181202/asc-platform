import { createEnquiry, type EnquiryInput } from "@/lib/enquiries";

export const runtime = "nodejs";

/** Receives the quote form on client websites (works on custom domains too, as /api is not rewritten). */
export async function POST(request: Request) {
  let body: EnquiryInput;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  const result = await createEnquiry(body);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
