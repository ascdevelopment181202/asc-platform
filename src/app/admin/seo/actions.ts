"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { AiUnavailable } from "@/lib/seo/ai";
import { approveAction, dismissAction, encrypt, markDone, progressPr, undoChange } from "@/lib/seo/apply";
import { DEMO_ID } from "@/lib/seo/demo";
import { draftFor } from "@/lib/seo/drafts";
import { runClient } from "@/lib/seo/engine";
import { repoForVercelDomain } from "@/lib/seo/github";
import { ensureSettings, getAction, getSettings, kvGet, kvSet, listActions, patchState, saveConfig, updateAction } from "@/lib/seo/store";
import { DEFAULT_PLAYBOOK } from "@/lib/seo/strategist";
import { isSafe } from "@/lib/seo/safe";
import type { SeoConfig, SiteType } from "@/lib/seo/types";

// Every route under /admin is behind the Basic auth in src/proxy.ts, including these actions.

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const list = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);

/** Back to where the button was pressed, with a one-line result at the top. */
function back(f: FormData, msg: string): never {
  const to = str(f, "back") || "/admin/seo";
  const url = new URL(to, "http://x");
  url.searchParams.set("msg", msg.slice(0, 300));
  revalidatePath("/admin", "layout");
  redirect(`${url.pathname}${url.search}`);
}
const isDemo = (id: string) => id === DEMO_ID || id.startsWith("demo");
const DEMO_MSG = "That's the demo client: nothing was changed.";

export async function approve(f: FormData) {
  const id = str(f, "id");
  if (isDemo(id)) back(f, DEMO_MSG);
  const a = await getAction(id);
  const r = a && (a.status === "approved" && a.apply?.mode === "list") ? await markDone(id) : await approveAction(id);
  back(f, r.message);
}

/** One press for everything low-risk: written, a kind that can be undone, and a clean visual check where there is one. */
export async function approveAllSafe(f: FormData) {
  const client = str(f, "client");
  const open = (await listActions({ statuses: ["new"], ...(client && !isDemo(client) ? { clientId: client } : {}) })).filter(isSafe);
  let ok = 0;
  const problems: string[] = [];
  for (const a of open.slice(0, 25)) {
    const r = await approveAction(a.id);
    if (r.ok) ok++;
    else problems.push(r.message);
  }
  back(f, `${ok} approved.${problems.length ? ` ${problems.length} held back: ${problems[0]}` : ""}`);
}

export async function done(f: FormData) {
  const id = str(f, "id");
  if (isDemo(id)) back(f, DEMO_MSG);
  back(f, (await markDone(id)).message);
}

export async function dismiss(f: FormData) {
  const id = str(f, "id");
  if (isDemo(id)) back(f, DEMO_MSG);
  await dismissAction(id, str(f, "reason") || undefined);
  back(f, "Dismissed. It won't come back for 30 days.");
}

