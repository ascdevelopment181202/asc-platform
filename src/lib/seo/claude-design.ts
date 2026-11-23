// Claude Design sites are one exported index.html with the whole design packed inside it.
// The autopilot can change that file's title, description, head tags and AI-readable copy, but it can't add a page
// or rework a section that matches the design. Those suggestions become a short task to do in Claude Design itself.
import type { Finding, SeoConfig } from "./types";

/** Kinds that need the page's own layout: new pages, new or reworked sections. */
export const NEEDS_DESIGN = ["new_page", "cost_guide", "comparison", "blog", "answer_block", "faq_schema", "page_refresh", "page_boost", "quotable", "no_cta", "phone_click", "no_reviews_shown"];

function request(f: Finding): string {
  const facts = "Keep the existing design, fonts and colours. Only use facts already on the site; where a detail is missing (a price, a local job, a photo), leave a clear placeholder like [ADD: price] rather than inventing it.";
  if (f.kind === "new_page") {
    const what = f.summary.replace(/^Create an? /, "").replace(/ page:.*$/, "");
    return `Add a new page to this site for ${what}. Give it its own address (for example /${what.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}), add it to the menu, and write it for that town specifically: what the service is, why choose us, what the job involves, a short FAQ, and a clear call-to-action with the phone number. ${facts}`;
  }
  if (f.kind === "cost_guide") return `Add a page that answers what customers pay, using a simple price table. Questions people search: ${(f.detail.evidence.queries ?? []).join("; ")}. ${facts}`;
  if (f.kind === "comparison") return `Add a page comparing the options people weigh up, saying honestly when each one suits. Questions people search: ${(f.detail.evidence.queries ?? []).join("; ")}. ${facts}`;
  return `${f.summary} Why: ${f.detail.evidence.why} ${facts}`;
}

/** Turns a suggestion the autopilot can't apply to a Claude Design site into a guided task. */
export function viaClaudeDesign(cfg: SeoConfig, f: Finding): Finding {
  const branch = cfg.githubBranch || "main";
  return {
    ...f,
    detail: { ...f.detail, effort: "30 min manual", evidence: { ...f.detail.evidence, why: `${f.detail.evidence.why} This site is a Claude Design export, so this change has to be made in Claude Design, which keeps the design consistent.` } },
    draft: {
      target: "manual",
      minutes: 15,
      steps: [
        { text: "Open this site's design in Claude Design." },
        { text: "Paste this request:", copy: request(f) },
        { text: "Export the site as HTML. Don't publish it from Claude Design: upload the new index.html to the GitHub repo instead, replacing the old one. Vercel puts it live.", url: cfg.githubRepo ? `https://github.com/${cfg.githubRepo}/upload/${branch}` : undefined },
        { text: "Press Mark done. If the new export lost the title or the AI-readable copy, the autopilot adds them back on its next run." },
      ],
    },
  };
}
