import Link from "next/link";
import { notFound } from "next/navigation";
import { env, googleEnabled, seoEnv } from "@/lib/env";
import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";
import { googleAccount, listBusinessLocations, listSearchConsoleSites, type GbpLocation } from "@/lib/google";
import { repoForVercelDomain } from "@/lib/seo/github";
import { hostedSite, matchLocation, matchProperty, prefill } from "@/lib/seo/setup";
import { ensureSettings, listActions } from "@/lib/seo/store";
import { btn, btnQuiet, input } from "../../../ui";
import { saveGoogle, savePlanAndGo, saveSite } from "../../actions";
import { AutoRefresh, CopyButton } from "../../client";
import { card, Msg } from "../../ui";

export const dynamic = "force-dynamic";
// "Run a full check" and the first audit carry on after the response, inside this limit.
export const maxDuration = 300;

const label = "block text-xs font-medium text-neutral-600";
const field = `${input} mt-1 w-full`;

export default async function Setup({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ step?: string; msg?: string }> }) {
  if (!seoEnv.on()) notFound();
  const { clientId } = await params;
  const sp = await searchParams;
  const { data: c } = await db().from("clients").select("*").eq("id", clientId).maybeSingle<Client>();
  if (!c) notFound();
  const s = await ensureSettings(clientId);
  const cfg = s.config;
  const step = Math.min(4, Math.max(1, Number(sp.step) || 1));
  const name = clientLabel(c);
  const me = env.googleManagerEmail;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Msg msg={sp.msg} />
      <div>
        <p className="text-xs text-neutral-500"><Link href="/admin/seo" className="underline">SEO inbox</Link> / <Link href={`/admin/clients/${clientId}`} className="underline">{name}</Link></p>
        <h1 className="mt-1 text-2xl font-semibold">Set up SEO for {name}</h1>
        <ol className="mt-3 flex flex-wrap gap-2 text-sm">
          {["Site", "Google", "Plan", "Go"].map((l, i) => <li key={l}><Link href={`/admin/seo/${clientId}/setup?step=${i + 1}`} className={`rounded-full px-3 py-1 ${step === i + 1 ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-700"}`}>{i + 1}. {l}</Link></li>)}
        </ol>
      </div>
      {step === 1 && <StepSite c={c} cfg={cfg} />}
      {step === 2 && <StepGoogle c={c} cfg={cfg} me={me} />}
      {step === 3 && <StepPlan c={c} cfg={cfg} />}
      {step === 4 && <StepGo clientId={clientId} progress={s.state.progress} lastError={s.state.lastError} />}
    </div>
  );
}

