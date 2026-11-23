import "server-only";
import { seoEnv } from "@/lib/env";

const API = "https://api.github.com";

export class GithubNotConnected extends Error {
  constructor() {
    super("Add GITHUB_TOKEN in Vercel so changes can go to the site as pull requests.");
  }
}

async function gh<T>(path: string, init: { method?: string; body?: unknown; ok404?: boolean } = {}): Promise<T> {
  const token = seoEnv.githubToken();
  if (!token) throw new GithubNotConnected();
  const res = await fetch(`${API}${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(init.body ? { "content-type": "application/json" } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404 && init.ok404) return null as T;
  if (res.status === 204) return null as T;
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${json.message ?? path}`);
  return json;
}

export type TreeFile = { path: string; type: string; size?: number };

export async function repoInfo(repo: string): Promise<{ defaultBranch: string; push: boolean }> {
  const r = await gh<{ default_branch: string; permissions?: { push?: boolean } }>(`/repos/${repo}`);
  return { defaultBranch: r.default_branch, push: !!r.permissions?.push };
}

export async function tree(repo: string, ref: string): Promise<TreeFile[]> {
  const r = await gh<{ tree: TreeFile[] }>(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  return r.tree.filter((f) => f.type === "blob" && !/^(node_modules|\.next|dist|build|\.git)\//.test(f.path));
}

export async function readFile(repo: string, path: string, ref: string): Promise<{ content: string; sha: string } | null> {
  const r = await gh<{ content?: string; sha: string; encoding?: string } | null>(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, { ok404: true });
  if (!r || r.content === undefined) return null;
  return { content: Buffer.from(r.content, "base64").toString("utf8"), sha: r.sha };
}

export type FileEdit = { path: string; before: string | null; after: string };

/** Writes files onto a branch, one commit each. */
export async function commitFiles(repo: string, branch: string, files: FileEdit[], message: string) {
  for (const f of files) {
    const cur = await readFile(repo, f.path, branch);
    if (cur?.content === f.after) continue;
    await gh(`/repos/${repo}/contents/${f.path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", body: { message, content: Buffer.from(f.after, "utf8").toString("base64"), branch, ...(cur ? { sha: cur.sha } : {}) } });
  }
}

export async function deleteFile(repo: string, branch: string, path: string, message: string) {
  const cur = await readFile(repo, path, branch);
  if (cur) await gh(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE", body: { message, sha: cur.sha, branch } });
}

export async function openPr(repo: string, o: { base: string; branch: string; title: string; body: string; files: FileEdit[] }): Promise<{ number: number; url: string }> {
  const ref = await gh<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(o.base)}`);
  await gh(`/repos/${repo}/git/refs`, { method: "POST", body: { ref: `refs/heads/${o.branch}`, sha: ref.object.sha } });
  await commitFiles(repo, o.branch, o.files, o.title);
  const pr = await gh<{ number: number; html_url: string }>(`/repos/${repo}/pulls`, { method: "POST", body: { title: o.title, head: o.branch, base: o.base, body: o.body } });
  return { number: pr.number, url: pr.html_url };
}

export type PrState = { open: boolean; merged: boolean; build: "pending" | "ok" | "failed"; previewUrl?: string };

/** Where a pull request stands: open or merged, and whether Vercel's preview built. */
export async function prState(repo: string, number: number): Promise<PrState> {
  const pr = await gh<{ state: string; merged: boolean; head: { sha: string } }>(`/repos/${repo}/pulls/${number}`);
  const deployments = await gh<{ id: number; environment: string }[]>(`/repos/${repo}/deployments?sha=${pr.head.sha}&per_page=5`).catch(() => []);
  let build: PrState["build"] = "pending";
  let previewUrl: string | undefined;
  for (const d of deployments) {
    const statuses = await gh<{ state: string; environment_url?: string; target_url?: string }[]>(`/repos/${repo}/deployments/${d.id}/statuses?per_page=5`).catch(() => []);
    const s = statuses[0];
    if (!s) continue;
    if (s.state === "success") {
      build = "ok";
      previewUrl = s.environment_url || s.target_url;
      break;
    }
    if (s.state === "failure" || s.state === "error") build = "failed";
  }
  return { open: pr.state === "open", merged: pr.merged, build, previewUrl };
}

export async function mergePr(repo: string, number: number, title: string): Promise<string> {
  const r = await gh<{ sha: string }>(`/repos/${repo}/pulls/${number}/merge`, { method: "PUT", body: { merge_method: "squash", commit_title: title } });
  return r.sha;
}

export async function closePr(repo: string, number: number, branch?: string) {
  await gh(`/repos/${repo}/pulls/${number}`, { method: "PATCH", body: { state: "closed" } }).catch(() => null);
  if (branch) await gh(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "DELETE" }).catch(() => null);
}

/** The GitHub repo behind a Vercel project, when VERCEL_TOKEN is set. */
export async function repoForVercelDomain(domain: string): Promise<string | null> {
  const token = seoEnv.vercelToken();
  if (!token) return null;
  try {
    const team = process.env.VERCEL_TEAM_ID ? `&teamId=${process.env.VERCEL_TEAM_ID}` : "";
    const res = await fetch(`https://api.vercel.com/v9/projects?limit=100${team}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { projects?: { name: string; link?: { type?: string; org?: string; repo?: string }; targets?: { production?: { alias?: string[] } } }[] };
    const d = domain.replace(/^www\./, "");
    const p = (j.projects ?? []).find((x) => (x.targets?.production?.alias ?? []).some((a) => a.replace(/^www\./, "") === d));
    return p?.link?.type === "github" && p.link.org && p.link.repo ? `${p.link.org}/${p.link.repo}` : null;
  } catch {
    return null;
  }
}
