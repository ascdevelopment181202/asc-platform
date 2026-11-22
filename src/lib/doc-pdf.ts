import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { db, type Client } from "@/lib/supabase";
import { env } from "@/lib/env";
import { brandOf } from "@/lib/brand";
import { displayPhone, localeFor } from "@/lib/phone";
import { docLink, docTitle, money, type Doc } from "@/lib/crm";

export type DocContact = { name: string | null; phone: string; address: string | null; email: string | null };
export type DocBundle = { doc: Doc; c: Client; contact: DocContact | null };

/** A sent quote or invoice by its public link token (drafts aren't public). */
export async function loadPublicDoc(token: string): Promise<DocBundle | null> {
  if (!/^[0-9a-f]{24}$/.test(token)) return null;
  const { data: doc } = await db().from("documents").select("*").eq("public_token", token).maybeSingle<Doc>();
  if (!doc || doc.status === "draft") return null;
  return bundleFor(doc);
}

/** Any of the client's own documents, drafts included (for the owner's app). */
export async function loadOwnDoc(clientId: string, docId: string): Promise<DocBundle | null> {
  if (!/^[0-9a-f-]{36}$/.test(docId)) return null;
  const { data: doc } = await db().from("documents").select("*").eq("id", docId).eq("client_id", clientId).maybeSingle<Doc>();
  return doc ? bundleFor(doc) : null;
}

async function bundleFor(doc: Doc): Promise<DocBundle | null> {
  const [{ data: c }, { data: contact }] = await Promise.all([
    db().from("clients").select("*").eq("id", doc.client_id).single<Client>(),
    db().from("contacts").select("name, phone, address, email").eq("id", doc.contact_id).maybeSingle<DocContact>(),
  ]);
  return c ? { doc, c, contact } : null;
}

export const pdfFileName = (b: DocBundle) => `${brandOf(b.c).name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}-${docTitle(b.doc).replace(" #", "-")}.pdf`;

// ---- drawing helpers ----

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // page margin
const INK = rgb(0.07, 0.07, 0.07);
const SOFT = rgb(0.38, 0.38, 0.4);
const LINE = rgb(0.88, 0.88, 0.89);

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Standard PDF fonts only cover Western European characters: swap the common extras and drop the rest. */
function safe(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[^\n\x20-\x7E¡-ÿ€]/g, "");
}

/** Splits text into lines that fit the width (keeps explicit line breaks). */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        // a single word longer than the line (e.g. a URL): hard-break it
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

async function embedLogo(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes);
  } catch (err) {
    console.error("Logo for PDF failed", url, err);
  }
  return null;
}

