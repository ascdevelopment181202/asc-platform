import "server-only";
import crypto from "node:crypto";
import { seoEnv } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { replyToReview, type GoogleReview } from "@/lib/google-reviews";
import type { ApplyInfo, Draft, SeoAction, SeoChange, SeoConfig, SeoSettings } from "./types";
import { AiUnavailable, claudeJson, MODELS } from "./ai";
import { closePr, commitFiles, deleteFile, GithubNotConnected, mergePr, openPr, prState, readFile, repoInfo, tree, type FileEdit, type TreeFile } from "./github";
import { createPost, deletePost, getLocation, patchLocation, v4Path, withUtm, type RawLocation } from "./gbp";
import { getAction, getSettings, globalPaused, logChange, pagesThisWeek, updateAction } from "./store";
import { visualCheck } from "./visual";
import { pingIndexNow } from "./bing";
import { intoBody, intoHead, isHeadOnly, setDescription, setTitle } from "./html-edit";
import { sendClientReport } from "./mail";

const DAY = 86_400_000;
const NEW_PAGE_KINDS = ["new_page", "cost_guide", "comparison", "blog"];
const PAGES_A_WEEK = 3;

// ---------- Secrets ----------

const keyBytes = () => {
  const k = seoEnv.encryptionKey();
  if (!k) throw new Error("Add SEO_ENCRYPTION_KEY in Vercel before saving a WordPress password.");
  return crypto.createHash("sha256").update(k).digest();
};
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decrypt(packed: string): string {
  const [iv, tag, enc] = packed.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", keyBytes(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---------- Change lists (sites we can't edit directly) ----------

export function changeList(a: SeoAction, cfg: SeoConfig): string {
  const d = a.draft ?? {};
  const where = d.page && d.page !== "*" ? `Page: https://${cfg.domain}${d.page === "/" ? "" : d.page}` : d.page === "*" ? "Every page" : `Site: https://${cfg.domain}`;
  const lines = [a.summary, where, ""];
  for (const f of d.fields ?? []) lines.push(`${f.label}:`, f.before ? `  Now: ${f.before}` : "  Now: (none)", `  Change to: ${f.after}`, "");
  for (const f of d.files ?? []) lines.push(`Add this file at /${f.path}:`, f.content, "");
  for (const b of d.blocks ?? []) lines.push(`${b.label} (${b.page === "*" ? "every page" : b.page === "/" ? "home page" : b.page}):`, b.html, "");
  if (d.html) lines.push(NEW_PAGE_KINDS.includes(a.kind) ? "Page content:" : /ld\+json/.test(d.html) && !/<h[1-6]|<p>/.test(d.html) ? "Add inside <head>:" : "Add this to the page:", d.html, "");
  if (d.note) lines.push(d.note);
  return lines.join("\n").trim();
}

// ---------- Editing a site through its GitHub repo ----------

function htmlFileFor(files: TreeFile[], root: string, page: string): string | null {
  const p = page.replace(/^\/|\/$/g, "");
  const candidates = p ? [`${root}${p}/index.html`, `${root}${p}.html`] : [`${root}index.html`];
  return candidates.find((c) => files.some((f) => f.path === c)) ?? null;
}

function sourceCandidates(files: TreeFile[], page: string): string[] {
  const p = page.replace(/^\/|\/$/g, "");
  const names = new Set(files.map((f) => f.path));
  const out: string[] = [];
  const exts = ["tsx", "jsx", "ts", "js", "astro", "vue", "svelte", "mdx"];
  for (const base of ["app", "src/app"]) for (const e of exts) {
    out.push(`${base}/${p ? `${p}/` : ""}page.${e}`, `${base}/layout.${e}`);
  }
  for (const base of ["pages", "src/pages"]) for (const e of exts) out.push(`${base}/${p || "index"}.${e}`, `${base}/${p}/index.${e}`, `${base}/_app.${e}`, `${base}/_document.${e}`);
  for (const e of exts) out.push(`src/App.${e}`, `src/main.${e}`);
  out.push("index.html");
  return [...new Set(out)].filter((c) => names.has(c));
}

type AiEdits = { edits?: { path: string; search: string; replace: string }[]; newFiles?: { path: string; content: string }[]; cannot?: string };

async function aiEdit(a: SeoAction, cfg: SeoConfig, repo: string, ref: string, files: TreeFile[], request: string, page: string): Promise<FileEdit[]> {
  let paths = sourceCandidates(files, page === "*" ? "/" : page);
  const listing = files.filter((f) => /\.(tsx|jsx|ts|js|html|astro|vue|svelte|mdx|json)$/.test(f.path) && !/lock|\.d\.ts$|config\./.test(f.path)).slice(0, 300).map((f) => f.path);
  if (paths.length < 1 || (NEW_PAGE_KINDS.includes(a.kind) && paths.length < 2)) {
    const pick = await claudeJson<{ files: string[] }>({ clientId: a.client_id, purpose: "repo-pick", model: MODELS.quick, maxTokens: 300, system: "You locate source files in a website repository.", user: `Repository files:\n${listing.join("\n")}\n\nWhich files (at most 3) need reading to make this change?\nPage: ${page}\nChange: ${request.slice(0, 600)}\n\n{"files":[""]}` });
    paths = [...new Set([...paths, ...(pick?.files ?? []).filter((f) => listing.includes(f))])].slice(0, 4);
  }
  if (!paths.length) throw new Error("Couldn't find the source file for this page in the repository.");
  const loaded = (await Promise.all(paths.slice(0, 4).map(async (p) => ({ path: p, file: await readFile(repo, p, ref) })))).filter((x) => x.file);
  const j = await claudeJson<AiEdits>({
    clientId: a.client_id,
    purpose: "repo-edit",
    model: MODELS.write(),
    maxTokens: 6000,
    system: `You make one small, safe change to a live website's source code. Rules:
- Change only what the request asks. Never restyle, rename, reformat or reorganise anything else.
- Reuse the site's existing components, class names and patterns so the addition looks native.
- Each edit is an exact substring of the file ("search", which must appear exactly once) and its replacement. Keep "search" short but unique.
- For a new page, copy the structure of the most similar existing page and return it under newFiles with the right path for this framework.
- JSON-LD goes in the document head. A tracking script goes once, in the root layout or document, just before the closing body tag.
- If the change can't be made safely, return {"cannot":"why"}.`,
    user: `Site: https://${cfg.domain}\nPage: ${page}\n\nREQUEST\n${request}\n\nFILES\n${loaded.map((x) => `=== ${x.path} ===\n${x.file!.content.slice(0, 30_000)}`).join("\n\n")}\n\nOther files in the repo: ${listing.slice(0, 120).join(", ")}\n\n{"edits":[{"path":"","search":"","replace":""}],"newFiles":[{"path":"","content":""}]}`,
  });
  if (!j || j.cannot) throw new Error(j?.cannot ?? "The AI couldn't work out a safe edit for this site.");
  const out = new Map<string, FileEdit>();
  for (const e of j.edits ?? []) {
    if (!e.path || !e.search) continue;
    const cur = out.get(e.path)?.after ?? loaded.find((x) => x.path === e.path)?.file?.content ?? (await readFile(repo, e.path, ref))?.content;
    if (cur === undefined) throw new Error(`The edit names a file that doesn't exist: ${e.path}`);
    if (cur.split(e.search).length !== 2) throw new Error(`The edit for ${e.path} didn't match the file exactly once, so it wasn't applied.`);
    out.set(e.path, { path: e.path, before: out.get(e.path)?.before ?? cur, after: cur.replace(e.search, () => e.replace) });
  }
  for (const f of j.newFiles ?? []) if (f.path && f.content && !files.some((x) => x.path === f.path)) out.set(f.path, { path: f.path, before: null, after: f.content });
  if (!out.size) throw new Error("The AI returned no usable edit.");
  return [...out.values()];
}

function requestText(a: SeoAction): string {
  const d = a.draft ?? {};
  const parts = [a.summary];
  for (const f of d.fields ?? []) parts.push(`Set the page ${f.label.toLowerCase()} to exactly: ${f.after}`);
  if (d.html) parts.push(NEW_PAGE_KINDS.includes(a.kind) ? `Create a new page at ${d.page} with this content (use the site's own layout, header, footer and styles):\n${d.html}` : isHeadOnly(d.html) ? `Add this to the page's <head>:\n${d.html}` : `Add this content to the page${a.kind === "answer_block" ? ", directly below the main heading or hero" : ", after the existing main content"}, using the site's existing section and heading styles:\n${d.html}`);
  for (const b of d.blocks ?? []) parts.push(`${b.label} (${b.page === "*" ? "every page, via the root layout" : b.page}):\n${b.html}`);
  if (d.note) parts.push(d.note);
  return parts.join("\n\n");
}

/** Works out the file changes for one action on a repo-backed site. */
export async function planRepoEdits(a: SeoAction, cfg: SeoConfig): Promise<{ edits: FileEdit[]; base: string }> {
  const repo = cfg.githubRepo!;
  const info = await repoInfo(repo);
  const base = cfg.githubBranch || info.defaultBranch;
  const files = await tree(repo, base);
  const names = new Set(files.map((f) => f.path));
  const framework = files.some((f) => /\.(tsx|jsx|astro|vue|svelte)$/.test(f.path));
  // A single-page app (Vite and the like) has one index.html at the top that every page is served from:
  // titles, head tags and the plain copy can go straight into it, with no AI involved.
  const spa = framework && names.has("index.html") && !files.some((f) => /^(src\/)?(app|pages)\/.*\.(tsx|jsx|ts|js|astro)$/.test(f.path));
  const root = framework ? "public/" : names.has("public/index.html") && !names.has("index.html") ? "public/" : "";
  const htmlRoot = spa ? "" : root;
  const d: Draft = a.draft ?? {};
  const edits = new Map<string, FileEdit>();
  const put = async (path: string, after: string) => {
    const before = edits.get(path)?.before ?? (await readFile(repo, path, base))?.content ?? null;
    if (before !== after) edits.set(path, { path, before, after });
  };
  const current = async (path: string) => edits.get(path)?.after ?? (await readFile(repo, path, base))?.content ?? null;

  // Whole files: llms.txt, robots.txt, sitemap.xml. Skipped when the framework generates that file itself.
  for (const f of d.files ?? []) {
    const stem = f.path.replace(/\.[a-z]+$/, "");
    if (framework && files.some((x) => new RegExp(`(^|/)app/${stem}\\.(ts|js|tsx)$`).test(x.path))) continue;
    await put(`${root}${f.path}`, f.content);
  }

  const blocks = [...(d.blocks ?? []), ...(d.html && !d.fields?.length && isHeadOnly(d.html) ? [{ page: d.page ?? "/", label: "Structured data", html: d.html }] : []), ...(d.html && d.page === "*" ? [{ page: "*", label: "Tracking script", html: d.html }] : [])];
  const deterministic = !framework || spa;
  let needsAi = false;
  const fileFor = (page: string) => (spa ? "index.html" : htmlFileFor(files, htmlRoot, page));

  if (deterministic) {
    const htmlFiles = spa ? [{ path: "index.html" }] : files.filter((f) => f.path.startsWith(htmlRoot) && f.path.endsWith(".html")).slice(0, 60);
    for (const b of blocks) {
      const targets = b.page === "*" ? htmlFiles.map((f) => f.path) : [fileFor(b.page)].filter((x): x is string => !!x);
      for (const t of targets) {
        const cur = await current(t);
        if (cur) await put(t, isHeadOnly(b.html) ? intoHead(cur, b.html) : intoBody(cur, b.html));
      }
    }
    // In a single-page app only the home page's title lives in index.html; other pages set theirs in code.
    const file = d.page && d.page !== "*" && (!spa || d.page === "/") ? fileFor(d.page) : null;
    if (file && d.fields?.length && !NEW_PAGE_KINDS.includes(a.kind)) {
      let cur = (await current(file))!;
      for (const f of d.fields) {
        if (f.name === "title" && f.after) cur = setTitle(cur, f.after);
        if (f.name === "description" && f.after) cur = setDescription(cur, f.after);
      }
      await put(file, cur);
    }
    // Visible content and instruction-style fixes need the AI to place them in the page's own markup.
    const visible = d.html && d.page !== "*" && !isHeadOnly(d.html);
    if (visible || d.note || NEW_PAGE_KINDS.includes(a.kind) || (d.fields?.length && !file)) needsAi = true;
  } else if (blocks.length || d.fields?.length || d.html || d.note) needsAi = true;

  if (needsAi) {
    const request = deterministic ? requestText({ ...a, draft: { ...d, blocks: undefined, fields: NEW_PAGE_KINDS.includes(a.kind) || !(d.page && d.page !== "*" && (!spa || d.page === "/") && fileFor(d.page)) ? d.fields : undefined, html: d.html && d.page !== "*" && !isHeadOnly(d.html) ? d.html : undefined } }) : requestText(a);
    for (const e of await aiEdit(a, cfg, repo, base, files, request, d.page ?? "/")) {
      const prior = edits.get(e.path);
      edits.set(e.path, prior ? { path: e.path, before: prior.before, after: e.after } : e);
    }
  }
  // A new static page also goes in the sitemap.
  if (NEW_PAGE_KINDS.includes(a.kind) && d.page && names.has(`${root}sitemap.xml`)) {
    const sm = await current(`${root}sitemap.xml`);
    const loc = `https://${cfg.domain}${d.page}`;
    if (sm && !sm.includes(loc)) await put(`${root}sitemap.xml`, sm.replace(/<\/urlset>/i, `  <url><loc>${loc}</loc></url>\n</urlset>`));
  }
  return { edits: [...edits.values()], base };
}

type RepoUndo = { type: "repo"; repo: string; base: string; files: { path: string; before: string | null }[] };
type ProfileUndo = { type: "profile"; location: string; mask: string; body: Partial<RawLocation> } | { type: "post"; name: string };
type OtherUndo = { type: "hosted"; siteId: string; seo: unknown } | { type: "wp"; pageId: number; content: string } | { type: "none" };
type Undo = RepoUndo | ProfileUndo | OtherUndo;

/** Opens the pull request for a site change so Vercel builds a preview. Nothing is live yet. */
export async function preparePr(a: SeoAction, s: SeoSettings): Promise<ApplyInfo> {
  const cfg = s.config;
  if (!cfg.githubRepo) throw new GithubNotConnected();
  const { edits, base } = await planRepoEdits(a, cfg);
  if (!edits.length) throw new Error("Nothing to change: the site already has this.");
  const branch = `seo/${a.kind.replace(/_/g, "-")}-${a.id.slice(0, 8)}`;
  const pr = await openPr(cfg.githubRepo, { base, branch, title: `SEO: ${a.summary.slice(0, 80)}`, body: `${a.detail.evidence.why}\n\nOpened by the ASC SEO autopilot. Merged only after approval in the dashboard.`, files: edits });
  const apply: ApplyInfo = { mode: "pr", prNumber: pr.number, prUrl: pr.url, branch, build: "pending" };
  const undo: RepoUndo = { type: "repo", repo: cfg.githubRepo, base, files: edits.map((e) => ({ path: e.path, before: e.before })) };
  await updateAction(a.id, { apply, undo });
  return apply;
}

const liveUrl = (cfg: SeoConfig, page?: string) => `https://${cfg.domain}${!page || page === "/" || page === "*" ? "" : page}`;
export const canAuto = (a: SeoAction, cfg: SeoConfig) => {
  if (!a.detail.autoOk) return false;
  const on = cfg.autoApply ?? {};
  if (["title_rewrite", "meta_fix"].includes(a.kind)) return !!on.titles;
  if (["schema_local", "schema_sameas", "faq_schema"].includes(a.kind)) return !!on.schema;
  if (a.kind === "answer_block") return !!on.faq;
  if (["gbp_post"].includes(a.kind)) return !!on.posts;
  return false;
};

async function finishSite(a: SeoAction, s: SeoSettings, auto: boolean, how: string, undo: Undo, mergeSha?: string) {
  const page = a.draft?.page;
  await logChange({ clientId: a.client_id, actionId: a.id, target: "site", summary: a.summary, before: a.draft?.fields?.map((f) => ({ [f.label]: f.before })) ?? null, after: { how, fields: a.draft?.fields?.map((f) => ({ [f.label]: f.after })), mergeSha }, undo, auto });
  await updateAction(a.id, { status: "applied", applied_at: new Date().toISOString(), measure_at: new Date(Date.now() + 28 * DAY).toISOString() });
  if (s.config.domain) await pingIndexNow(s.config.domain, [liveUrl(s.config, page)]).catch(() => null);
}

/**
 * Moves an open pull request along: reads the build, runs the visual check once, and merges when
 * it's been approved (or is a safe kind with auto-apply on and a clean check).
 */
export async function progressPr(id: string): Promise<string> {
  const a = await getAction(id);
  const s = a ? await getSettings(a.client_id) : null;
  if (!a || !s || !a.apply?.prNumber || !s.config.githubRepo) return "Nothing to do.";
  const repo = s.config.githubRepo;
  const st = await prState(repo, a.apply.prNumber);
  let apply: ApplyInfo = { ...a.apply, build: st.build, previewUrl: st.previewUrl ?? a.apply.previewUrl };
  if (st.merged && a.status !== "applied") {
    await finishSite(a, s, false, "Merged on GitHub", (a.undo as Undo) ?? { type: "none" });
    return "Already merged on GitHub.";
  }
  if (!st.open) return "The pull request was closed.";
  if (st.build === "failed") {
    await closePr(repo, a.apply.prNumber, a.apply.branch);
    await updateAction(a.id, { status: "failed", apply: { ...apply, error: "The preview build failed, so the change was withdrawn. Nothing went live." } });
    return "The preview build failed. The change was withdrawn.";
  }
  if (st.build === "ok" && st.previewUrl && !apply.visual) {
    const page = a.draft?.page && a.draft.page !== "*" ? a.draft.page : "/";
    apply = { ...apply, visual: await visualCheck(a.id, liveUrl(s.config, page), `${st.previewUrl.replace(/\/$/, "")}${page === "/" ? "" : page}`, { isNewPage: NEW_PAGE_KINDS.includes(a.kind) }) };
  }
  await updateAction(a.id, { apply });
  if (st.build !== "ok") return "Waiting for the preview to build.";
  const paused = s.paused || (await globalPaused());
  const approved = a.status === "approved";
  const auto = !approved && a.status === "new" && canAuto(a, s.config) && !!apply.visual?.ok;
  if (paused || (!approved && !auto)) return "Preview ready.";
  if (NEW_PAGE_KINDS.includes(a.kind) && (await pagesThisWeek(a.client_id)) >= PAGES_A_WEEK) return `Queued: ${PAGES_A_WEEK} new pages have already gone live this week.`;
  const sha = await mergePr(repo, a.apply.prNumber, `SEO: ${a.summary.slice(0, 80)}`);
  await finishSite(a, s, auto, "Pull request merged", (a.undo as Undo) ?? { type: "none" }, sha);
  return "Merged. Vercel is deploying it now.";
}

// ---------- Business Profile ----------

async function applyProfile(a: SeoAction, s: SeoSettings, auto: boolean): Promise<string> {
  const cfg = s.config;
  if (!cfg.gbpLocation) throw new Error("No Business Profile is connected for this client.");
  const loc = await getLocation(cfg.gbpLocation);
  const f = a.draft?.fields?.[0];
  if (!f?.after) throw new Error("There's nothing written to apply yet.");
  let undo: ProfileUndo;
  if (f.name === "post") {
    const path = await v4Path(cfg.gbpLocation, cfg.gbpAccount);
    if (!path) throw new Error("Couldn't find the account that owns this profile.");
    const post = await createPost(path, { summary: f.after, url: cfg.domain ? withUtm(`https://${cfg.domain}`) : undefined });
    undo = { type: "post", name: post.name ?? "" };
  } else {
    // One kind of change at a time: don't stack edits while Google is still reviewing the last.
    if (loc.metadata?.hasPendingEdits) throw new Error("Google is still reviewing an earlier edit to this profile. Try again tomorrow.");
    if (f.name === "description") {
      await patchLocation(cfg.gbpLocation, "profile.description", { profile: { description: f.after } });
      undo = { type: "profile", location: cfg.gbpLocation, mask: "profile.description", body: { profile: { description: loc.profile?.description ?? "" } } };
    } else if (f.name === "websiteUri") {
      await patchLocation(cfg.gbpLocation, "websiteUri", { websiteUri: f.after });
      undo = { type: "profile", location: cfg.gbpLocation, mask: "websiteUri", body: { websiteUri: loc.websiteUri } };
    } else if (f.name === "specialHours") {
      await patchLocation(cfg.gbpLocation, "specialHours", { specialHours: JSON.parse(a.draft?.note ?? "{}") });
      undo = { type: "profile", location: cfg.gbpLocation, mask: "specialHours", body: { specialHours: loc.specialHours ?? { specialHourPeriods: [] } } };
    } else throw new Error("This kind of profile change is a guided task.");
  }
  await logChange({ clientId: a.client_id, actionId: a.id, target: "profile", summary: a.summary, before: { [f.label]: f.before }, after: { [f.label]: f.after }, undo, auto });
  await updateAction(a.id, { status: "applied", applied_at: new Date().toISOString(), measure_at: new Date(Date.now() + 28 * DAY).toISOString() });
  return "Done on the Business Profile.";
}

/** When Google won't let us make a profile change, the item becomes a guided task with the text to paste. */
async function toGuided(a: SeoAction, why: string) {
  const f = a.draft?.fields?.[0];
  await updateAction(a.id, { draft: { target: "manual", minutes: 3, note: `Google wouldn't accept this through the API (${why.slice(0, 160)}). If it says permission or access, ask the client to make chavanayush802@gmail.com a Manager on the profile.`, steps: [{ text: "Open the Business Profile.", url: "https://business.google.com/locations" }, { text: `${f?.name === "post" ? "Add update, paste this, then Post" : `Edit profile, then set the ${f?.label.toLowerCase() ?? "field"} to`}:`, copy: f?.after ?? "" }, { text: "Press Mark done." }] } });
}

// ---------- WordPress and hosted sites ----------

async function wp<T>(cfg: SeoConfig, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!cfg.wpUrl || !cfg.wpUser || !cfg.wpPasswordEnc) throw new Error("WordPress isn't connected: add the site address, username and application password in Settings.");
  const res = await fetch(`${cfg.wpUrl.replace(/\/$/, "")}/wp-json/wp/v2${path}`, { method: init?.method ?? "GET", headers: { authorization: `Basic ${Buffer.from(`${cfg.wpUser}:${decrypt(cfg.wpPasswordEnc)}`).toString("base64")}`, ...(init?.body ? { "content-type": "application/json" } : {}) }, body: init?.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(30_000) });
  const j = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`WordPress ${res.status}: ${j.message ?? path}`);
  return j;
}

