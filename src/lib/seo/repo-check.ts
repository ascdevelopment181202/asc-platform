// Pure: no network, so it can be tested on its own.

type RepoFile = { path: string };

/**
 * Whether a repo actually holds a website Vercel can deploy, not just a zip or a README.
 * Returns a plain sentence saying what's wrong, or null when it looks fine.
 */
export function siteFilesProblem(files: RepoFile[]): string | null {
  const paths = files.map((f) => f.path);
  const hasSite = paths.some((p) => /(^|\/)index\.html?$/i.test(p) || /^package\.json$/.test(p) || /\.html?$/i.test(p));
  if (hasSite) return null;
  const zips = paths.filter((p) => /\.zip$/i.test(p));
  if (zips.length) return `The repo only holds ${zips.length === 1 ? `a zip (${zips[0]})` : `${zips.length} zip files`}, not the website files. Unzip it and upload index.html itself, or the autopilot's fixes won't reach the live site.`;
  if (!paths.length) return "The repo is empty. Upload the site's index.html, or the autopilot's fixes won't reach the live site.";
  return "The repo has no index.html or package.json, so it doesn't look like the website. Upload the site's files, or the autopilot's fixes won't reach the live site.";
}

