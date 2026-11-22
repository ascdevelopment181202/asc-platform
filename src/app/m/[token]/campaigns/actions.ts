"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { audienceFrom, buildAudience, campaignAllowance, campaignBlocker, MAX_RECIPIENTS, queueCampaign } from "@/lib/campaigns";
import { clientFromForm } from "../data";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function sendCampaign(f: FormData) {
  const c = await clientFromForm(f);
  const base = `/m/${c.dashboard_token}/campaigns`;
  const a = audienceFrom({ who: str(f, "who"), months: str(f, "months"), tag: str(f, "tag") });
  const qs = new URLSearchParams({ who: a.who, months: String(a.months), tag: a.tag });
  const fail = (msg: string): never => redirect(`${base}/new?${qs}&err=${encodeURIComponent(msg)}`);

  const body = str(f, "body").slice(0, 600);
  if (body.length < 20) fail("Write your message first.");
  if (f.get("confirm") !== "on") fail("Tick the box to confirm you're happy to send it.");
  const blocked = await campaignBlocker(c);
  if (blocked) fail(blocked);

  const { recipients } = await buildAudience(c, a);
  if (!recipients.length) fail("Nobody to send to with those choices.");
  if (recipients.length > MAX_RECIPIENTS) fail(`That's ${recipients.length} people. Narrow it down to ${MAX_RECIPIENTS} or fewer, or ask ASC to send it for you.`);
  const allowance = await campaignAllowance(c);
  if (recipients.length > allowance.left) {
    fail(
      allowance.left
        ? `You've got ${allowance.left} campaign texts left this month (${allowance.limit} included). Narrow it down, or ask ASC for more.`
        : `You've used this month's ${allowance.limit} campaign texts. Ask ASC to add more, or send it next month.`,
    );
  }

  if (f.get("save") === "on") {
    await db().from("campaign_templates").insert({ client_id: c.id, name: (str(f, "name") || body.slice(0, 40)).slice(0, 60), body });
  }
  await queueCampaign(c, (str(f, "name") || "Campaign").slice(0, 80), body, a, recipients);
  revalidatePath(base);
  redirect(`${base}?ok=${encodeURIComponent(`Sending to ${recipients.length} customer${recipients.length === 1 ? "" : "s"}, about 100 an hour between 9am and 7pm. Replies land in your inbox.`)}`);
}

export async function deleteTemplate(f: FormData) {
  const c = await clientFromForm(f);
  await db().from("campaign_templates").delete().eq("client_id", c.id).eq("id", str(f, "id"));
  redirect(`/m/${c.dashboard_token}/campaigns/new`);
}

/** Stops whatever hasn't gone out yet. */
export async function stopCampaign(f: FormData) {
  const c = await clientFromForm(f);
  await db().from("outbox").update({ cancelled_at: new Date().toISOString() }).eq("client_id", c.id).eq("campaign_id", str(f, "id")).is("sent_at", null).is("cancelled_at", null);
  redirect(`/m/${c.dashboard_token}/campaigns?ok=${encodeURIComponent("Stopped. Nothing else will go out.")}`);
}
