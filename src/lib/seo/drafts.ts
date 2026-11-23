import "server-only";
import { db, type Client } from "@/lib/supabase";
import type { Draft, SeoAction, SeoConfig } from "./types";
import { claudeJson, MODELS } from "./ai";
import { get } from "./crawl";
import { parseHtml } from "./onsite";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function factSheet(cfg: SeoConfig): string {
  const f = cfg.facts ?? {};
  const lines = [
    `Business name: ${f.businessName ?? "(unknown)"}`,
    `Trade: ${cfg.trade ?? "(unknown)"}`,
    `Country: ${cfg.country === "US" ? "United States" : "United Kingdom"}`,
    f.phone && `Phone: ${f.phone}`,
    f.email && `Email: ${f.email}`,
    f.address && `Address: ${f.address}`,
    (cfg.services ?? []).length && `Services: ${(cfg.services ?? []).join(", ")}`,
    (cfg.towns ?? []).length && `Towns covered: ${(cfg.towns ?? []).join(", ")}`,
    f.yearsTrading && `Trading: ${f.yearsTrading}`,
    f.accreditations?.length && `Accreditations: ${f.accreditations.join(", ")}`,
    f.guarantees && `Guarantees: ${f.guarantees}`,
    f.priceRanges && `Prices: ${f.priceRanges}`,
    f.team && `Team: ${f.team}`,
    f.about && `About: ${f.about}`,
    cfg.domain && `Website: https://${cfg.domain}`,
  ];
  return lines.filter(Boolean).join("\n");
}

const RULES = (cfg: SeoConfig) => `You are a senior local SEO copywriter for trades businesses. You write plainly, the way a good tradesperson talks to a homeowner.

Hard rules:
- State only facts listed under FACTS or quoted under PAGE or REVIEWS. Never invent accreditations, prices, years in business, guarantees, awards, team names, statistics or customer stories.
- When a fact you need is missing, write [ADD: what is needed] in its place and name it in "gaps".
- ${cfg.country === "US" ? "American spelling." : "British spelling."} No em dashes. No keyword stuffing: the service and town appear naturally, once or twice.
- Nothing against Google's guidelines: no fake reviews, no doorway text, no claims of being "the best" or "number one".`;

type Copy = { title?: string; description?: string; h1?: string; intro?: string; sections?: { h2: string; paragraphs: string[] }[]; faqs?: { q: string; a: string }[]; gaps?: string[] };

const faqLd = (faqs: { q: string; a: string }[]) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) })}</script>`;

function bodyHtml(c: Copy, withH1: boolean): string {
  const parts: string[] = [];
  if (withH1 && c.h1) parts.push(`<h1>${esc(c.h1)}</h1>`);
  if (c.intro) parts.push(`<p>${esc(c.intro)}</p>`);
  for (const s of c.sections ?? []) parts.push(`<h2>${esc(s.h2)}</h2>`, ...s.paragraphs.map((p) => `<p>${esc(p)}</p>`));
  if (c.faqs?.length) parts.push(`<h2>Common questions</h2>`, ...c.faqs.flatMap((f) => [`<h3>${esc(f.q)}</h3>`, `<p>${esc(f.a)}</p>`]), faqLd(c.faqs));
  return parts.join("\n");
}

const gapsNote = (c: { gaps?: string[] } | null, extra?: string) => [extra, c?.gaps?.length ? `Missing facts to add: ${c.gaps.join("; ")}.` : ""].filter(Boolean).join(" ") || undefined;

async function livePage(cfg: SeoConfig, path?: string) {
  if (!cfg.domain || !path || path === "*") return null;
  const g = await get(`https://${cfg.domain}${path === "/" ? "" : path}`);
  return g.status === 200 ? { audit: parseHtml(g.url, g.text), html: g.text } : null;
}

async function townReviews(clientId: string, town?: string): Promise<string[]> {
  const { data } = await db().from("google_reviews").select("comment, reviewer_name, rating").eq("client_id", clientId).gte("rating", 4).not("comment", "is", null).order("created_at", { ascending: false }).limit(60).returns<{ comment: string; reviewer_name: string | null; rating: number }[]>();
  const all = data ?? [];
  const local = town ? all.filter((r) => r.comment.toLowerCase().includes(town.toLowerCase())) : [];
  return (local.length ? local : all).slice(0, 3).map((r) => `"${r.comment.slice(0, 300)}" (${r.reviewer_name ?? "Customer"}, ${r.rating} stars on Google)`);
}

