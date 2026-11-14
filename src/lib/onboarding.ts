import "server-only";
import { env } from "./env";
import { db, type Client } from "./supabase";
import { clientLabel, once } from "./clients";
import { notifyAdmin, sendEmail, welcomeEmail } from "./email";

export function formLink(c: Pick<Client, "onboarding_token">) {
  return `${env.appUrl}/onboarding/${c.onboarding_token}`;
}

export function firstNameOf(c: Pick<Client, "first_name" | "full_name">) {
  return c.first_name || c.full_name?.split(" ")[0] || "there";
}

type NewClient = {
  email: string;
  fullName?: string | null;
  phone?: string | null;
  businessName?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

/**
 * Creates (or finds) the client for a payment, then sends the welcome email and
 * notifies Ayush. Safe to call more than once for the same customer.
 */
export async function startOnboarding(input: NewClient): Promise<Client> {
  const supabase = db();
  let existing: Client | null = null;

  if (input.stripeCustomerId) {
    const { data } = await supabase
      .from("clients")
      .select("*")
      .eq("stripe_customer_id", input.stripeCustomerId)
      .maybeSingle<Client>();
    existing = data;
  }

  let client: Client;
  if (existing) {
    client = existing;
  } else {
    const { data, error } = await supabase
      .from("clients")
      .insert({
        email: input.email,
        full_name: input.fullName ?? null,
        first_name: input.fullName?.split(" ")[0] ?? null,
        phone: input.phone ?? null,
        business_name: input.businessName ?? null,
        stripe_customer_id: input.stripeCustomerId ?? null,
        stripe_subscription_id: input.stripeSubscriptionId ?? null,
      })
      .select("*")
      .single<Client>();
    if (error) throw error;
    client = data;
  }

  await once(client.id, "welcome_email", async () => {
    const mail = welcomeEmail({ firstName: firstNameOf(client), formLink: formLink(client) });
    await sendEmail({ to: client.email, ...mail });
  });

  await once(client.id, "admin_new_client", () =>
    notifyAdmin(`New client paid: ${clientLabel(client)}`, [
      `${clientLabel(client)} just paid.`,
      `Email: ${client.email}`,
      `Phone: ${client.phone ?? "not given"}`,
      `Onboarding form: ${formLink(client)}`,
      `Dashboard: ${env.appUrl}/admin`,
    ]),
  );

  return client;
}
