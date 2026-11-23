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
