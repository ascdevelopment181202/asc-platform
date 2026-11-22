import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { localeFor } from "@/lib/phone";
import { suggestReply, type GoogleReview } from "@/lib/google-reviews";
import { fullWhen, loadClient, unreadTotal } from "../../../data";
import { AppShell, Flash, field, primaryBtn } from "../../../ui";
import { postReply } from "../../google-actions";

export const dynamic = "force-dynamic";

export default async function GoogleReviewPage({ params, searchParams }: { params: Promise<{ token: string; id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { token, id } = await params;
  const sp = await searchParams;
  const c = await loadClient(token);
  if (!c) notFound();
  const { data: rv } = await db().from("google_reviews").select("*, contacts(name)").eq("client_id", c.id).eq("id", id).maybeSingle<GoogleReview & { contacts: { name: string | null } | null }>();
  if (!rv) notFound();
  if (!rv.seen_at) await db().from("google_reviews").update({ seen_at: new Date().toISOString() }).eq("id", rv.id);
  const [unread, draft] = await Promise.all([unreadTotal(c.id), rv.reply ? Promise.resolve(rv.reply) : suggestReply(c, rv)]);
  const tz = c.timezone || "Europe/London";

  return (
    <AppShell token={token} active="more" unread={unread} title="Google review">
      <Flash ok={sp.ok} err={sp.err} />
      <div className="space-y-4 p-4">
        <Link href={`/m/${token}/reviews`} className="text-sm text-[#2a78d6]">← Reviews</Link>
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="text-xl text-amber-500">{"★".repeat(rv.rating ?? 0)}<span className="text-neutral-300">{"★".repeat(5 - (rv.rating ?? 0))}</span></p>
          <p className="mt-1 font-semibold">{rv.reviewer_name ?? "A Google user"}</p>
          <p className="text-xs text-neutral-500">{fullWhen(rv.created_at, tz, localeFor(c.country))}</p>
          {rv.comment ? <p className="mt-3 whitespace-pre-line text-base">{rv.comment}</p> : <p className="mt-3 text-sm text-neutral-500">They left a rating without any words.</p>}
          {rv.contact_id && (
            <Link href={`/m/${token}/c/${rv.contact_id}`} className="mt-3 inline-block rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-800">
              Your customer{rv.contacts?.name ? `: ${rv.contacts.name}` : ""} →
            </Link>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold">{rv.reply ? "Your reply on Google" : "Reply on Google"}</h2>
          <p className="mt-0.5 text-sm text-neutral-600">
            {rv.reply ? "Everyone can see this. Change it and post again to update it." : "Replying to every review helps you rank higher. We've written one for you, change anything you like."}
          </p>
          <form action={postReply} className="mt-3 space-y-2">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="id" value={rv.id} />
            <textarea name="reply" rows={6} defaultValue={draft} className={field} />
            <button className={primaryBtn}>{rv.reply ? "Update reply" : "Post reply"}</button>
          </form>
          {(rv.rating ?? 5) <= 3 && <p className="mt-3 text-xs text-neutral-500">Tip: keep it calm and short, and invite them to call. Never mention private details about the job.</p>}
        </section>
      </div>
    </AppShell>
  );
}
