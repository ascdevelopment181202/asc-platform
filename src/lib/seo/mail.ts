import "server-only";
import { env, seoEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import type { Finding, MonthResult, SeoAction, SeoConfig } from "./types";
import { kvGet, kvSet, todayLondon } from "./store";

/** One short email at 8am when there's something new. Nothing on quiet days. */
export async function morningEmail(): Promise<string> {
  const today = todayLondon();
  if ((await kvGet<string>("morning_sent")) === today) return "already sent";
  const since = (await kvGet<string>("morning_since")) ?? new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await db().from("seo_actions").select("client_id, type, summary, detail, created_at, draft").eq("status", "new").order("score", { ascending: false }).limit(200).returns<Pick<SeoAction, "client_id" | "type" | "summary" | "detail" | "created_at" | "draft">[]>();
  const open = data ?? [];
  const fresh = open.filter((a) => a.created_at > since);
  const alerts = open.filter((a) => a.detail.alert);
  await kvSet("morning_sent", today);
  await kvSet("morning_since", new Date().toISOString());
  const { data: st } = await db().from("seo_settings").select("client_id, state").eq("enabled", true).returns<{ client_id: string; state: { gsc?: { ok: boolean }; gbp?: { ok: boolean } } }[]>();
  const lost = (st ?? []).filter((x) => (x.state.gsc && !x.state.gsc.ok) || (x.state.gbp && !x.state.gbp.ok));
  if (!fresh.length && !alerts.length && !lost.length) return "quiet day";
  const { data: clients } = await db().from("clients").select("id, business_name, full_name, email").returns<Pick<Client, "id" | "business_name" | "full_name" | "email">[]>();
  const name = new Map((clients ?? []).map((c) => [c.id, clientLabel(c)]));
  const minutes = Math.max(1, Math.round(fresh.reduce((n, a) => n + (a.draft?.target === "manual" ? (a.draft.minutes ?? 5) : 0.5), 0)));
  const lines = [
    ...lost.map((x) => `**Disconnected:** ${name.get(x.client_id) ?? "A client"}'s ${x.state.gsc && !x.state.gsc.ok ? "Search Console" : "Business Profile"} has stopped answering. Open their SEO page for the fix.`),
    alerts.length ? `**${alerts.length} alert${alerts.length === 1 ? "" : "s"}:**` : "",
    ...alerts.slice(0, 5).map((a) => `- ${name.get(a.client_id) ?? "Client"}: ${a.summary}`),
    fresh.length ? `**${fresh.length} new SEO action${fresh.length === 1 ? "" : "s"}, about ${minutes} minute${minutes === 1 ? "" : "s"}:**` : "",
    ...fresh.slice(0, 8).map((a) => `- ${name.get(a.client_id) ?? "Client"}: ${a.summary}`),
    fresh.length > 8 ? `...and ${fresh.length - 8} more.` : "",
    `Open the inbox: ${seoEnv.appUrl()}/admin/seo`,
  ].filter(Boolean);
  await sendEmail({ to: env.adminEmail, subject: `[ASC] ${alerts.length ? `${alerts.length} SEO alert${alerts.length === 1 ? "" : "s"}, ` : ""}${fresh.length} SEO action${fresh.length === 1 ? "" : "s"}, about ${minutes} min`, text: lines.join("\n\n").replace(/\n\n- /g, "\n- ") });
  return `sent: ${fresh.length} new, ${alerts.length} alerts`;
}

/** A draft of the monthly "here's what you got" email for the client. It only goes when Ayush approves it. */
export function clientReportFinding(c: Client, cfg: SeoConfig, results: MonthResult[], done: string[]): Finding | null {
  if (!cfg.clientReport || results.length < 2) return null;
  const last = results[results.length - 2]; // the last full month
  const prev = results[results.length - 3];
  const month = new Date(`${last.month}-15`).toLocaleDateString("en-GB", { month: "long" });
  const leads = last.profileCalls + last.siteCalls + last.forms + last.enquiries;
  const wins = [
    last.profileCalls ? `${last.profileCalls} calls from your Google profile${prev ? ` (${prev.profileCalls} the month before)` : ""}` : "",
    last.directions ? `${last.directions} people asked Google for directions to you` : "",
    last.siteCalls + last.forms + last.enquiries ? `${last.siteCalls + last.forms + last.enquiries} calls and enquiries from your website` : "",
    ...done.slice(0, 4),
  ].filter(Boolean);
  if (!wins.length) return null;
  const body = `Hi ${c.first_name ?? "there"},\n\nA quick update on what Google brought you in ${month}:\n\n${wins.map((w) => `- ${w}`).join("\n")}\n\nWe keep working on it every week. Any questions, just reply.\n\nAyush\nASC Development`;
  return { kind: "client_report", type: "Manual", dedupe: `client_report:${last.month}`, summary: `Send ${c.first_name ?? "the client"} their ${month} results email (${leads} leads from Google).`, detail: { evidence: { why: `Clients who see their results stay. This is a short, plain email of ${month}'s wins. It never mentions the dashboard. It only goes when you approve it.` }, gain: {}, chain: [{ label: "Retention", value: "Clients who see results keep paying" }], confidence: "High", effort: "1 click", risk: "Low", undoable: false }, draft: { target: "email", fields: [{ name: "subject", label: "Subject", before: "", after: `Your ${month} results from Google` }, { name: "body", label: "Email", before: "", after: body }] } };
}

export async function sendClientReport(c: Client, a: SeoAction) {
  const subject = a.draft?.fields?.find((f) => f.name === "subject")?.after ?? "Your results from Google";
  const text = a.draft?.fields?.find((f) => f.name === "body")?.after ?? "";
  if (!c.email || !text) throw new Error("No email address or no text to send.");
  await sendEmail({ to: c.email, subject, text });
}
