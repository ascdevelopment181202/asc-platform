import "server-only";
import { z } from "zod";
import { env } from "./env";
import { db } from "./supabase";
import { prospectEmail, prospectSlug, VERTICAL, type PreviewContent, type Prospect } from "./prospect-kit";

const TABLE = "outbound_prospects";

export async function findProspect(slug: string): Promise<Prospect | null> {
  const { data } = await db().from(TABLE).select("*").eq("preview_slug", slug).maybeSingle<Prospect>();
  return data ?? null;
}

const contentSchema = z.object({
  headline: z.string().min(8).max(90),
  subheadline: z.string().min(20).max(260),
  pageTitle: z.string().min(5).max(90),
  paras: z.array(z.string().min(40)).min(2).max(5),
  services: z.array(z.object({ t: z.string().min(2).max(60), d: z.string().min(15).max(220) })).min(2).max(6),
  faqs: z.array(z.object({ q: z.string().min(8), a: z.string().min(20) })).min(2).max(4),
});

const SYSTEM = `You write a preview web page for a small UK private healthcare or medical training business. A stranger is building it to show the owner what a better page could look like, so accuracy matters more than polish.

Hard rules:
- Use ONLY the facts supplied. Never invent staff names, qualifications, prices, opening hours, awards, insurers, success rates or patient stories.
- No medical claims: do not promise cures, outcomes or recovery times, and do not say a treatment is effective for a condition. Describe what the service involves and who it is for.
- No testimonials or quotes.
- Plain British English a patient would understand. No em dashes. No exclamation marks.
- The specialty section (pageTitle and paras) is about the one specialty named as the page topic.

Reply with JSON only, no prose, matching:
{"headline":"","subheadline":"","pageTitle":"","paras":["",""],"services":[{"t":"","d":""}],"faqs":[{"q":"","a":""}]}`;

/** Asks Claude for the preview page copy. Returns null if not configured or the reply is unusable. */
export async function writePreviewContent(p: Prospect): Promise<PreviewContent | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const specialties = p.specialties ?? [];
  const topic = p.missing_specialty_page || specialties[0];
  if (!topic) return null;
  const user = `Business: ${p.name}
Type: ${VERTICAL[p.vertical]?.label ?? p.vertical}
Area: ${p.area || "London"}
Address: ${p.address || "not given"}
Services they list on their own site: ${specialties.join(", ") || topic}
Online booking on their site: ${p.has_online_booking === true ? "yes" : p.has_online_booking === false ? "no" : "unknown"}
Page topic: ${topic}

Write: a headline (under 70 characters) and subheadline for the business, a specialty section on the page topic (3 or 4 paragraphs), one card per listed service (up to 6), and 3 FAQs a patient would ask about the page topic that can be answered without facts you were not given.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    console.error("Anthropic error", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  try {
    const parsed = contentSchema.safeParse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
    if (!parsed.success) return null;
    // House rule: no em dashes anywhere.
    const strip = (s: string) => s.replace(/\s*—\s*/g, ", ");
    const v = parsed.data;
    return {
      headline: strip(v.headline),
      subheadline: strip(v.subheadline),
      pageTitle: strip(v.pageTitle),
      paras: v.paras.map(strip),
      services: v.services.map((s) => ({ t: strip(s.t), d: strip(s.d) })),
      faqs: v.faqs.map((f) => ({ q: strip(f.q), a: strip(f.a) })),
    };
  } catch {
    return null;
  }
}

/**
 * Stage 4 and 5 for rows that passed the AI search check: writes the preview page, gives it a
 * URL and drafts the email. Rows end at "review_ready"; nothing is sent from here.
 */
export async function buildPreviews(limit = 10) {
  const { data: rows } = await db().from(TABLE).select("*").eq("status", "checked").order("review_count", { ascending: true }).limit(limit).returns<Prospect[]>();
  const log: string[] = [];
  for (const p of rows ?? []) {
    const update = (patch: Record<string, unknown>) => db().from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (p.ai_mentions_clinic !== false) {
      await update({ status: "excluded", exclude_reason: "already named by AI search" });
      log.push(`skip (already named): ${p.name}`);
      continue;
    }
    const content = await writePreviewContent(p);
    if (!content) {
      await update({ notes: "build: no page copy (missing specialties or Claude unavailable)" });
      log.push(`no copy: ${p.name}`);
      continue;
    }
    const slug = p.preview_slug || prospectSlug(p);
    const url = `${env.appUrl}/p/${slug}`;
    const email = prospectEmail(p, url, env.contactPhone);
    const notes = [
      !email ? "No email drafted: AI search named no competitors." : null,
      p.is_incorporated !== true ? "Phone only: not confirmed as a limited company, so do not cold email." : null,
      !p.owner_email ? "No email address found." : null,
    ].filter(Boolean);
    await update({
      status: "review_ready",
      preview_slug: slug,
      preview_url: url,
      preview_content: content,
      email_subject: email?.subject ?? null,
      email_body: email?.body ?? null,
      notes: notes.join(" ") || null,
    });
    log.push(`ready: ${p.name} ${url}`);
  }
  return log;
}

/** Counts a visit to a preview page. Returns the row when this was the first view. */
export async function recordProspectView(slug: string): Promise<Prospect | null> {
  const p = await findProspect(slug);
  if (!p) return null;
  const now = new Date().toISOString();
  await db()
    .from(TABLE)
    .update({ view_count: (p.view_count ?? 0) + 1, last_viewed_at: now, first_viewed_at: p.first_viewed_at ?? now })
    .eq("id", p.id);
  return p.first_viewed_at ? null : p;
}
