import "server-only";
import { ASSETS_BUCKET } from "./env";
import { db, type Client } from "./supabase";
import { buildSiteContent, slugify, type SiteContent } from "./site-content";

export const SITE_ASSETS_BUCKET = "site-assets";

export type Site = {
  id: string;
  client_id: string;
  slug: string;
  domain: string | null;
  content: SiteContent;
  published: boolean;
  gsc_property: string | null;
  gbp_location: string | null;
  gbp_title: string | null;
  created_at: string;
  updated_at: string;
};

/** Finds a site by its slug (app.ascdev.tech/s/slug) or its custom domain. */
export async function findSite(key: string): Promise<Site | null> {
  const k = key.toLowerCase().replace(/^www\./, "");
  const { data: bySlug } = await db().from("sites").select("*").eq("slug", k).maybeSingle<Site>();
  if (bySlug) return bySlug;
  const { data: byDomain } = await db().from("sites").select("*").eq("domain", k).maybeSingle<Site>();
  return byDomain;
}

/** Copies a private upload into the public site bucket and returns its public URL. */
async function publish(path: string, clientId: string): Promise<string | null> {
  const { data: file, error } = await db().storage.from(ASSETS_BUCKET).download(path);
  if (error || !file) return null;
  const name = path.split("/").pop()!;
  const dest = `${clientId}/${name}`;
  const { error: upErr } = await db()
    .storage.from(SITE_ASSETS_BUCKET)
    .upload(dest, file, { upsert: true, contentType: file.type || undefined, cacheControl: "31536000" });
  if (upErr) return null;
  return db().storage.from(SITE_ASSETS_BUCKET).getPublicUrl(dest).data.publicUrl;
}

async function uniqueSlug(base: string, clientId: string) {
  let slug = base || "site";
  for (let i = 2; i < 50; i++) {
    const { data } = await db().from("sites").select("client_id").eq("slug", slug).maybeSingle<{ client_id: string }>();
    if (!data || data.client_id === clientId) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Builds (or rebuilds) a client's site from their latest onboarding answers.
 * Keeps the existing slug, domain and published state when regenerating.
 */
export async function generateSite(client: Client): Promise<Site> {
  const { data: sub, error } = await db()
    .from("onboarding_submissions")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ data: Record<string, unknown>; logo_path: string | null; photo_paths: string[] }>();
  if (error) throw error;
  if (!sub) throw new Error("This client hasn't submitted their onboarding form yet.");

  const [logoUrl, ...photoUrls] = await Promise.all([
    sub.logo_path ? publish(sub.logo_path, client.id) : Promise.resolve(null),
    ...sub.photo_paths.map((p) => publish(p, client.id)),
  ]);

  const content = buildSiteContent(sub.data, {
    logoUrl,
    photoUrls: photoUrls.filter((u): u is string => !!u),
  });

  const { data: existing } = await db().from("sites").select("*").eq("client_id", client.id).maybeSingle<Site>();
  const slug = existing?.slug ?? (await uniqueSlug(slugify(content.businessName), client.id));

  const { data: site, error: upErr } = await db()
    .from("sites")
    .upsert(
      { client_id: client.id, slug, content, updated_at: new Date().toISOString() },
      { onConflict: "client_id" },
    )
    .select("*")
    .single<Site>();
  if (upErr) throw upErr;
  return site;
}
