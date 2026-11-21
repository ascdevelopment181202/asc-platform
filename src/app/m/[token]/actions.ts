"use server";

import { redirect } from "next/navigation";
import { db, type Client } from "@/lib/supabase";
import { BULK_PER_DAY, createJob, parseCustomerList } from "@/lib/sms";

// These run from the client's private dashboard link. The token is the only key, same as /r/[token].

async function clientFor(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!/^[0-9a-f]{32}$/.test(token)) throw new Error("Invalid link");
  const { data } = await db().from("clients").select("*").eq("dashboard_token", token).maybeSingle<Client>();
  if (!data) throw new Error("Invalid link");
  return data;
}

const back = (token: string, type: "ok" | "err", msg: string): never =>
  redirect(`/m/${token}?${type}=${encodeURIComponent(msg)}#top`);

export async function jobDone(formData: FormData) {
  const c = await clientFor(formData);
  const result = await createJob(c, {
    phone: String(formData.get("phone") ?? ""),
    name: String(formData.get("name") ?? "").trim() || null,
    source: "dashboard",
  });
  if (!result.ok) back(c.dashboard_token, "err", result.error);
  else back(c.dashboard_token, "ok", `Done. ${result.contact.name ?? "Your customer"} will get a review request in about 2 hours.`);
}

/** One review text per past customer, spread over a few days so it doesn't land as a burst. */
export async function bulkUpload(formData: FormData) {
  const c = await clientFor(formData);
  let text = String(formData.get("list") ?? "");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) back(c.dashboard_token, "err", "That file is too big. Keep it under 2MB.");
    text += `\n${await file.text()}`;
  }
  const rows = parseCustomerList(text);
  if (!rows.length) back(c.dashboard_token, "err", "Couldn't find any UK mobile numbers in that list.");
  if (rows.length > 500) back(c.dashboard_token, "err", "That's over 500 numbers. Send ASC the list and we'll load it for you.");

  let added = 0;
  const reasons = new Map<string, number>();
  const start = Date.now() + 10 * 60_000;
  for (const row of rows) {
    const startAt = new Date(start + Math.floor(added / BULK_PER_DAY) * 86400_000);
    const result = await createJob(c, { phone: row.phone, name: row.name, source: "bulk", startAt });
    if (result.ok) added++;
    else reasons.set(result.error, (reasons.get(result.error) ?? 0) + 1);
  }
  const days = Math.max(1, Math.ceil(added / BULK_PER_DAY));
  const skippedNote = [...reasons.entries()].map(([why, n]) => `${n} skipped (${why.replace(/\.$/, "").toLowerCase()})`).join(", ");
  if (!added) back(c.dashboard_token, "err", `Nothing added. ${skippedNote}.`);
  back(
    c.dashboard_token,
    "ok",
    `Added ${added} customer${added === 1 ? "" : "s"}. They'll each get one review request${days > 1 ? ` over the next ${days} days` : " today"}, between 9am and 7pm.${skippedNote ? ` ${skippedNote}.` : ""}`,
  );
}