async function StepSite({ c, cfg }: { c: Client; cfg: Awaited<ReturnType<typeof ensureSettings>>["config"] }) {
  const site = await hostedSite(c.id).catch(() => null);
  const domain = cfg.domain ?? site?.domain ?? (c.live_url ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const type = cfg.siteType ?? (site && (!domain || site.domain === domain) ? "hosted" : "vercel");
  const repo = cfg.githubRepo ?? (domain && type === "vercel" ? await repoForVercelDomain(domain) : null) ?? "";
  return (
    <form action={saveSite} className={`${card} group space-y-4 p-5`}>
      <input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="back" value={`/admin/seo/${c.id}/setup?step=1`} />
      {site && <input type="hidden" name="siteId" value={site.id} />}
      <label className={label}>Website address<input name="domain" defaultValue={domain} placeholder="picdriveways.com" required className={field} /></label>
      <fieldset className="space-y-2">
        <legend className={label}>How is the site built?</legend>
        {([["vercel", "Its own Vercel project", "A Claude Design site on Vercel, on the client's domain (wherever the domain was bought, such as GoDaddy). Fixes go to its GitHub repo as pull requests, with a preview, and go live when you approve."], ["hosted", "Hosted on the ASC platform", "The platform renders it, so changes apply directly."], ["wordpress", "WordPress", "Content publishes through an application password."], ["other", "Something else (Shopify, Wix...)", "Fixes come as a short change list to paste or send on."]] as const).map(([v, l, d]) => (
          <label key={v} className="flex items-start gap-2 rounded-lg border border-neutral-200 p-3 text-sm"><input type="radio" name="siteType" value={v} defaultChecked={type === v} className="mt-1" /><span><span className="font-medium">{l}</span><span className="block text-xs text-neutral-500">{d}</span></span></label>
        ))}
      </fieldset>
      <label className={`${label} hidden group-has-[input[value=vercel]:checked]:block`}>GitHub repo, for a Vercel project site (owner/name)<input name="githubRepo" defaultValue={repo} placeholder="ascdevelopment181202/picdrivway" className={field} /><span className="mt-1 block font-normal text-neutral-500">{seoEnv.vercelToken() ? "Found from the Vercel project when it's linked to GitHub." : "Type it in. With VERCEL_TOKEN added this is found for you."} Not linked yet? In the site&apos;s Vercel project: Settings, Git, Connect Git Repository.{!seoEnv.githubToken() && " GITHUB_TOKEN is not added yet, so until it is, fixes arrive as change lists."}</span></label>
      <div className="hidden rounded-lg border border-neutral-200 p-3 text-sm group-has-[input[value=wordpress]:checked]:block">
        <p className="font-medium">WordPress details</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className={label}>Site address<input name="wpUrl" defaultValue={cfg.wpUrl ?? ""} className={field} /></label>
          <label className={label}>Username<input name="wpUser" defaultValue={cfg.wpUser ?? ""} className={field} /></label>
          <label className={label}>Application password<input name="wpPassword" type="password" autoComplete="new-password" className={field} /></label>
        </div>
      </div>
      <button className={btn}>Next: Google</button>
    </form>
  );
}

async function StepGoogle({ c, cfg, me }: { c: Client; cfg: Awaited<ReturnType<typeof ensureSettings>>["config"]; me: string }) {
  const account = googleEnabled() ? await googleAccount() : null;
  let properties: string[] = [];
  let locations: GbpLocation[] = [];
  const errors: string[] = [];
  if (account) {
    await Promise.all([
      listSearchConsoleSites().then((r) => (properties = r)).catch((e) => errors.push(`Search Console: ${e instanceof Error ? e.message : e}`)),
      listBusinessLocations().then((r) => (locations = r)).catch((e) => errors.push(`Business Profile: ${e instanceof Error ? e.message : e}`)),
    ]);
  }
  const site = await hostedSite(c.id).catch(() => null);
  const prop = cfg.gscProperty ?? site?.gsc_property ?? matchProperty(properties, cfg.domain) ?? "";
  const loc = cfg.gbpLocation ?? c.gbp_location ?? site?.gbp_location ?? matchLocation(locations, c.business_name)?.name ?? "";
  const askGsc = `Hi, could you give me access to your website's Google Search Console? It shows which searches bring people to your site.\n\n1. Go to search.google.com/search-console and sign in.\n2. Settings, then Users and permissions, then Add user.\n3. Enter ${me}, choose Full, and tap Add.\n\nThanks!`;
  const askGbp = `Hi, to manage your Google listing for you I need adding as a manager. It takes a minute:\n\n1. Search Google for your business name while signed in to the account that owns the listing.\n2. Tap the three dots, then Business Profile settings, then People and access.\n3. Tap Add, enter ${me}, choose Manager, and tap Invite.\n\nThanks!`;
  return (
    <form action={saveGoogle} className={`${card} space-y-4 p-5`}>
      <input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="back" value={`/admin/seo/${c.id}/setup?step=2`} />
      {!account && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Google isn&apos;t connected. Connect it on the <Link href="/admin" className="underline">admin home page</Link>, signed in as {me}, then come back. You can also skip this step and connect later.</p>}
      {account && <p className="text-sm text-neutral-600">Connected as {account.email}. {properties.length} Search Console properties and {locations.length} Business Profiles found.</p>}
      {errors.map((e) => <p key={e} className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{e}</p>)}
      <label className={label}>Search Console property {prop && !cfg.gscProperty && <span className="font-normal text-green-700">(matched to {cfg.domain})</span>}
        <select name="gscProperty" defaultValue={prop} className={field}><option value="">None yet</option>{[...new Set([...properties, prop].filter(Boolean))].map((p) => <option key={p} value={p}>{p}</option>)}</select>
      </label>
      {!prop && <Ask title={`${cfg.domain ?? "This site"} isn't in the connected account's Search Console.`} how={`If nobody has set it up: sign in as ${me} at search.google.com/search-console, Add property, enter ${cfg.domain ?? "the domain"} and add the DNS record it shows. If the client has it already, send them this:`} text={askGsc} />}
      <label className={label}>Business Profile {loc && !cfg.gbpLocation && <span className="font-normal text-green-700">(matched by name)</span>}
        <select name="gbpLocation" defaultValue={loc} className={field}><option value="">None yet</option>{locations.map((l) => <option key={l.name} value={l.name}>{l.title} · {l.address}</option>)}{loc && !locations.some((l) => l.name === loc) && <option value={loc}>{c.gbp_title ?? loc}</option>}</select>
      </label>
      {!loc && <Ask title="No Business Profile for this client is visible to the connected account." how="Send the client this. Until they do, profile fixes arrive as step-by-step tasks." text={askGbp} />}
      <div className="flex gap-2"><button className={btn}>Next: Plan</button><Link href={`/admin/seo/${c.id}/setup?step=3`} className={btnQuiet}>Skip for now</Link></div>
    </form>
  );
}

function Ask({ title, how, text }: { title: string; how: string; text: string }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-3 text-sm">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-neutral-600">{how}</p>
      <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-2 font-sans text-xs">{text}</pre>
      <div className="mt-2"><CopyButton text={text} label="Copy message" /></div>
    </div>
  );
}