export async function snooze(f: FormData) {
  const id = str(f, "id");
  if (isDemo(id)) back(f, DEMO_MSG);
  await updateAction(id, { status: "snoozed", snoozed_until: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  back(f, "Snoozed for 7 days.");
}

/** Saves edits to the draft's text before approving. An open pull request is withdrawn so the edit gets a fresh preview. */
export async function saveEdit(f: FormData) {
  const id = str(f, "id");
  if (isDemo(id)) back(f, DEMO_MSG);
  const a = await getAction(id);
  if (!a?.draft) back(f, "Nothing to edit.");
  const draft = { ...a.draft, fields: a.draft.fields?.map((x) => ({ ...x, after: f.has(`field:${x.name}`) ? str(f, `field:${x.name}`) : x.after })), html: f.has("html") ? str(f, "html") : a.draft.html };
  if (a.apply?.prNumber) await dismissAction(id);
  await updateAction(id, { draft, status: "new", apply: null, dismissed_reason: null });
  back(f, "Saved.");
}

export async function writeNow(f: FormData) {
  const id = str(f, "id");
  if (isDemo(id)) back(f, DEMO_MSG);
  const a = await getAction(id);
  const s = a ? await getSettings(a.client_id) : null;
  const { data: c } = a ? await db().from("clients").select("*").eq("id", a.client_id).maybeSingle<Client>() : { data: null };
  if (!a || !s || !c) back(f, "That item no longer exists.");
  try {
    const d = await draftFor(a, { ...s.config, country: s.config.country ?? c.country }, c);
    if (!d) back(f, "The AI didn't return anything usable. Try again.");
    await updateAction(id, { draft: d });
  } catch (err) {
    back(f, err instanceof AiUnavailable ? err.message : `Couldn't write it: ${err instanceof Error ? err.message : err}`);
  }
  back(f, "Written. Check it and approve.");
}

export async function refreshPr(f: FormData) {
  const id = str(f, "id");
  if (isDemo(id)) back(f, DEMO_MSG);
  back(f, await progressPr(id).catch((e) => (e instanceof Error ? e.message : String(e))));
}

export async function undo(f: FormData) {
  const id = str(f, "id");
  if (isDemo(id)) back(f, DEMO_MSG);
  back(f, (await undoChange(id)).message);
}

export async function setPaused(f: FormData) {
  const clientId = str(f, "clientId");
  const on = str(f, "paused") === "1";
  if (isDemo(clientId)) back(f, DEMO_MSG);
  if (clientId) await db().from("seo_settings").update({ paused: on }).eq("client_id", clientId);
  else await kvSet("paused", on);
  back(f, on ? "Paused. Checks still run and the inbox still fills, but nothing is applied." : "Running again.");
}

export async function setEnabled(f: FormData) {
  const clientId = str(f, "clientId");
  if (isDemo(clientId)) back(f, DEMO_MSG);
  await ensureSettings(clientId);
  await db().from("seo_settings").update({ enabled: str(f, "enabled") === "1" }).eq("client_id", clientId);
  back(f, str(f, "enabled") === "1" ? "SEO autopilot is on for this client." : "SEO autopilot is off for this client.");
}

export async function runNow(f: FormData) {
  const clientId = str(f, "clientId");
  if (isDemo(clientId)) back(f, DEMO_MSG);
  await patchState(clientId, { progress: "Starting..." });
  after(async () => {
    await runClient(clientId, "full").catch((err) => console.error("SEO run failed", clientId, err));
  });
  back(f, "A full check has started. It takes a few minutes; refresh to see new items.");
}

// ---------- Setup wizard ----------

export async function saveSite(f: FormData) {
  const clientId = str(f, "clientId");
  if (isDemo(clientId)) back(f, DEMO_MSG);
  const domain = str(f, "domain").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  const siteType = (["vercel", "hosted", "wordpress", "other"].includes(str(f, "siteType")) ? str(f, "siteType") : "other") as SiteType;
  let githubRepo = str(f, "githubRepo").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  if (siteType === "vercel" && !githubRepo && domain) githubRepo = (await repoForVercelDomain(domain)) ?? "";
  const patch: Partial<SeoConfig> = { domain, siteType, githubRepo: githubRepo || undefined, siteId: str(f, "siteId") || undefined, wpUrl: str(f, "wpUrl") || undefined, wpUser: str(f, "wpUser") || undefined };
  if (str(f, "wpPassword")) {
    try {
      patch.wpPasswordEnc = encrypt(str(f, "wpPassword"));
    } catch (err) {
      back(f, err instanceof Error ? err.message : "Couldn't save the WordPress password.");
    }
  }
  await saveConfig(clientId, patch);
  redirect(`/admin/seo/${clientId}/setup?step=2`);
}

export async function saveGoogle(f: FormData) {
  const clientId = str(f, "clientId");
  if (isDemo(clientId)) back(f, DEMO_MSG);
  await saveConfig(clientId, { gscProperty: str(f, "gscProperty") || undefined, gbpLocation: str(f, "gbpLocation") || undefined, gbpAccount: undefined });
  redirect(`/admin/seo/${clientId}/setup?step=3`);
}

function planFrom(f: FormData, prior: SeoConfig): Partial<SeoConfig> {
  const num = (k: string) => (str(f, k) ? Number(str(f, k)) : undefined);
  return {
    trade: str(f, "trade") || undefined,
    services: list(str(f, "services")).slice(0, 20),
    towns: list(str(f, "towns")).slice(0, 20),
    brandTerms: list(str(f, "brandTerms")),
    ignoreCompetitors: list(str(f, "ignoreCompetitors")),
    jobValueGbp: num("jobValueGbp"),
    enquiryRate: num("enquiryRatePct") ? num("enquiryRatePct")! / 100 : undefined,
    facts: { ...prior.facts, businessName: str(f, "businessName") || undefined, phone: str(f, "phone") || undefined, email: str(f, "email") || undefined, address: str(f, "address") || undefined, yearsTrading: str(f, "yearsTrading") || undefined, accreditations: list(str(f, "accreditations")), guarantees: str(f, "guarantees") || undefined, priceRanges: str(f, "priceRanges") || undefined, team: str(f, "team") || undefined, about: str(f, "about") || undefined, confirmed: f.get("confirmed") === "on" },
    profiles: Object.fromEntries(list(str(f, "profiles")).map((u) => {
      try {
        return [new URL(u).hostname.replace(/^www\./, "").split(".")[0], u];
      } catch {
        return ["", ""];
      }
    }).filter(([k]) => k)),
  };
}

export async function savePlanAndGo(f: FormData) {
  const clientId = str(f, "clientId");
  if (isDemo(clientId)) back(f, DEMO_MSG);
  const s = await ensureSettings(clientId);
  await saveConfig(clientId, planFrom(f, s.config), { enabled: true, setup_done_at: s.setup_done_at ?? new Date().toISOString() });
  await patchState(clientId, { progress: "Starting the first audit..." });
  after(async () => {
    await runClient(clientId, "full").catch((err) => console.error("SEO first audit failed", clientId, err));
  });
  redirect(`/admin/seo/${clientId}/setup?step=4`);
}

export async function saveSettings(f: FormData) {
  const clientId = str(f, "clientId");
  if (isDemo(clientId)) back(f, DEMO_MSG);
  const s = await ensureSettings(clientId);
  const siteType = (["vercel", "hosted", "wordpress", "other"].includes(str(f, "siteType")) ? str(f, "siteType") : (s.config.siteType ?? "other")) as SiteType;
  const patch: Partial<SeoConfig> = {
    ...planFrom(f, s.config),
    domain: str(f, "domain").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase() || s.config.domain,
    siteType,
    githubRepo: str(f, "githubRepo") || undefined,
    wpUrl: str(f, "wpUrl") || undefined,
    wpUser: str(f, "wpUser") || undefined,
    aiBudgetGbp: Number(str(f, "aiBudgetGbp")) || 3,
    autoApply: { titles: f.get("auto:titles") === "on", schema: f.get("auto:schema") === "on", faq: f.get("auto:faq") === "on", posts: f.get("auto:posts") === "on" },
    clientReport: f.get("clientReport") === "on",
  };
  if (str(f, "wpPassword")) {
    try {
      patch.wpPasswordEnc = encrypt(str(f, "wpPassword"));
    } catch (err) {
      back(f, err instanceof Error ? err.message : "Couldn't save the WordPress password.");
    }
  }
  await saveConfig(clientId, patch);
  back(f, "Settings saved.");
}

export async function saveCitation(f: FormData) {
  const clientId = str(f, "clientId");
  if (isDemo(clientId)) back(f, DEMO_MSG);
  const status = ["todo", "listed", "skip"].includes(str(f, "status")) ? str(f, "status") : "todo";
  await db().from("seo_citations").upsert({ client_id: clientId, directory: str(f, "directory"), status, url: str(f, "url") || null, checked_at: new Date().toISOString() });
  back(f, "Saved.");
}

// ---------- Playbook ----------

export async function savePlaybook(f: FormData) {
  await kvSet("playbook", { text: str(f, "text") || DEFAULT_PLAYBOOK, updatedAt: new Date().toISOString() });
  back(f, "Playbook saved. The strategist reads it on its next plan.");
}

export async function clearProposal(f: FormData) {
  const p = await kvGet<{ quarter: string }>("playbook_proposal");
  if (p) await kvSet("playbook_proposal", { quarter: p.quarter, text: "", reviewed: true });
  back(f, "Marked as reviewed.");
}
