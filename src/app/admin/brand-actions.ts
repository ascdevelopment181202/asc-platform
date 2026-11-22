"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { normalizeHex, uploadLogo } from "@/lib/brand";

// Behind the /admin Basic auth in src/proxy.ts.

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Logo, colour and the business details that go on quotes, invoices and the review page. */
export async function saveBranding(f: FormData) {
  const id = str(f, "clientId");
  const { data: c } = await db().from("clients").select("*").eq("id", id).single<Client>();
  if (!c) throw new Error("Client not found");
  const back = `/admin/clients/${id}`;
  let logoUrl = c.logo_url;
  const logo = f.get("logo");
  if (logo instanceof File && logo.size > 0) {
    try {
      logoUrl = await uploadLogo(id, logo);
    } catch (err) {
      redirect(`${back}?brand_err=${encodeURIComponent(err instanceof Error ? err.message : "Couldn't save the logo.")}#brand`);
    }
  }
  const inv = c.invoice_details ?? {};
  const set = (k: string) => str(f, k) || undefined;
  await db()
    .from("clients")
    .update({
      brand_color: normalizeHex(str(f, "brandColor")),
      logo_url: logoUrl,
      invoice_details: {
        ...inv,
        businessPhone: set("businessPhone"),
        businessEmail: set("businessEmail"),
        website: set("website"),
        businessAddress: set("businessAddress"),
        companyNumber: set("companyNumber"),
        vatNumber: set("vatNumber"),
      },
    })
    .eq("id", id);
  revalidatePath(back);
  redirect(`${back}?brand_ok=1#brand`);
}
