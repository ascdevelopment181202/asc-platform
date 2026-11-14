import { env } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { clientLabel, createTask, once } from "@/lib/clients";
import { chase24Email, chase48Email, notifyAdmin, sendEmail } from "@/lib/email";
import { firstNameOf, formLink } from "@/lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 3600_000;

/**
 * Runs hourly (see vercel.json). Every step is recorded in client_messages,
 * so running it twice never sends anything twice.
 */
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  const log: string[] = [];
  const failures: string[] = [];

  const run = async (c: Client, kind: string, fn: () => Promise<unknown>) => {
    try {
      if (await once(c.id, kind, fn)) log.push(`${kind}: ${clientLabel(c)}`);
    } catch (err) {
      failures.push(`${kind}: ${clientLabel(c)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 1. Chase clients who paid but haven't sent the onboarding form.
  const { data: waiting } = await db()
    .from("clients")
    .select("*")
    .eq("status", "awaiting_form")
    .is("form_submitted_at", null)
    .returns<Client[]>();

  for (const c of waiting ?? []) {
    const hours = (now - Date.parse(c.paid_at)) / HOUR;
    const p = { firstName: firstNameOf(c), formLink: formLink(c) };
    if (hours >= 24) await run(c, "chase_24", () => sendEmail({ to: c.email, ...chase24Email(p) }));
    if (hours >= 48) await run(c, "chase_48", () => sendEmail({ to: c.email, ...chase48Email(p) }));
    if (hours >= 72) {
      await run(c, "chase_72_call", async () => {
        await createTask(c.id, `Call ${clientLabel(c)} and fill in the onboarding form with them (${c.phone ?? "no phone"})`, new Date());
        await notifyAdmin(`Call needed: ${clientLabel(c)} hasn't sent their form`, [
          `It's been 72 hours since ${clientLabel(c)} paid and the onboarding form isn't in.`,
          `Phone: ${c.phone ?? "not given"}  |  Email: ${c.email}`,
          `Form link to fill in with them: ${formLink(c)}`,
        ]);
      });
    }
  }

  // 2. Flag builds that are close to, or past, the 48-hour deadline.
  const { data: building } = await db()
    .from("clients")
    .select("*")
    .eq("status", "building")
    .not("build_due_at", "is", null)
    .returns<Client[]>();

  for (const c of building ?? []) {
    const left = (Date.parse(c.build_due_at!) - now) / HOUR;
    if (left <= 12 && left > 0) {
      await run(c, "build_due_soon", () =>
        notifyAdmin(`12 hours left to launch ${clientLabel(c)}`, [`The 48-hour build for ${clientLabel(c)} is due in under 12 hours.`, `${env.appUrl}/admin/clients/${c.id}`]),
      );
    }
    if (left <= 0) {
      await run(c, "build_overdue", () =>
        notifyAdmin(`OVERDUE: ${clientLabel(c)} build is past 48 hours`, [`The 48-hour promise for ${clientLabel(c)} has been missed. Launch today and let them know.`, `${env.appUrl}/admin/clients/${c.id}`]),
      );
    }
  }

  // 3. Day-30 report and referral ask for live clients.
  const { data: live } = await db()
    .from("clients")
    .select("*")
    .eq("status", "live")
    .not("launched_at", "is", null)
    .returns<Client[]>();

  for (const c of live ?? []) {
    const days = (now - Date.parse(c.launched_at!)) / (24 * HOUR);
    if (days >= 30) {
      await run(c, "day30_report", () => createTask(c.id, `Send day-30 report and referral ask to ${clientLabel(c)}`, new Date()));
    }
  }

  if (failures.length) console.error("Chase cron failures", failures);
  return Response.json({ ok: failures.length === 0, done: log, failures });
}
