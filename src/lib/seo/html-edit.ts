// Small, exact edits to an HTML file. Pure functions: each returns the new file text and changes nothing else in it.
// A bundled single-page site carries its whole app inside <script> tags, and that code can contain strings like
// "</body>" or "<title>". Every edit here ignores anything inside a script or style block.

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escHtml(s).replace(/"/g, "&quot;");

function codeRanges(html: string): [number, number][] {
  return [...html.matchAll(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi)].map((m) => [m.index!, m.index! + m[0].length]);
}

/** The first (or last) match that sits in real markup, not inside a script or style block. */
function find(html: string, re: RegExp, which: "first" | "last" = "first"): { index: number; length: number } | null {
  const ranges = codeRanges(html);
  const outside = [...html.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].filter((m) => !ranges.some(([a, b]) => m.index! >= a && m.index! < b));
  const m = which === "first" ? outside[0] : outside[outside.length - 1];
  return m ? { index: m.index!, length: m[0].length } : null;
}
const splice = (html: string, at: number, remove: number, insert: string) => html.slice(0, at) + insert + html.slice(at + remove);

export function intoHead(html: string, block: string): string {
  if (html.includes(block)) return html;
  const end = find(html, /<\/head\s*>/i);
  return end ? splice(html, end.index, 0, `${block}\n`) : html;
}

export function intoBody(html: string, block: string): string {
  if (html.includes(block)) return html;
  const end = find(html, /<\/body\s*>/i, "last");
  return end ? splice(html, end.index, 0, `${block}\n`) : html;
}

export function setTitle(html: string, title: string): string {
  const tag = `<title>${escHtml(title)}</title>`;
  const cur = find(html, /<title\b[^>]*>[\s\S]*?<\/title\s*>/i);
  if (cur) return splice(html, cur.index, cur.length, tag);
  const head = find(html, /<head\b[^>]*>/i);
  return head ? splice(html, head.index + head.length, 0, `\n${tag}`) : html;
}

export function setDescription(html: string, description: string): string {
  const tag = `<meta name="description" content="${escAttr(description)}">`;
  const cur = find(html, /<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i);
  return cur ? splice(html, cur.index, cur.length, tag) : intoHead(html, tag);
}

/** True when a block is only structured data, which belongs in the head. */
export const isHeadOnly = (block: string) => /^\s*(<script[^>]*application\/ld\+json[\s\S]*?<\/script>\s*)+$/i.test(block);

// ---------- Claude Design bundles ----------
// A Claude Design export is one index.html whose real page is a JSON string inside <script type="__bundler/template">.
// Once scripts run, that template replaces the document, so a title or description set only in the outer head is lost.

const BUNDLE_OPEN = /<script\b[^>]*type\s*=\s*["']__bundler\/template["'][^>]*>/i;
export const isClaudeBundle = (html: string) => BUNDLE_OPEN.test(html);

/** Text as it must appear inside the template's JSON string. */
const inJson = (s: string) => JSON.stringify(s).slice(1, -1).replace(/<\//g, "<\\u002F");
const unHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Copies the outer title and description into the bundle's template, so they survive once the page loads. */
export function syncBundleHead(html: string): string {
  const open = html.match(BUNDLE_OPEN);
  if (!open || open.index === undefined) return html;
  const start = open.index + open[0].length;
  const end = html.indexOf("</script>", start);
  if (end < 0) return html;
  const outer = html.slice(0, open.index);
  const title = outer.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]?.trim();
  const desc = outer.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*"([^"]*)"/i)?.[1];
  let tpl = html.slice(start, end);
  const anchor = tpl.search(/initial-scale=1\\">/) >= 0 ? tpl.indexOf('initial-scale=1\\">') + 'initial-scale=1\\">'.length : tpl.indexOf("<head>") >= 0 ? tpl.indexOf("<head>") + 6 : -1;
  if (title && !/^bundled page$/i.test(title)) {
    const tag = `<title>${inJson(unHtml(title))}<\\u002Ftitle>`;
    const cur = tpl.match(/<title>[\s\S]*?<\\u002Ftitle>/);
    if (cur) tpl = tpl.replace(cur[0], () => tag);
    else if (anchor >= 0) tpl = `${tpl.slice(0, anchor)}\\n${tag}${tpl.slice(anchor)}`;
  }
  if (desc) {
    const tag = `<meta name=\\"description\\" content=\\"${inJson(unHtml(desc)).replace(/\\"/g, "&quot;")}\\">`;
    const cur = tpl.match(/<meta name=\\"description\\" content=\\"[^>]*?\\">/);
    if (cur) tpl = tpl.replace(cur[0], () => tag);
    else {
      const t = tpl.match(/<\\u002Ftitle>/);
      const at = t && t.index !== undefined ? t.index + t[0].length : anchor;
      if (at >= 0) tpl = `${tpl.slice(0, at)}\\n${tag}${tpl.slice(at)}`;
    }
  }
  return html.slice(0, start) + tpl + html.slice(end);
}
