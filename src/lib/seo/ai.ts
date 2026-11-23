import "server-only";
import { seoEnv } from "@/lib/env";
import { db } from "@/lib/supabase";
import { USD_TO_GBP } from "@/lib/usage";
import { getSettings } from "./store";

/** Dollars per million tokens (input, output). Used only to keep the spend caps honest. */
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-2": [5, 25],
  "claude-opus-5-5": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  gemini: [0.3, 2.5],
  openai: [1.25, 10],
  perplexity: [1, 1],
};
const SEARCH_USD = 0.01; // one web search, roughly, on any provider

export const MODELS = {
  quick: "claude-haiku-5-5", // sorting, short text
  write: () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", // page copy
  think: () => process.env.SEO_STRATEGIST_MODEL || "claude-opus-5-5", // plans
};

export class AiUnavailable extends Error {}

async function monthSpend(clientId?: string | null): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  let q = db().from("seo_ai_usage").select("cost_gbp").gte("created_at", start.toISOString());
  if (clientId) q = q.eq("client_id", clientId);
  const { data } = await q.returns<{ cost_gbp: number }[]>();
  return (data ?? []).reduce((n, r) => n + Number(r.cost_gbp), 0);
}

export async function aiSpend(clientId?: string | null) {
  return { spent: await monthSpend(clientId), cap: seoEnv.aiMonthlyCapGbp() };
}

/** Why AI work can't run right now, or null when it can. Every provider counts towards the same caps. */
export async function aiBlocked(clientId: string | null): Promise<string | null> {
  if ((await monthSpend(null)) >= seoEnv.aiMonthlyCapGbp()) return `The monthly AI cap of £${seoEnv.aiMonthlyCapGbp()} across all clients has been reached. AI work restarts next month, or raise SEO_AI_MONTHLY_CAP_GBP.`;
  if (clientId) {
    const s = await getSettings(clientId);
    const budget = s?.config.aiBudgetGbp ?? 3;
    if ((await monthSpend(clientId)) >= budget) return `This client's AI budget of £${budget} for the month has been used. Raise it in Settings or wait for next month.`;
  }
  return null;
}

async function record(clientId: string | null, provider: string, model: string, purpose: string, input: number, output: number, searches = 0) {
  const [pi, po] = PRICES[model] ?? PRICES[provider] ?? [2, 10];
  const usd = (input * pi + output * po) / 1_000_000 + searches * SEARCH_USD;
  await db().from("seo_ai_usage").insert({ client_id: clientId, provider, model, purpose, input_tokens: input, output_tokens: output, cost_gbp: Math.round(usd * USD_TO_GBP * 100000) / 100000 });
}

export type Source = { title?: string; url: string };
export type Answer = { text: string; sources: Source[] };

const noDash = (s: string) => s.replace(/\s*—\s*/g, ", ");

/** One Claude call. Throws AiUnavailable when there's no key or a cap is hit, so callers can say why. */
export async function claude(o: { clientId: string | null; purpose: string; model: string; system: string; user: string; maxTokens?: number; webSearch?: number; temperature?: number }): Promise<Answer> {
  const key = seoEnv.anthropicKey();
  if (!key) throw new AiUnavailable("Add ANTHROPIC_API_KEY in Vercel to turn on AI drafting.");
  const blocked = await aiBlocked(o.clientId);
  if (blocked) throw new AiUnavailable(blocked);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: o.model,
      max_tokens: o.maxTokens ?? 2000,
      // No temperature: current Claude models reject it ("deprecated for this model").
      system: o.system,
      messages: [{ role: "user", content: o.user }],
      ...(o.webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: o.webSearch }] } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  type Block = { type: string; text?: string; citations?: { url?: string; title?: string }[]; content?: { type?: string; url?: string; title?: string }[] };
  const data = (await res.json()) as { content?: Block[]; usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } } };
  const sources: Source[] = [];
  for (const b of data.content ?? []) {
    for (const c of b.citations ?? []) if (c.url) sources.push({ url: c.url, title: c.title });
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.push({ url: r.url, title: r.title });
  }
  await record(o.clientId, "anthropic", o.model, o.purpose, data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0, data.usage?.server_tool_use?.web_search_requests ?? 0);
  const text = noDash((data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join(""));
  return { text, sources: dedupe(sources) };
}

const dedupe = (s: Source[]) => [...new Map(s.map((x) => [x.url, x])).values()].slice(0, 12);

/** Pulls the first JSON object or array out of a model reply. */
export function parseJson<T>(text: string): T | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const end = text.lastIndexOf(open === "{" ? "}" : "]");
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export async function claudeJson<T>(o: Parameters<typeof claude>[0]): Promise<T | null> {
  const a = await claude({ ...o, system: `${o.system}\n\nReply with JSON only. No prose before or after. Never use em dashes.` });
  return parseJson<T>(a.text);
}

// ---------- Other AI tools, used only to check whether they name the client ----------

/** Gemini with Google Search grounding: the closest thing to Google's AI Overviews and AI Mode. */
export async function askGemini(clientId: string, question: string): Promise<Answer | null> {
  const key = seoEnv.geminiKey();
  if (!key || (await aiBlocked(clientId))) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: question }] }], tools: [{ google_search: {} }] }), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const c = j.candidates?.[0];
  await record(clientId, "gemini", "gemini", "ai-visibility", j.usageMetadata?.promptTokenCount ?? 0, j.usageMetadata?.candidatesTokenCount ?? 0, 1);
  return { text: (c?.content?.parts ?? []).map((p) => p.text ?? "").join(""), sources: dedupe((c?.groundingMetadata?.groundingChunks ?? []).filter((g) => g.web?.uri).map((g) => ({ url: g.web!.uri!, title: g.web!.title }))) };
}

/** ChatGPT with web search, through the OpenAI Responses API. */
export async function askChatGpt(clientId: string, question: string, country?: "GB" | "US"): Promise<Answer | null> {
  const key = seoEnv.openaiKey();
  if (!key || (await aiBlocked(clientId))) return null;
  const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5-mini", input: question, tools: [{ type: "web_search", user_location: { type: "approximate", country: country ?? "GB" } }] }), signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const j = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  let text = "";
  const sources: Source[] = [];
  for (const o of j.output ?? []) for (const c of o.content ?? []) {
    text += c.text ?? "";
    for (const a of c.annotations ?? []) if (a.url) sources.push({ url: a.url, title: a.title });
  }
  await record(clientId, "openai", "openai", "ai-visibility", j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0, 1);
  return { text, sources: dedupe(sources) };
}

export async function askPerplexity(clientId: string, question: string): Promise<Answer | null> {
  const key = seoEnv.perplexityKey();
  if (!key || (await aiBlocked(clientId))) return null;
  const res = await fetch("https://api.perplexity.ai/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: question }] }), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Perplexity ${res.status}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; citations?: string[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  await record(clientId, "perplexity", "perplexity", "ai-visibility", j.usage?.prompt_tokens ?? 0, j.usage?.completion_tokens ?? 0, 1);
  return { text: j.choices?.[0]?.message?.content ?? "", sources: (j.citations ?? []).map((url) => ({ url })) };
}
