import "server-only";
import { env, seoEnv } from "@/lib/env";
import type { Connection, SeoSettings } from "./types";

const ago = (iso?: string) => (iso ? ` Last checked ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}.` : "");

/** Every connection a client's SEO depends on, most valuable first, with exactly what to do about each gap. */
export function connectionsFor(s: SeoSettings, name: string, opts: { tracking: boolean; bing: boolean; google: boolean }): Connection[] {
  const cfg = s.config;
  const st = s.state;
  const me = env.googleManagerEmail;
  const out: Connection[] = [];

  out.push({
    key: "gbp",
    label: "Business Profile",
    state: !opts.google || !cfg.gbpLocation ? "missing" : st.gbp && (!st.gbp.ok || !st.gbp.write) ? "partial" : "ok",
    unlocks: "Lets the dashboard read calls and searches, publish posts, edit the description and hours, and reply to reviews.",
    detail: !opts.google ? "Google isn't connected on the admin home page." : !cfg.gbpLocation ? "No profile picked for this client yet." : st.gbp && !st.gbp.ok ? `Google returned an error: ${st.gbp.error ?? "unknown"}.${ago(st.gbp.at)}` : st.gbp && !st.gbp.write ? `Reading works but edits are refused: ${st.gbp.error ?? "no edit access"}. Profile changes arrive as guided tasks until this is fixed.${ago(st.gbp.at)}` : `Connected, with edit access.${ago(st.gbp?.at)}`,
    steps: [`Ask ${name} to add ${me} as a Manager on their Google Business Profile (message below).`, "Accept the invite from that Google account's inbox.", "Open Set up SEO for this client and pick the profile on the Google step.", "If edits are still refused after that, the Google Cloud project needs Business Profile API access: request it once at developers.google.com/my-business/content/prereqs."],
    message: `Hi, to manage your Google listing for you I need adding as a manager. It takes a minute:\n\n1. Search Google for your business name while signed in to the account that owns the listing.\n2. Tap the three dots, then Business Profile settings, then People and access.\n3. Tap Add, enter ${me}, choose Manager, and tap Invite.\n\nThanks!`,
  });
  out.push({
    key: "gsc",
    label: "Search Console",
    state: !opts.google || !cfg.gscProperty ? "missing" : st.gsc && !st.gsc.ok ? "partial" : "ok",
    unlocks: "Every search the site shows for, its position, clicks and which pages rank. Most of the proactive checks run on this.",
    detail: !opts.google ? "Google isn't connected on the admin home page." : !cfg.gscProperty ? "No Search Console property picked yet." : st.gsc && !st.gsc.ok ? `Google returned an error: ${st.gsc.error ?? "unknown"}.${ago(st.gsc.at)}` : st.gsc?.tooEarly ? `Connected, but there's too little search data to judge yet.${ago(st.gsc.at)}` : `Connected.${ago(st.gsc?.at)}`,
    steps: [`If the site isn't in Search Console yet: sign in as ${me} at search.google.com/search-console, Add property, enter ${cfg.domain ?? "the domain"}, and add the DNS record it shows at the domain registrar.`, `If the client already has it: ask them to add ${me} under Settings, Users and permissions, as Full (message below).`, "Open Set up SEO for this client and pick the property on the Google step."],
    message: `Hi, could you give me access to your website's Google Search Console? It shows which searches bring people to your site.\n\n1. Go to search.google.com/search-console and sign in.\n2. Settings, then Users and permissions, then Add user.\n3. Enter ${me}, choose Full, and tap Add.\n\nThanks!`,
  });
  out.push({
    key: "anthropic",
    label: "Claude API key",
    state: seoEnv.anthropicKey() ? "ok" : "missing",
    unlocks: "Writes the fixes: titles, answers, pages, posts and review replies. Without it the checks still run and items wait to be written.",
    detail: seoEnv.anthropicKey() ? "Connected for every client." : "Not added yet. Applies to every client.",
    steps: ["Go to console.anthropic.com, add credit (£10 is plenty to start) and set a monthly limit.", "Create an API key.", "In Vercel: asc-platform, Settings, Environment Variables, add ANTHROPIC_API_KEY, then redeploy."],
  });
  const type = cfg.siteType ?? "other";
  const repoOk = !!cfg.githubRepo && !!seoEnv.githubToken() && st.github?.ok !== false;
  out.push({
    key: "site",
    label: type === "vercel" ? "Site editing (GitHub)" : type === "wordpress" ? "Site editing (WordPress)" : type === "hosted" ? "Site editing (platform)" : "Site editing",
    state: type === "hosted" ? "ok" : type === "vercel" ? (repoOk ? "ok" : cfg.githubRepo ? "partial" : "missing") : type === "wordpress" ? (cfg.wpUrl && cfg.wpUser && cfg.wpPasswordEnc ? "ok" : "partial") : "partial",
    unlocks: "Lets approved fixes go live on the website without anyone editing it by hand.",
    detail: type === "hosted" ? "The platform renders this site, so changes apply directly." : type === "vercel" ? (repoOk ? `Changes go to ${cfg.githubRepo} as pull requests with a preview.` : cfg.githubRepo ? (seoEnv.githubToken() ? `GitHub refused: ${st.github?.error ?? "check the token can reach this repo"}.` : `Repo ${cfg.githubRepo} is set, but GITHUB_TOKEN isn't added, so fixes arrive as change lists to paste.`) : "No GitHub repo set for this site, so fixes arrive as change lists to paste.") : type === "wordpress" ? (cfg.wpPasswordEnc ? "Content changes publish through WordPress. Titles and descriptions still come as a change list." : "No application password yet, so fixes arrive as change lists.") : "This kind of site can't be edited from here, so fixes arrive as short change lists to paste or send to whoever hosts it.",
    steps: type === "wordpress" ? ["In WordPress: Users, Profile, Application Passwords. Name it ASC and press Add.", "Paste the site address, username and that password under Settings for this client."] : ["In the site's Vercel project: Settings, Git, and connect it to a GitHub repo if it isn't already.", "On GitHub: Settings, Developer settings, Fine-grained tokens. Give it the client site repos, with Contents and Pull requests set to Read and write.", "In Vercel (asc-platform): add GITHUB_TOKEN, then redeploy.", "Enter the repo (owner/name) under Settings for this client."],
  });
  out.push({
    key: "googlekey",
    label: "Google API key",
    state: seoEnv.googleKey() ? "ok" : "missing",
    unlocks: "Competitor checks on Google Maps and the weekly speed test.",
    detail: seoEnv.googleKey() ? "Connected for every client." : "Not added yet. Applies to every client.",
    steps: ["In Google Cloud (the same project as the Google sign-in): enable Places API (New) and PageSpeed Insights API.", "Credentials, Create credentials, API key.", "Set a £1 budget alert under Billing so nothing is ever charged unnoticed.", "In Vercel: add GOOGLE_API_KEY, then redeploy."],
  });
  out.push({
    key: "tracking",
    label: "Tracking script",
    state: opts.tracking ? "ok" : st.crawl?.tracking ? "partial" : "missing",
    unlocks: "Counts taps on the call button, form enquiries and visits from ChatGPT and other AI tools, and gives the real enquiry rate for the value estimates.",
    detail: opts.tracking ? "Receiving visits." : st.crawl?.tracking ? "The script is on the site but no visits have arrived yet." : "Not on the site yet. The launch check adds it.",
    steps: ["Approve the launch check (or the tracking script item) in the inbox.", "For sites edited by hand, paste this before </body> on every page:"],
    message: `<script defer src="${seoEnv.appUrl()}/seo-t.js" data-t="${s.tracking_token}"></script>`,
  });
  out.push({
    key: "bing",
    label: "Bing",
    state: opts.bing ? "ok" : "missing",
    unlocks: "Bing search data, and faster pick-up by ChatGPT search, which leans on Bing.",
    detail: opts.bing ? "Receiving Bing data." : seoEnv.bingKey() ? "The key is added, but this site isn't in Bing Webmaster Tools yet." : "Not connected.",
    steps: ["Go to bing.com/webmasters and sign in with the Google account.", "Import sites from Search Console: one click brings every client site across.", "Settings, API access, generate a key.", "In Vercel: add BING_WEBMASTER_API_KEY and INDEXNOW_KEY (any random 32 letters and numbers), then redeploy."],
  });
  out.push({ key: "gemini", label: "Gemini", state: seoEnv.geminiKey() ? "ok" : "partial", unlocks: "Checks what Google's AI answers say. Optional: Claude stands in until it's added.", detail: seoEnv.geminiKey() ? "Connected." : "Optional. AI visibility checks use Claude's web search for now.", steps: ["Go to aistudio.google.com and create an API key.", "In Vercel: add GEMINI_API_KEY, then redeploy."] });
  out.push({ key: "openai", label: "ChatGPT", state: seoEnv.openaiKey() ? "ok" : "partial", unlocks: "Checks what ChatGPT says. Optional: Claude stands in until it's added.", detail: seoEnv.openaiKey() ? "Connected." : "Optional. AI visibility checks use Claude's web search for now.", steps: ["Go to platform.openai.com, add about $5 of credit and create an API key.", "In Vercel: add OPENAI_API_KEY, then redeploy."] });
  return out;
}
