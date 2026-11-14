import "server-only";
import Stripe from "stripe";
import { env } from "./env";

let stripe: Stripe | null = null;
export function getStripe() {
  if (!stripe) stripe = new Stripe(env.stripeSecretKey);
  return stripe;
}