/** WordPress: content blocks and new pages go through the REST API. Titles and descriptions need the SEO plugin, so they stay a change list. */
async function applyWordPress(a: SeoAction, s: SeoSettings): Promise<Undo | null> {
  const d = a.draft ?? {};
  if (!d.html || isHeadOnly(d.html) || d.page === "*") return null;
  if (NEW_PAGE_KINDS.includes(a.kind)) {
    const created = await wp<{ id: number }>(s.config, "/pages", { method: "POST", body: { title: d.fields?.find((f) => f.name === "title")?.after ?? a.summary, slug: (d.page ?? "").replace(/^\//, ""), content: d.html.replace(/<h1>[\s\S]*?<\/h1>/, ""), status: "publish" } });
    return { type: "wp", pageId: created.id, content: "" };
  }
  const slug = (d.page ?? "/").replace(/^\/|\/$/g, "").split("/").pop() ?? "";
  const pages = await wp<{ id: number; content: { raw?: string; rendered: string } }[]>(s.config, slug ? `/pages?slug=${encodeURIComponent(slug)}&context=edit` : `/pages?per_page=1&orderby=menu_order&context=edit`);
  const page = pages[0];
  if (!page) return null;
  const before = page.content.raw ?? page.content.rendered;
  await wp(s.config, `/pages/${page.id}`, { method: "POST", body: { content: a.kind === "answer_block" ? `${d.html}\n${before}` : `${before}\n${d.html}` } });
  return { type: "wp", pageId: page.id, content: before };
}

/** Sites the platform renders itself: the home page title and description live in the site's content. */
async function applyHosted(a: SeoAction, s: SeoSettings): Promise<Undo | null> {
  const d = a.draft ?? {};
  if (!s.config.siteId || d.page !== "/" || !d.fields?.length || d.html) return null;
  const { data: site } = await db().from("sites").select("id, content").eq("id", s.config.siteId).maybeSingle<{ id: string; content: { seo?: { title: string; description: string } } }>();
  if (!site) return null;
  const seo = { title: d.fields.find((f) => f.name === "title")?.after || site.content.seo?.title || "", description: d.fields.find((f) => f.name === "description")?.after || site.content.seo?.description || "" };
  await db().from("sites").update({ content: { ...site.content, seo }, updated_at: new Date().toISOString() }).eq("id", site.id);
  return { type: "hosted", siteId: site.id, seo: site.content.seo ?? null };
}

// ---------- Approve, mark done, undo ----------

export type Outcome = { ok: boolean; message: string };

export async function approveAction(id: string, opts: { auto?: boolean } = {}): Promise<Outcome> {
  const a = await getAction(id);
  if (!a) return { ok: false, message: "That item no longer exists." };
  const s = await getSettings(a.client_id);
  if (!s) return { ok: false, message: "This client has no SEO settings." };
  if (s.paused || (await globalPaused())) return { ok: false, message: "SEO changes are paused. Switch the pause off to apply this." };
  const d = a.draft;
  if (d?.needsAi) return { ok: false, message: "This one is still waiting to be written. Add the Anthropic key, or check the AI budget, then press Write it now." };
  const auto = !!opts.auto;
  try {
    // No draft, or a guided task: approving means "done".
    if (!d || d.target === "manual") {
      await updateAction(id, { status: "done", applied_at: new Date().toISOString() });
      return { ok: true, message: "Marked done." };
    }
    if (d.target === "email") {
      const { data: c } = await db().from("clients").select("*").eq("id", a.client_id).single<Client>();
      if (!c) return { ok: false, message: "That client no longer exists." };
      await sendClientReport(c, a);
      await updateAction(id, { status: "done", applied_at: new Date().toISOString() });
      return { ok: true, message: `Sent to ${c.email}.` };
    }
    if (d.target === "review") {
      const { data: c } = await db().from("clients").select("*").eq("id", a.client_id).single<Client>();
      const { data: rv } = await db().from("google_reviews").select("*").eq("id", d.note ?? "").maybeSingle<GoogleReview>();
      if (!c || !rv) return { ok: false, message: "That review is no longer there." };
      if (rv.reply) {
        await updateAction(id, { status: "done", applied_at: new Date().toISOString() });
        return { ok: true, message: "Already replied to." };
      }
      await replyToReview(c, rv, d.fields?.[0]?.after ?? "");
      await logChange({ clientId: a.client_id, actionId: id, target: "review", summary: a.summary, after: { reply: d.fields?.[0]?.after }, undo: { type: "none" }, auto });
      await updateAction(id, { status: "applied", applied_at: new Date().toISOString() });
      return { ok: true, message: "Reply posted on Google." };
    }
    if (d.target === "profile") {
      try {
        return { ok: true, message: await applyProfile(a, s, auto) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/40[13]|permission|access|not connected|isn't connected|No Business Profile/i.test(msg)) {
          await toGuided(a, msg);
          return { ok: false, message: "Google wouldn't take this directly, so it's now a guided task with the text to paste." };
        }
        return { ok: false, message: msg };
      }
    }
    // Site changes.
    const type = s.config.siteType ?? "other";
    if (type === "vercel" && s.config.githubRepo && seoEnv.githubToken()) {
      if (!a.apply?.prNumber) await preparePr(a, s);
      await updateAction(id, { status: "approved" });
      const msg = await progressPr(id);
      return { ok: true, message: msg === "Waiting for the preview to build." ? "Approved. It goes live as soon as the preview builds and passes its check." : msg };
    }
    if (NEW_PAGE_KINDS.includes(a.kind) && (await pagesThisWeek(a.client_id)) >= PAGES_A_WEEK) return { ok: false, message: `${PAGES_A_WEEK} new pages have already gone live on this site this week. Approve this one next week so pages drip out.` };
    const direct = type === "wordpress" ? await applyWordPress(a, s) : type === "hosted" ? await applyHosted(a, s) : null;
    if (direct) {
      await finishSite(a, s, auto, type === "wordpress" ? "Published through WordPress" : "Updated on the platform", direct);
      return { ok: true, message: "Live on the site." };
    }
    await updateAction(id, { status: "approved", apply: { mode: "list", changeList: changeList(a, s.config) } });
    return { ok: true, message: "Approved. The change list is ready to paste; press Mark done once it's on the site." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof AiUnavailable || err instanceof GithubNotConnected || /didn't match|Couldn't find the source|couldn't work out|no usable edit/i.test(msg)) {
      await updateAction(id, { status: "approved", apply: { mode: "list", changeList: changeList(a, s.config), error: msg } });
      return { ok: true, message: `Approved as a change list (${msg})` };
    }
    await updateAction(id, { apply: { ...(a.apply ?? {}), error: msg } });
    return { ok: false, message: msg };
  }
}

/** For change lists and guided tasks: Ayush has done it by hand. */
export async function markDone(id: string): Promise<Outcome> {
  const a = await getAction(id);
  if (!a) return { ok: false, message: "That item no longer exists." };
  const s = await getSettings(a.client_id);
  if (a.apply?.mode === "list" && s) await finishSite(a, s, false, "Applied by hand from the change list", { type: "none" });
  else await updateAction(id, { status: "done", applied_at: new Date().toISOString() });
  return { ok: true, message: "Marked done." };
}

export async function dismissAction(id: string, reason?: string) {
  const a = await getAction(id);
  if (!a) return;
  const s = await getSettings(a.client_id);
  if (a.apply?.prNumber && s?.config.githubRepo && a.status !== "applied") await closePr(s.config.githubRepo, a.apply.prNumber, a.apply.branch).catch(() => null);
  await updateAction(id, { status: "dismissed", dismissed_reason: reason ?? null, apply: a.apply?.prNumber ? { ...a.apply, prNumber: undefined } : a.apply });
}

export async function undoChange(changeId: string): Promise<Outcome> {
  const { data: ch } = await db().from("seo_changes").select("*").eq("id", changeId).maybeSingle<SeoChange>();
  if (!ch) return { ok: false, message: "That change no longer exists." };
  if (ch.undone_at) return { ok: false, message: "Already undone." };
  const u = (ch.undo ?? { type: "none" }) as Undo;
  try {
    if (u.type === "repo") {
      for (const f of u.files) {
        if (f.before === null) await deleteFile(u.repo, u.base, f.path, `Undo SEO change: ${ch.summary.slice(0, 60)}`);
        else await commitFiles(u.repo, u.base, [{ path: f.path, before: null, after: f.before }], `Undo SEO change: ${ch.summary.slice(0, 60)}`);
      }
    } else if (u.type === "profile") await patchLocation(u.location, u.mask, u.body);
    else if (u.type === "post") await deletePost(u.name);
    else if (u.type === "hosted") {
      const { data: site } = await db().from("sites").select("content").eq("id", u.siteId).maybeSingle<{ content: Record<string, unknown> }>();
      if (site) await db().from("sites").update({ content: { ...site.content, seo: u.seo } }).eq("id", u.siteId);
    } else if (u.type === "wp") {
      const s = await getSettings(ch.client_id);
      if (!s) throw new Error("No settings for this client.");
      if (u.content) await wp(s.config, `/pages/${u.pageId}`, { method: "POST", body: { content: u.content } });
      else await wp(s.config, `/pages/${u.pageId}`, { method: "DELETE" });
    } else return { ok: false, message: "This change was made by hand, so it has to be undone by hand." };
    await db().from("seo_changes").update({ undone_at: new Date().toISOString() }).eq("id", changeId);
    if (ch.action_id) await updateAction(ch.action_id, { status: "dismissed", dismissed_reason: "undone" });
    return { ok: true, message: "Undone." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