/** Builds the branded A4 PDF for a quote or invoice. */
export async function renderDocPdf({ doc, c, contact }: DocBundle): Promise<Uint8Array> {
  const brand = brandOf(c);
  const accent = hexToRgb(brand.color);
  const onAccent = hexToRgb(brand.onColor);
  const us = c.country === "US";
  const locale = localeFor(c.country);
  const tz = c.timezone || "Europe/London";
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: tz });
  const inv = c.invoice_details ?? {};
  const isQuote = doc.kind === "quote";

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${docTitle(doc)} from ${brand.name}`);
  pdf.setAuthor(brand.name);
  pdf.setCreator("ASC Development");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, brand.logo);

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;
  const right = A4.w - M;
  const text = (s: string, x: number, yy: number, size = 10, f = font, color = INK) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const textRight = (s: string, xr: number, yy: number, size = 10, f = font, color = INK) => text(s, xr - f.widthOfTextAtSize(safe(s), size), yy, size, f, color);
  const ensure = (needed: number) => {
    if (y - needed < M + 40) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M;
    }
  };

  // Header: logo (or name) on the left, document type on the right
  const headTop = y;
  if (logo) {
    const scale = Math.min(170 / logo.width, 64 / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    page.drawImage(logo, { x: M, y: headTop - h, width: w, height: h });
    y = headTop - h;
  } else {
    text(brand.name, M, headTop - 20, 20, bold);
    y = headTop - 26;
  }
  textRight(isQuote ? "QUOTE" : "INVOICE", right, headTop - 22, 24, bold);
  textRight(`No. ${doc.number}`, right, headTop - 38, 10, font, SOFT);
  y = Math.min(y, headTop - 44) - 14;
  page.drawRectangle({ x: M, y, width: right - M, height: 4, color: accent });
  y -= 26;

  // From / To / Dates
  const colW = (right - M) / 3;
  const block = (label: string, lines: (string | null | undefined)[], x: number, firstBold = true) => {
    let yy = y;
    text(label.toUpperCase(), x, yy, 8, bold, SOFT);
    yy -= 14;
    lines
      .filter((l): l is string => !!l)
      .flatMap((l) => wrap(l, font, 9.5, colW - 12))
      .forEach((l, i) => {
        text(l, x, yy, 9.5, i === 0 && firstBold ? bold : font);
        yy -= 12.5;
      });
    return yy;
  };
  const fromEnd = block("From", [brand.name, brand.address, brand.phone, brand.email, brand.website, brand.companyNumber && `Company no. ${brand.companyNumber}`, brand.vatNumber && `${us ? "Tax ID" : "VAT no."} ${brand.vatNumber}`], M);
  const toEnd = block(isQuote ? "Quote for" : "Bill to", [contact?.name ?? (contact ? displayPhone(contact.phone) : "Customer"), contact?.address, contact?.name && contact.phone ? displayPhone(contact.phone) : null, contact?.email], M + colW);
  const dates: string[] = [`Date: ${date(doc.sent_at ?? doc.created_at)}`];
  if (!isQuote && doc.due_date) dates.push(`Due: ${date(`${doc.due_date}T12:00:00Z`)}`);
  if (isQuote) dates.push("Valid for 30 days");
  const dateEnd = block("Details", dates, M + colW * 2, false);
  y = Math.min(fromEnd, toEnd, dateEnd) - 18;

  // Line items
  const cols = { desc: M + 10, qty: right - 190, price: right - 100, amount: right - 10 };
  const header = () => {
    page.drawRectangle({ x: M, y: y - 8, width: right - M, height: 24, color: accent });
    text("Description", cols.desc, y, 9, bold, onAccent);
    textRight("Qty", cols.qty, y, 9, bold, onAccent);
    textRight("Price", cols.price, y, 9, bold, onAccent);
    textRight("Amount", cols.amount, y, 9, bold, onAccent);
    y -= 28;
  };
  header();
  for (const it of doc.items) {
    const lines = wrap(it.description || "-", font, 10, cols.qty - cols.desc - 60);
    const h = lines.length * 13 + 10;
    if (y - h < M + 40) {
      page = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M;
      header();
    }
    lines.forEach((l, i) => text(l, cols.desc, y - i * 13, 10));
    const qty = Number.isInteger(it.quantity) ? String(it.quantity) : String(Number(it.quantity.toFixed(2)));
    textRight(qty, cols.qty, y, 10);
    textRight(money(it.unitPence, doc.currency), cols.price, y, 10);
    textRight(money(Math.round(it.quantity * it.unitPence), doc.currency), cols.amount, y, 10);
    y -= (lines.length - 1) * 13 + 9;
    page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.6, color: LINE });
    y -= 17;
  }

  // Totals
  ensure(90);
  y -= 4;
  const tx = right - 200;
  const row = (label: string, value: string) => {
    text(label, tx, y, 10, font, SOFT);
    textRight(value, cols.amount, y, 10);
    y -= 16;
  };
  row("Subtotal", money(doc.subtotal_pence, doc.currency));
  if (Number(doc.vat_percent) > 0) row(`${us ? "Tax" : "VAT"} (${Number(doc.vat_percent)}%)`, money(doc.total_pence - doc.subtotal_pence, doc.currency));
  y -= 10;
  page.drawRectangle({ x: tx - 10, y: y - 10, width: right - tx + 10, height: 28, color: accent });
  text(isQuote ? "Total" : "Total due", tx, y, 12, bold, onAccent);
  textRight(money(doc.total_pence, doc.currency), cols.amount, y, 13, bold, onAccent);
  y -= 40;

  const section = (title: string, body: string[]) => {
    const lines = body.flatMap((b) => wrap(b, font, 9.5, right - M));
    ensure(24 + lines.length * 13);
    text(title.toUpperCase(), M, y, 8, bold, SOFT);
    y -= 14;
    lines.forEach((l) => {
      text(l, M, y, 9.5);
      y -= 13;
    });
    y -= 12;
  };

  if (doc.notes) section("Notes", [doc.notes]);
  const link = docLink(doc, env.appUrl);
  if (isQuote) {
    section("To accept this quote", [`Open ${link} and tap Accept quote, or reply to the text this came with.`]);
  } else if (doc.status === "paid") {
    section("Payment", ["Paid. Thank you!"]);
  } else {
    const pay: string[] = [];
    if (inv.paymentLink) pay.push(`Pay by card: ${inv.paymentLink}`);
    if (inv.accountNumber || inv.sortCode || inv.routingNumber) {
      const bank = [inv.accountName && `Name: ${inv.accountName}`, inv.bankName && `Bank: ${inv.bankName}`, inv.sortCode && `Sort code: ${inv.sortCode}`, inv.routingNumber && `Routing number: ${inv.routingNumber}`, inv.accountNumber && `Account number: ${inv.accountNumber}`].filter(Boolean);
      pay.push(`Bank transfer. ${bank.join("   ")}`);
      pay.push(`Reference: ${docTitle(doc).replace(" #", "-")}`);
    }
    if (!pay.length) pay.push(`View and pay online: ${link}`);
    section("How to pay", pay);
  }

  // Footer on every page
  const pages = pdf.getPages();
  const foot = [brand.name, brand.phone, brand.email, brand.website].filter(Boolean).join("  ·  ");
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 14 }, end: { x: right, y: M + 14 }, thickness: 0.6, color: LINE });
    p.drawText(safe(foot), { x: M, y: M, size: 8, font, color: SOFT });
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: right - font.widthOfTextAtSize(n, 8), y: M, size: 8, font, color: SOFT });
  });

  return pdf.save();
}