/** Plain instructions for fixes that are a code change rather than new copy. */
const INSTRUCTIONS: Record<string, (a: SeoAction, cfg: SeoConfig) => string> = {
  phone_click: (_a, cfg) => `In the header of every page, make the phone number a tap-to-call link: <a href="tel:${(cfg.facts?.phone ?? "[ADD: phone]").replace(/\s+/g, "")}">${cfg.facts?.phone ?? "[ADD: phone]"}</a>. Keep the existing look. On mobile it must be visible without scrolling.`,
  no_cta: (_a, cfg) => `Add one clear call-to-action button near the top of the home page, in the site's existing button style: "Get a free quote", linking to the contact form or tel:${(cfg.facts?.phone ?? "").replace(/\s+/g, "")}.`,
  no_reviews_shown: () => `Add a short "What customers say" section to the home page using the real Google reviews listed under REVIEWS, each with the reviewer's name and "Google review". Use the site's existing card or quote style. Do not invent reviews.`,
  h1_missing: (a) => `Give each of these pages one <h1> main heading that says what the page is about (service and area): ${a.detail.evidence.why.split(":")[1]?.split(".")[0]?.trim() ?? a.detail.evidence.page}. If the page already has a large visible heading in another tag, change that tag to <h1> and keep its styling.`,
  alt_text: () => `Add a short, honest alt attribute to every <img> that lacks one, describing what the photo shows with the service and town where it's true (for example "Block paving driveway in Watford"). Decorative images get alt="".`,
  broken_links: (a) => `Fix these broken internal links by pointing each to the closest live page, or removing the link if there is none: ${(a.detail.evidence.numbers ?? []).map((n) => `on ${n.label}, the link to ${n.value}`).join("; ")}.`,
  thin_pages: (a) => `These pages have too little text to rank: ${a.detail.evidence.why.split(":")[1]?.trim() ?? ""} Add 150 to 300 words of useful, specific detail to each from the fact sheet, or merge it into a stronger page.`,
  no_js_content: () => `The home page's text is only added by JavaScript. Make the main heading, services, areas, prices and phone number part of the HTML the server sends (server-side render or static HTML), so crawlers that don't run scripts can read them. Do not change the design.`,
  cannibal: (a) => `Two pages compete for "${a.detail.evidence.query}". Pick ${a.detail.evidence.page} as the main one: make sure the other page links to it with that phrase as the link text, and remove the phrase from the other page's title and H1.`,
  dead_pages: () => `Check each listed page in Search Console's URL inspection. If it says "Discovered" or "Crawled, not indexed", link to it from the home page or a service page and add it to the sitemap. If the page has nothing unique on it, merge it into a stronger page.`,
  site_drop: () => `Check three things before changing any page: whether Google confirmed a ranking update on those dates (marked on the chart), whether the same weeks last year dipped too (seasonal), and whether the site was down or pages were removed. If none apply, the weekly review will suggest what to change.`,
};

