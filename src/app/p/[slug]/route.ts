import { prospectKit } from "@/lib/prospect-kit";
import { findProspect } from "@/lib/prospects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/**
 * Preview page for an outbound prospect (clinic cold email), in the asc-site-kit design.
 * Never indexed. Add ?review to the URL when checking a page yourself, so the visit is not counted.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeURIComponent((await params).slug).toLowerCase();
  const p = /^[a-z0-9-]{3,60}$/.test(slug) ? await findProspect(slug) : null;
  if (!p || !p.preview_content) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  const c = p.preview_content;
  const track = `<script>(function(){if(navigator.webdriver||/[?&]review/.test(location.search))return;try{var b=JSON.stringify({slug:${json(slug)}});navigator.sendBeacon?navigator.sendBeacon("/api/prospect-view",b):fetch("/api/prospect-view",{method:"POST",body:b,keepalive:true})}catch(e){}})();</script>`;
  const html = `<!doctype html>
<html lang="en-GB">
<head>
<script>document.documentElement.classList.add("js")</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(`Preview for ${p.name}`)}</title>
<meta name="description" content="${esc(c.subheadline)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/kit/kit.css">
</head>
<body>
<noscript><h1>${esc(c.headline)}</h1><p>${esc(c.subheadline)}</p></noscript>
<script>window.SITE=${json(prospectKit(p, c))};</script>
<script src="/kit/kit.js"></script>
${track}
</body>
</html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" },
  });
}
