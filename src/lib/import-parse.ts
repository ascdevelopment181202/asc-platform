// Turns a CSV (from job software, Excel, Google Contacts) or a vCard file (exported from a phone) into rows.
// Runs in the browser so the owner sees a preview before anything is saved.

export type ImportRow = { name: string; phone: string; email: string; address: string };

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Splits into lines, keeping line breaks that sit inside quotes. */
function csvLines(text: string): string[] {
  const lines: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of text.replace(/\r\n?/g, "\n")) {
    if (ch === '"') q = !q;
    if (ch === "\n" && !q) lines.push(cur), (cur = "");
    else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.filter((l) => l.trim());
}

const looksLikePhone = (s: string) => s.replace(/\D/g, "").length >= 9 && /^[\d\s()+.\-]+$/.test(s.trim());

function parseCsv(text: string): ImportRow[] {
  const lines = csvLines(text);
  if (!lines.length) return [];
  const sep = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim());
  const find = (...keys: RegExp[]) => head.findIndex((h) => keys.some((k) => k.test(h)));
  const hasHeader = head.some((h) => /name|phone|mobile|cell|email|tel/.test(h));

  if (!hasHeader) {
    // No headings: take the first phone-looking cell and the first text cell as the name.
    return lines.map((l) => {
      const cells = splitCsvLine(l, sep);
      const phone = cells.find(looksLikePhone) ?? "";
      const email = cells.find((x) => x.includes("@")) ?? "";
      const name = cells.find((x) => x && x !== phone && x !== email && !looksLikePhone(x)) ?? "";
      return { name, phone, email, address: "" };
    });
  }

  const iFull = find(/^(full )?name$/, /^display name$/, /^customer( name)?$/, /^client( name)?$/, /^contact( name)?$/);
  const iFirst = find(/^first( name)?$/, /^given name$/, /^forename$/);
  const iLast = find(/^last( name)?$/, /^family name$/, /^surname$/);
  // Prefer mobile/cell columns over landlines.
  const phoneCols = head.map((h, i) => ({ h, i })).filter(({ h }) => /phone|mobile|cell|tel|number/.test(h));
  phoneCols.sort((a, b) => Number(/mobile|cell/.test(b.h)) - Number(/mobile|cell/.test(a.h)));
  const iEmail = find(/e ?mail/);
  const addrCols = head.map((h, i) => ({ h, i })).filter(({ h }) => /address|street|town|city|postcode|post code|zip|state|county/.test(h) && !/e ?mail/.test(h));

  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l, sep);
    const at = (i: number) => (i >= 0 ? (cells[i] ?? "") : "");
    const name = at(iFull) || [at(iFirst), at(iLast)].filter(Boolean).join(" ");
    const phone = phoneCols.map(({ i }) => at(i)).find((v) => v.replace(/\D/g, "").length >= 9) ?? "";
    const address = addrCols.map(({ i }) => at(i)).filter(Boolean).join(", ");
    return { name, phone, email: at(iEmail), address };
  });
}

function parseVcf(text: string): ImportRow[] {
  const unfolded = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
  return unfolded
    .split(/BEGIN:VCARD/i)
    .slice(1)
    .map((card) => {
      const lines = card.split("\n");
      const val = (re: RegExp) => lines.filter((l) => re.test(l)).map((l) => l.slice(l.indexOf(":") + 1).trim());
      const fn = val(/^(item\d+\.)?FN[;:]/i)[0] ?? "";
      const n = (val(/^(item\d+\.)?N[;:]/i)[0] ?? "").split(";");
      const name = fn || [n[1], n[0]].filter(Boolean).join(" ");
      const tels = lines.filter((l) => /^(item\d+\.)?TEL[;:]/i.test(l));
      const mobile = tels.find((l) => /CELL|MOBILE|IPHONE/i.test(l.slice(0, l.indexOf(":")))) ?? tels[0] ?? "";
      const adr = (val(/^(item\d+\.)?ADR[;:]/i)[0] ?? "").split(";").map((s) => s.trim()).filter(Boolean).join(", ");
      return { name: name.replace(/\\,/g, ","), phone: mobile.slice(mobile.indexOf(":") + 1).replace(/^tel:/i, "").trim(), email: val(/^(item\d+\.)?EMAIL[;:]/i)[0] ?? "", address: adr.replace(/\\n/g, ", ") };
    });
}

export function parseImport(text: string, fileName = ""): ImportRow[] {
  const rows = /BEGIN:VCARD/i.test(text) || /\.vcf$/i.test(fileName) ? parseVcf(text) : parseCsv(text);
  return rows.filter((r) => r.phone).slice(0, 2000);
}
