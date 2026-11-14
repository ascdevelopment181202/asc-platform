import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { findSite } from "@/lib/sites";

/**
 * Loads the site for a route param, which is either a slug (app.ascdev.tech/s/<slug>)
 * or a custom domain (rewritten here by src/proxy.ts). Unpublished sites only show
 * on the slug preview URL, never on a custom domain.
 */
export const loadSite = cache(async (param: string) => {
  const key = decodeURIComponent(param);
  const site = await findSite(key);
  if (!site) notFound();
  const viaDomain = key.toLowerCase().replace(/^www\./, "") !== site.slug;
  if (viaDomain && !site.published) notFound();
  return { site, base: viaDomain ? "" : `/s/${site.slug}`, preview: !site.published };
});
