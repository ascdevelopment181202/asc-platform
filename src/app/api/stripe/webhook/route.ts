import type Stripe from "stripe";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { db, type Client } from "@/lib/supabase";
import { activeStatusFor, clientLabel } from "@/lib/clients";
import { notifyAdmin } from "@/lib/email";
import { startOnboarding } from "@/lib/onboarding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, env.stripeWebhookSecret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  // Idempotency: Stripe retries, so record each event id once.
  const { error: dupe } = await db().from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupe?.code === "23505") return Response.json({ received: true, duplicate: true });
  if (dupe) throw dupe;

  try {
    await handle(event);
  } catch (err) {
    // Let Stripe retry: forget the event so the retry is processed.
    await db().from("stripe_events").delete().eq("id", event.id);
    console.error("Stripe webhook failed", event.type, err);
    return new Response("Handler error", { status: 500 });
  }
  return Response.json({ received: true });
}

async function handle(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription" || session.payment_status === "unpaid") return;
      // The live account also takes payments for other work. Only checkouts from the
      // ASC Platform payment link (tagged asc_platform=onboarding) start onboarding.
      if (session.livemode && session.metadata?.asc_platform !== "onboarding") return;
      const email = session.customer_details?.email ?? session.customer_email;
      if (!email) throw new Error(`Checkout ${session.id} has no customer email`);
      const businessField = session.custom_fields?.find((f) => /business/i.test(f.key));
      await startOnboarding({
        email,
        fullName: session.customer_details?.name ?? null,
        phone: session.customer_details?.phone ?? null,
        businessName: session.customer_details?.business_name ?? businessField?.text?.value ?? null,
        stripeCustomerId: idOf(session.customer),
        stripeSubscriptionId: idOf(session.subscription),
      });
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const client = await clientByCustomer(idOf(invoice.customer));
      if (!client || client.status === "cancelled") return;
      await db().from("clients").update({ status: "past_due" }).eq("id", client.id);
      await notifyAdmin(`Payment failed: ${clientLabel(client)}`, [
        `A payment from ${clientLabel(client)} (${client.email}) failed.`,
        `Stripe will retry automatically. Consider pausing work if it's still unpaid in 7 days.`,
      ]);
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const client = await clientByCustomer(idOf(invoice.customer));
      if (!client || client.status !== "past_due") return;
      await db().from("clients").update({ status: activeStatusFor(client) }).eq("id", client.id);
      await notifyAdmin(`Payment recovered: ${clientLabel(client)}`, [`${clientLabel(client)} has paid their overdue invoice.`]);
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const client = await clientByCustomer(idOf(sub.customer));
      if (!client) return;
      await db()
        .from("clients")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", client.id);
      await notifyAdmin(`Client cancelled: ${clientLabel(client)}`, [
        `${clientLabel(client)} (${client.email}) has cancelled their subscription.`,
      ]);
      return;
    }
  }
}

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function clientByCustomer(customerId: string | null) {
  if (!customerId) return null;
  const { data } = await db().from("clients").select("*").eq("stripe_customer_id", customerId).maybeSingle<Client>();
  return data;
}