async function StepPlan({ c, cfg }: { c: Client; cfg: Awaited<ReturnType<typeof ensureSettings>>["config"] }) {
  const p = await prefill(c, cfg);
  const f = p.facts ?? {};
  return (
    <form action={savePlanAndGo} className={`${card} space-y-4 p-5`}>
      <input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="back" value={`/admin/seo/${c.id}/setup?step=3`} />
      <p className="text-sm text-neutral-600">Filled in from the site, the Business Profile and the client&apos;s record where possible. Check it: the AI may only state what&apos;s written here, and leaves a gap for anything missing.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Trade<input name="trade" defaultValue={p.trade ?? ""} placeholder="driveways" required className={field} /></label>
        <label className={label}>Average job value (£)<input name="jobValueGbp" type="number" defaultValue={p.jobValueGbp ?? ""} placeholder="Leave blank to use a typical figure" className={field} /></label>
        <label className={label}>Services, one per line<textarea name="services" rows={6} defaultValue={(p.services ?? []).join("\n")} required className={field} /></label>
        <label className={label}>Towns, one per line, most important first<textarea name="towns" rows={6} defaultValue={(p.towns ?? []).join("\n")} required className={field} /></label>
        <label className={label}>Business name<input name="businessName" defaultValue={f.businessName ?? ""} required className={field} /></label>
        <label className={label}>Phone<input name="phone" defaultValue={f.phone ?? ""} className={field} /></label>
        <label className={label}>Email<input name="email" defaultValue={f.email ?? ""} className={field} /></label>
        <label className={label}>Address<input name="address" defaultValue={f.address ?? ""} className={field} /></label>
        <label className={label}>Years trading<input name="yearsTrading" defaultValue={f.yearsTrading ?? ""} placeholder="Trading since 2009" className={field} /></label>
        <label className={label}>Accreditations<input name="accreditations" defaultValue={(f.accreditations ?? []).join(", ")} className={field} /></label>
        <label className={label}>Guarantees<input name="guarantees" defaultValue={f.guarantees ?? ""} className={field} /></label>
        <label className={label}>Price ranges<input name="priceRanges" defaultValue={f.priceRanges ?? ""} className={field} /></label>
        <label className={label}>Brand terms<input name="brandTerms" defaultValue={(p.brandTerms ?? []).join(", ")} className={field} /></label>
        <label className={label}>Profiles elsewhere, one address per line<textarea name="profiles" rows={2} defaultValue={Object.values(p.profiles ?? {}).join("\n")} placeholder="https://facebook.com/..." className={field} /></label>
        <label className={`${label} sm:col-span-2`}>About, in their words<textarea name="about" rows={2} defaultValue={f.about ?? ""} className={field} /></label>
      </div>
      <input type="hidden" name="team" value={f.team ?? ""} /><input type="hidden" name="ignoreCompetitors" value={(p.ignoreCompetitors ?? []).join(", ")} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confirmed" defaultChecked={!!f.confirmed} /> I&apos;ve checked these facts are right</label>
      <button className={btn}>Go: switch on and run the first audit</button>
    </form>
  );
}

async function StepGo({ clientId, progress, lastError }: { clientId: string; progress?: string; lastError?: string }) {
  const found = (await listActions({ clientId, statuses: ["new"] })).length;
  return (
    <div className={`${card} space-y-4 p-5`}>
      {progress ? (
        <>
          <AutoRefresh seconds={5} />
          <p className="text-sm font-medium">The first audit is running: {progress}</p>
          <p className="text-sm text-neutral-600">It reads the site, Search Console and the Business Profile, takes the baseline, and fills the inbox. Usually 2 to 4 minutes. This page refreshes itself; you can also leave and come back.</p>
        </>
      ) : (
        <p className="text-sm font-medium">The first audit has finished. The autopilot is on for this client and checks every morning from 5am.</p>
      )}
      <p className="text-sm">{found} item{found === 1 ? "" : "s"} found so far.</p>
      {lastError && !progress && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{lastError}</p>}
      <div className="flex gap-2"><Link href={`/admin/seo?client=${clientId}`} className={btn}>Open the inbox</Link><Link href={`/admin/seo/${clientId}`} className={btnQuiet}>Client SEO page</Link></div>
    </div>
  );
}
