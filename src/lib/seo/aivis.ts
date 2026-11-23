import "server-only";
import { seoEnv } from "@/lib/env";
import { db } from "@/lib/supabase";
import type { AiCheck, Finding, SeoConfig } from "./types";
import { AiUnavailable, askChatGpt, askGemini, askPerplexity, claude, MODELS, type Answer } from "./ai";
import { todayLondon } from "./store";
import { valueOf } from "./value";

export function aiQuestions(cfg: SeoConfig): string[] {
  const s = cfg.services ?? [];
  const t = cfg.towns ?? [];
  if (!s.length || !t.length) return [];
  const where = cfg.country === "US" ? "" : " UK";
  return [`Who are the best ${s[0].toLowerCase()} companies in ${t[0]}${where}?`, s[1] ? `Can you recommend someone for ${s[1].toLowerCase()} in ${t[0]}${where}?` : `Who should I call for ${s[0].toLowerCase()} near ${t[0]}${where}?`, t[1] ? `Best rated ${s[0].toLowerCase()} in ${t[1]}${where}?` : `How much does ${s[0].toLowerCase()} cost in ${t[0]}${where} and who does it well?`].slice(0, 3);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
export function namesClient(a: Answer, cfg: SeoConfig): boolean {
  const name = norm(cfg.facts?.businessName ?? "");
  const text = norm(a.text);
  const domain = (cfg.domain ?? "").replace(/^www\./, "");
  return (name.length >= 4 && text.includes(name)) || (!!domain && (a.text.toLowerCase().includes(domain) || a.sources.some((s) => s.url.includes(domain))));
}

/** Asks each connected AI tool the questions a customer would, and records whether the client is named. */
export async function checkAiVisibility(clientId: string, cfg: SeoConfig): Promise<{ checks: AiCheck[]; note?: string }> {
  const questions = aiQuestions(cfg);
  if (!questions.length) return { checks: [], note: "Add services and towns in Settings first." };
  const providers: { name: string; ask: (q: string) => Promise<Answer | null> }[] = [];
  if (seoEnv.geminiKey()) providers.push({ name: "gemini", ask: (q) => askGemini(clientId, q) });
  if (seoEnv.openaiKey()) providers.push({ name: "chatgpt", ask: (q) => askChatGpt(clientId, q, cfg.country) });
  if (seoEnv.perplexityKey()) providers.push({ name: "perplexity", ask: (q) => askPerplexity(clientId, q) });
  // With none of those connected, Claude's own web search stands in, labelled as such.
  if (!providers.length) providers.push({ name: "claude", ask: (q) => claude({ clientId, purpose: "ai-visibility", model: MODELS.quick, system: "You are a helpful assistant answering a local customer's question. Search the web and name specific local businesses.", user: q, maxTokens: 700, webSearch: 2 }) });
  const today = todayLondon();
  const checks: AiCheck[] = [];
  let note: string | undefined;
  for (const p of providers) for (const q of questions) {
    try {
      const a = await p.ask(q);
      if (!a) continue;
      const check: AiCheck = { checked_on: today, provider: p.name, question: q, named: namesClient(a, cfg), sources: a.sources.slice(0, 8), excerpt: a.text.slice(0, 600) };
      checks.push(check);
      await db().from("seo_ai_checks").insert({ client_id: clientId, ...check });
    } catch (err) {
      note = err instanceof AiUnavailable ? err.message : `${p.name}: ${err instanceof Error ? err.message : err}`;
      if (err instanceof AiUnavailable) return { checks, note };
    }
  }
  return { checks, note };
}

export async function recentAiChecks(clientId: string, limit = 120): Promise<AiCheck[]> {
  const { data } = await db().from("seo_ai_checks").select("*").eq("client_id", clientId).order("checked_on", { ascending: false }).limit(limit).returns<AiCheck[]>();
  return data ?? [];
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export function aiFindings(cfg: SeoConfig, checks: AiCheck[], monthlyClicks: number): Finding[] {
  if (checks.length < 2) return [];
  const named = checks.filter((c) => c.named).length;
  if (named / checks.length >= 0.5) return [];
  const counts = new Map<string, number>();
  for (const c of checks) for (const s of c.sources) counts.set(host(s.url), (counts.get(host(s.url)) ?? 0) + 1);
  const top = [...counts.entries()].filter(([h]) => h !== cfg.domain).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const v = valueOf({ clicks: Math.max(3, monthlyClicks * 0.05) }, cfg, [{ label: "Being named in AI answers", value: "about 5% more visitors", assumed: true }]);
  const tools = [...new Set(checks.map((c) => c.provider))].join(", ");
  return [{
    kind: "ai_visibility",
    type: "AI search",
    dedupe: "ai_visibility",
    summary: `AI answers named the business in ${named} of ${checks.length} checks: get listed where they look.`,
    detail: { evidence: { why: `Asked ${tools}${tools === "claude" ? " (Claude only, until Gemini and ChatGPT keys are added)" : ""} ${checks.length} questions a customer would ask, on ${checks[0].checked_on}. The business was named in ${named}.${top.length ? ` The answers leaned on: ${top.map(([h, n]) => `${h} (${n})`).join(", ")}.` : ""} AI tools recommend businesses they can confirm from several sources.`, numbers: checks.slice(0, 6).map((c) => ({ label: `${c.provider}: ${c.question}`, value: c.named ? "Named" : "Not named" })) }, gain: { clicks: Math.max(3, monthlyClicks * 0.05), gbp: Math.round(v.gbp) }, chain: v.chain, confidence: "Low", effort: "30 min manual", risk: "Low", undoable: false },
    draft: { target: "manual", minutes: 30, steps: [...top.slice(0, 5).map(([h]) => ({ text: `Check the business is listed, with matching name, address and phone, on ${h}.`, url: `https://${h}` })), { text: "Work through the Citations tab so the same details appear everywhere AI tools look." }, { text: "Press Mark done. The check runs again next week." }] },
  }];
}
