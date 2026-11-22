import { db, type Client } from "@/lib/supabase";
import { createJob } from "@/lib/sms";
import { notifyClient } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Job-software trigger. Zapier or Make posts here when a job is completed or an invoice is paid
 * in Jobber, Tradify, ServiceM8, Xero, QuickBooks and so on, and we ask that customer for a review.
 * POST /api/intake/<client intake_token> with JSON or form fields: name, phone, email, job.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{24}$/.test(token)) return Response.json({ ok: false, error: "Unknown link" }, { status: 404 });
  const { data: c } = await db().from("clients").select("*").eq("intake_token", token).maybeSingle<Client>();
  if (!c) return Response.json({ ok: false, error: "Unknown link" }, { status: 404 });

  let body: Record<string, unknown> = {};
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("json")) body = (await request.json()) as Record<string, unknown>;
    else body = Object.fromEntries((await request.formData()).entries());
  } catch {
    return Response.json({ ok: false, error: "Couldn't read the request body" }, { status: 400 });
  }
  // Accept whatever the job software calls its fields.
  const pick = (...keys: string[]) => {
    const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [k.toLowerCase().replace(/[\s_-]/g, ""), v]));
    for (const k of keys) {
      const v = lower[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return "";
  };
  const first = pick("firstname", "givenname");
  const last = pick("lastname", "surname", "familyname");
  const name = pick("name", "fullname", "customername", "clientname", "contactname") || [first, last].filter(Boolean).join(" ");
  const phone = pick("phone", "mobile", "cell", "mobilephone", "cellphone", "phonenumber", "mobilenumber", "customerphone", "telephone", "tel");
  const email = pick("email", "emailaddress", "customeremail");
  const job = pick("job", "jobtitle", "service", "description", "title", "item", "jobdescription", "worktype");

  if (!phone) return Response.json({ ok: false, error: "No phone number sent. Map the customer's mobile to a field called phone." }, { status: 422 });
  const result = await createJob(c, { phone, name: name || null, email: email || null, source: "integration", label: job || null });
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 200 });

  await notifyClient(c.id, {
    title: `Review request queued for ${result.contact.name?.split(/\s+/)[0] ?? "a customer"}`,
    body: "From your job software. Tap if you'd rather not send it.",
    url: `/m/${c.dashboard_token}/reviews/job/${result.job.id}`,
    tag: `review-${result.job.id}`,
  });
  return Response.json({ ok: true, sendsAt: result.firstSendAt.toISOString() });
}

export function GET() {
  return Response.json({ ok: true, info: "Send a POST with name, phone, email and job to ask this customer for a review." });
}
