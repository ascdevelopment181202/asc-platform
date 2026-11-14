"use server";

import { createEnquiry } from "@/lib/enquiries";

export type EnquiryState = { ok: boolean; error?: string };

export async function submitEnquiry(siteId: string, _prev: EnquiryState, formData: FormData): Promise<EnquiryState> {
  const get = (k: string) => String(formData.get(k) ?? "");
  return createEnquiry({
    siteId,
    name: get("name"),
    phone: get("phone"),
    email: get("email"),
    postcode: get("postcode"),
    service: get("service"),
    message: get("message"),
    company: get("company"),
    path: get("path"),
  });
}