/** Writes the draft for one inbox item. Returns null when the kind needs nothing written. Throws AiUnavailable when AI can't run. */
export async function draftFor(a: SeoAction, cfg: SeoConfig, c: Client): Promise<Draft | null> {
  const ev = a.detail.evidence;
  const base = { clientId: a.client_id, system: RULES(cfg) };
  const FACTS = `FACTS\n${factSheet(cfg)}`;
  const page = a.draft?.page ?? ev.page;

  if (INSTRUCTIONS[a.kind]) {
    const reviews = a.kind === "no_reviews_shown" ? await townReviews(a.client_id) : [];
    return { target: "site", page, note: INSTRUCTIONS[a.kind](a, cfg) + (reviews.length ? `\n\nREVIEWS\n${reviews.join("\n")}` : "") };
  }

  if (a.kind === "title_rewrite" || a.kind === "meta_fix") {
    const live = await livePage(cfg, page);
    const j = await claudeJson<{ title: string; description: string }>({ ...base, purpose: "title", model: MODELS.quick, maxTokens: 400, user: `${FACTS}\n\nPAGE ${page}\nCurrent title: ${live?.audit.title || "(none)"}\nCurrent description: ${live?.audit.description || "(none)"}\nMain heading: ${live?.audit.h1[0] ?? "(none)"}\nPage text starts: ${live?.audit.text ?? ""}\n\nWhy it needs changing: ${ev.why}\n${ev.queries?.length ? `Searches it shows for: ${ev.queries.join("; ")}` : ""}\n\nWrite a new title (under 60 characters, the service and main town first, the business name last if it fits) and a description (140 to 155 characters, a concrete reason to click, ending with a call to action; include the phone number if there's room).\n\n{"title":"","description":""}` });
    if (!j?.title) return null;
    return { target: "site", page, fields: [{ name: "title", label: "Title", before: live?.audit.title ?? "", after: j.title.slice(0, 70) }, { name: "description", label: "Description", before: live?.audit.description ?? "", after: j.description.slice(0, 170) }] };
  }

  if (a.kind === "answer_block" || a.kind === "faq_schema") {
    const live = await livePage(cfg, page);
    const text = live ? live.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 6000) : "";
    if (a.kind === "faq_schema") {
      const j = await claudeJson<{ faqs: { q: string; a: string }[] }>({ ...base, purpose: "faq-schema", model: MODELS.quick, maxTokens: 1500, user: `PAGE TEXT\n${text}\n\nList the questions and answers that already appear on this page, word for word. Do not add or change any.\n\n{"faqs":[{"q":"","a":""}]}` });
      return j?.faqs?.length ? { target: "site", page, html: faqLd(j.faqs.slice(0, 10)) } : null;
    }
    const j = await claudeJson<{ heading: string; answers: { q: string; a: string }[]; gaps?: string[] }>({ ...base, purpose: "answers", model: MODELS.write(), maxTokens: 1500, user: `${FACTS}\n\nPAGE ${page} (text so far)\n${text}\n\nPeople search these questions and land on this page, but it doesn't answer them directly:\n${(ev.queries ?? []).map((q) => `- ${q}`).join("\n")}\n\nWrite a short section for the top of the page: a heading, then each question as a customer would phrase it with a direct answer of 40 to 70 words. Lead each answer with the answer itself. Prices only if they are in FACTS.\n\n{"heading":"","answers":[{"q":"","a":""}],"gaps":[]}` });
    if (!j?.answers?.length) return null;
    const html = [`<section class="seo-answers">`, `<h2>${esc(j.heading || "Quick answers")}</h2>`, ...j.answers.flatMap((x) => [`<h3>${esc(x.q)}</h3>`, `<p>${esc(x.a)}</p>`]), `</section>`, faqLd(j.answers)].join("\n");
    return { target: "site", page, html, note: gapsNote(j) };
  }

  if (["new_page", "cost_guide", "comparison", "blog"].includes(a.kind)) {
    const town = (cfg.towns ?? []).find((t) => a.summary.toLowerCase().includes(t.toLowerCase()));
    const reviews = await townReviews(a.client_id, town);
    const brief = a.kind === "new_page" ? `A page for one service in one town: ${a.summary.replace(/^Create an? /, "").replace(/ page:.*$/, "")}. It must read as written for that town, not a template with the town swapped in.` : a.kind === "cost_guide" ? `A cost guide answering these price searches: ${(ev.queries ?? []).join("; ")}. Use a simple price table only from prices in FACTS; where a price is missing, put [ADD: price for X].` : a.kind === "comparison" ? `An honest comparison answering: ${(ev.queries ?? []).join("; ")}. Say when each option suits, like a tradesperson advising a neighbour.` : `A helpful article answering: ${(ev.queries ?? []).join("; ")}.`;
    const j = await claudeJson<Copy>({ ...base, purpose: a.kind, model: MODELS.write(), maxTokens: 3000, temperature: 0.8, user: `${FACTS}\n\nREVIEWS (real, may be quoted with the name)\n${reviews.join("\n") || "(none available)"}\n\nWrite: ${brief}\n\nSearch evidence: ${ev.why}\n\n- Title under 60 characters. Description 140 to 155 characters.\n- An intro of 2 to 3 sentences that answers the searcher straight away.\n- 3 to 4 sections, each 2 short paragraphs.\n- 3 to 4 FAQs a real customer would ask.\n- Under "gaps", list the local substance still needed (a job done in that town, a photo, a local detail). Do not make any up.\n\n{"title":"","description":"","h1":"","intro":"","sections":[{"h2":"","paragraphs":["",""]}],"faqs":[{"q":"","a":""}],"gaps":[]}` });
    if (!j?.h1) return null;
    return { target: "site", page, fields: [{ name: "title", label: "Title", before: "", after: j.title ?? j.h1 }, { name: "description", label: "Description", before: "", after: j.description ?? "" }], html: bodyHtml(j, true), note: gapsNote(j, "New page: add a real job, photo or review from this town before it goes live.") };
  }

  if (a.kind === "page_refresh" || a.kind === "page_boost") {
    const live = await livePage(cfg, page);
    const j = await claudeJson<Copy>({ ...base, purpose: a.kind, model: MODELS.write(), maxTokens: 2000, user: `${FACTS}\n\nPAGE ${page}\nTitle: ${live?.audit.title ?? ""}\nDescription: ${live?.audit.description ?? ""}\nMain heading: ${live?.audit.h1[0] ?? ""}\nText starts: ${live?.audit.text ?? ""}\n\nProblem: ${ev.why}\n${ev.queries?.length ? `Searches to serve better: ${ev.queries.join("; ")}` : ""}\n\nImprove the page without rewriting it: a sharper title and description, and 1 to 2 new sections (each a heading and 2 short paragraphs) that cover what those searches want and the page lacks. Add FAQs only if they add something.\n\n{"title":"","description":"","sections":[{"h2":"","paragraphs":["",""]}],"faqs":[],"gaps":[]}` });
    if (!j) return null;
    return { target: "site", page, fields: [{ name: "title", label: "Title", before: live?.audit.title ?? "", after: j.title ?? live?.audit.title ?? "" }, { name: "description", label: "Description", before: live?.audit.description ?? "", after: j.description ?? live?.audit.description ?? "" }], html: bodyHtml({ sections: j.sections, faqs: j.faqs }, false), note: gapsNote(j) };
  }

  if (a.kind === "gbp_description") {
    const j = await claudeJson<{ description: string; gaps?: string[] }>({ ...base, purpose: "gbp-description", model: MODELS.quick, maxTokens: 500, user: `${FACTS}\n\nCurrent Business Profile description: ${a.draft?.fields?.[0]?.before || "(none)"}\n\nWrite the Google Business Profile description: 500 to 740 characters, what the business does, where, and what makes it a safe choice (only from FACTS). No phone numbers, links, prices or offers: Google doesn't allow them here.\n\n{"description":"","gaps":[]}` });
    if (!j?.description) return null;
    return { target: "profile", fields: [{ name: "description", label: "Description", before: a.draft?.fields?.[0]?.before ?? "", after: j.description.slice(0, 750) }], note: gapsNote(j) };
  }

  if (a.kind === "gbp_post" || a.kind === "weather_post" || a.kind === "seasonal_post") {
    const j = await claudeJson<{ post: string }>({ ...base, purpose: "gbp-post", model: MODELS.quick, maxTokens: 400, temperature: 0.9, user: `${FACTS}\n\nWrite one Google Business Profile post of 60 to 110 words. Reason for the post: ${ev.why}\nMake it useful to a homeowner in ${(cfg.towns ?? []).slice(0, 3).join(", ") || "the area"} this week, mention one service, and end with a plain invitation to call or get a quote. No hashtags, no emojis, no phone number (the post has a button).\n\n{"post":""}` });
    if (!j?.post) return null;
    return { target: "profile", fields: [{ name: "post", label: "Post", before: "", after: j.post.slice(0, 1400) }] };
  }

  if (a.kind === "review_reply") {
    const id = a.draft?.note ?? "";
    const { data: rv } = await db().from("google_reviews").select("rating, comment, reviewer_name").eq("id", id).maybeSingle<{ rating: number | null; comment: string | null; reviewer_name: string | null }>();
    if (!rv) return null;
    const bad = (rv.rating ?? 5) <= 3;
    const j = await claudeJson<{ reply: string }>({ ...base, purpose: "review-reply", model: MODELS.quick, maxTokens: 300, user: `${FACTS}\n\nA customer left this Google review.\nName: ${rv.reviewer_name ?? "Customer"}\nStars: ${rv.rating}\nReview: ${rv.comment ?? "(no comment)"}\n\nWrite the owner's public reply, signed ${c.sender_name ?? c.first_name ?? "the team"}. ${bad ? "Calm and professional: thank them, acknowledge the specific problem without arguing or admitting fault for things not stated, and invite them to call to put it right. 40 to 70 words." : "Warm and specific: thank them by first name, mention the job they describe, and name the service and town once if the review makes them clear. 25 to 50 words."} Never offer anything in return for the review.\n\n{"reply":""}` });
    if (!j?.reply) return null;
    return { target: "review", fields: [{ name: "reply", label: "Reply", before: "", after: j.reply }], note: id };
  }

  if (a.kind === "map_rank") {
    const j = await claudeJson<{ steps: string[] }>({ ...base, purpose: "map-rank", model: MODELS.quick, maxTokens: 500, user: `${FACTS}\n\n${ev.why}\n\nGive 3 to 4 specific, honest steps to move this business up the Google Maps results for "${ev.query}", most effective first. Only steps within Google's rules: categories that truly apply, more genuine reviews, a complete profile, a matching page on the site. One sentence each.\n\n{"steps":[""]}` });
    if (!j?.steps?.length) return null;
    return { target: "manual", minutes: 10, steps: [...j.steps.slice(0, 4).map((text) => ({ text })), { text: "Press Mark done once these are in hand. Related fixes appear as their own items." }] };
  }
  return null;
}

/** A sensible reply when AI isn't connected, so review items are never empty. */
export function templateReply(rv: { rating: number | null; reviewer_name: string | null }, c: Client): string {
  const first = (rv.reviewer_name ?? "").split(" ")[0];
  const sign = c.sender_name ?? c.first_name ?? "The team";
  return (rv.rating ?? 5) <= 3
    ? `${first ? `Hi ${first}, t` : "T"}hank you for the feedback. I'm sorry the job didn't go the way it should have. Please call me directly so I can put it right. ${sign}`
    : `${first ? `Thanks ${first}` : "Thank you"}, really appreciate you taking the time to leave a review. It was a pleasure doing the job for you. ${sign}`;
}
