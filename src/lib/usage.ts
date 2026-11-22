import "server-only";
import { db, type Client } from "@/lib/supabase";
import { segmentsOf } from "@/lib/sms-text";

// List prices (USD) from twilio.com/sms/pricing, November 2026. Update here if Twilio changes them.
// US outbound/inbound include the average carrier fee.
export const RATES = {
  GB: { out: 0.056, in: 0.0075, number: 2.5 },
  US: { out: 0.0125, in: 0.0113, number: 1.15 },
  failedFee: 0.001,
} as const;
/** Dollars to pounds, for showing costs in GBP. Override with USD_TO_GBP in Vercel. */
export const USD_TO_GBP = Number(process.env.USD_TO_GBP) || 0.79;

/** Fixed monthly platform costs in USD. Override the defaults with env vars as plans change. */
export function platformCosts(): { name: string; usd: number }[] {
  return [
    { name: "Vercel Pro (hosting)", usd: Number(process.env.COST_VERCEL_USD ?? 20) },
    { name: "Supabase (database)", usd: Number(process.env.COST_SUPABASE_USD ?? 0) },
    { name: "Resend (email)", usd: Number(process.env.COST_RESEND_USD ?? 0) },
  ];
}

export const KIND_LABEL: Record<string, string> = {
  missed_call: "Missed-call replies",
  review: "Review requests",
  campaign: "Campaigns",
  manual: "Owner texts, quotes, bookings",
  owner_forward: "Texts to the owner",
  owner_confirm: "Texts to the owner",
  test: "Tests",
};

export type ClientUsage = {
  client: Pick<Client, "id" | "business_name" | "country" | "twilio_number" | "sms_budget_gbp" | "campaign_monthly_limit">;
  sentTexts: number;
  sentSegments: number;
  failed: number;
  receivedSegments: number;
  byKind: Record<string, number>; // segments by kind
  costGbp: number; // month to date: texts + number
  projectedGbp: number; // at this rate to the end of the month
};

export function monthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const elapsed = Math.max((now.getTime() - start.getTime()) / (end.getTime() - start.getTime()), 1 / 31);
  return { start, end, elapsed };
}

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await build(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Real usage and cost for every client this month (or for one client). */
export async function usageThisMonth(clientId?: string, now = new Date()): Promise<ClientUsage[]> {
  const { start, end, elapsed } = monthRange(now);
  let cq = db().from("clients").select("id, business_name, country, twilio_number, sms_budget_gbp, campaign_monthly_limit").neq("status", "cancelled");
  if (clientId) cq = cq.eq("id", clientId);
  const { data: clients } = await cq.returns<ClientUsage["client"][]>();
  if (!clients?.length) return [];
  const ids = clients.map((c) => c.id);

  const [sent, received] = await Promise.all([
    all<{ client_id: string; kind: string; body: string; segments: number | null; status: string | null }>((a, b) =>
      db().from("sms_log").select("client_id, kind, body, segments, status").in("client_id", ids).gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).range(a, b),
    ),
    all<{ client_id: string; body: string | null }>((a, b) =>
      db().from("replies").select("client_id, body").in("client_id", ids).gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).range(a, b),
    ),
  ]);

  return clients
    .map((c) => {
      const r = c.country === "US" ? RATES.US : RATES.GB;
      const mineSent = sent.filter((s) => s.client_id === c.id);
      const failed = mineSent.filter((s) => s.status === "failed").length;
      const billable = mineSent.filter((s) => s.status !== "failed");
      const byKind: Record<string, number> = {};
      let sentSegments = 0;
      for (const s of billable) {
        const seg = s.segments ?? segmentsOf(s.body);
        sentSegments += seg;
        byKind[s.kind] = (byKind[s.kind] ?? 0) + seg;
      }
      const receivedSegments = received.filter((x) => x.client_id === c.id).reduce((n, x) => n + Math.max(1, segmentsOf(x.body ?? "")), 0);
      const usageUsd = sentSegments * r.out + receivedSegments * r.in + failed * RATES.failedFee;
      const numberUsd = c.twilio_number ? r.number : 0;
      return {
        client: c,
        sentTexts: billable.length,
        sentSegments,
        failed,
        receivedSegments,
        byKind,
        costGbp: (usageUsd + numberUsd) * USD_TO_GBP,
        projectedGbp: (usageUsd / elapsed + numberUsd) * USD_TO_GBP,
      };
    })
    .sort((a, b) => b.costGbp - a.costGbp);
}

export const gbp = (n: number) => `£${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;
