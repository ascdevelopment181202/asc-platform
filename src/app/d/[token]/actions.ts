"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { db, type Client } from "@/lib/supabase";
import { docTitle, money, type Doc } from "@/lib/crm";
import { bumpConversation } from "@/lib/sms";
import { notifyClient } from "@/lib/push";

/** Customer taps "Accept quote" on the public page. */
export async function acceptQuote(f: FormData) {
  const token = String(f.get("token") ?? "");
  if (!/^[0-9a-f]{24}$/.test(token)) throw new Error("Invalid link");
  const { data: doc } = await db().from("documents").select("*").eq("public_token", token).maybeSingle<Doc>();
  if (!doc || doc.kind !== "quote") throw new Error("Not found");
  if (doc.status === "sent") {
    await db().from("documents").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", doc.id);
    const { data: c } = await db().from("clients").select("id, dashboard_token").eq("id", doc.client_id).single<Pick<Client, "id" | "dashboard_token">>();
    const { data: contact } = await db().from("contacts").select("name").eq("id", doc.contact_id).maybeSingle<{ name: string | null }>();
    await bumpConversation(doc.contact_id, `Accepted ${docTitle(doc)} (${money(doc.total_pence, doc.currency)})`, "inbound", true);
    if (c) {
      after(() =>
        notifyClient(c.id, {
          title: "Quote accepted ✅",
          body: `${contact?.name ?? "Your customer"} accepted ${docTitle(doc)} for ${money(doc.total_pence, doc.currency)}.`,
          url: `/m/${c.dashboard_token}/docs/${doc.id}`,
        }),
      );
    }
  }
  redirect(`/d/${token}?accepted=1`);
}
