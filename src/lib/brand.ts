import "server-only";
import { db, type Client } from "@/lib/supabase";
import { SITE_ASSETS_BUCKET } from "@/lib/sites";
import { clientLabel } from "@/lib/clients";
import { displayPhone } from "@/lib/phone";

export const DEFAULT_BRAND = "#2a78d6";
export const MAX_LOGO_MB = 3;

const HEX = /^#[0-9a-f]{6}$/i;

/** "#f2b705" / "F2B705" / "#fb0" -> "#F2B705", or null if it isn't a colour. */
export function normalizeHex(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().replace(/^#?/, "#");
  if (/^#[0-9a-f]{3}$/i.test(s)) s = `#${[...s.slice(1)].map((ch) => ch + ch).join("")}`;
  return HEX.test(s) ? s.toUpperCase() : null;
}

/** Black or white text, whichever reads better on the colour. */
export function textOn(hex: string): "#111111" | "#FFFFFF" {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#FFFFFF";
}

export type Brand = {
  name: string;
  color: string;
  onColor: string;
  logo: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  vatNumber: string | null;
  companyNumber: string | null;
};

/** Everything a branded page or PDF needs about the business, with sensible fallbacks. */
export function brandOf(c: Client): Brand {
  const inv = c.invoice_details ?? {};
  const color = normalizeHex(c.brand_color) ?? DEFAULT_BRAND;
  return {
    name: clientLabel(c),
    color,
    onColor: textOn(color),
    logo: c.logo_url || null,
    // Not their ASC number: calls to that go to the missed-call text, not to a person.
    phone: inv.businessPhone || (c.owner_mobile ? displayPhone(c.owner_mobile) : null),
    email: inv.businessEmail || null,
    website: inv.website || null,
    address: inv.businessAddress || null,
    vatNumber: inv.vatNumber || null,
    companyNumber: inv.companyNumber || null,
  };
}

/** Saves a logo to the public bucket and returns its URL. PNG or JPG only, so it can go on PDFs. */
export async function uploadLogo(clientId: string, file: File): Promise<string> {
  const ext = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : null;
  if (!ext) throw new Error("The logo needs to be a PNG or JPG.");
  if (file.size > MAX_LOGO_MB * 1024 * 1024) throw new Error(`The logo needs to be under ${MAX_LOGO_MB} MB.`);
  const path = `brand/${clientId}/logo-${Date.now()}.${ext}`;
  const { error } = await db()
    .storage.from(SITE_ASSETS_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`Couldn't save the logo: ${error.message}`);
  return db().storage.from(SITE_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Copies an onboarding-form logo (private bucket) to the public one, if it's a PNG or JPG. */
export async function logoFromOnboarding(clientId: string, privatePath: string, bucket: string): Promise<string | null> {
  if (!/\.(png|jpe?g)$/i.test(privatePath)) return null;
  const { data: file } = await db().storage.from(bucket).download(privatePath);
  if (!file) return null;
  const type = /\.png$/i.test(privatePath) ? "image/png" : "image/jpeg";
  try {
    return await uploadLogo(clientId, new File([file], privatePath.split("/").pop()!, { type }));
  } catch {
    return null;
  }
}
