import Stripe from "stripe";
import { stripeWebhookModeNotice } from "./stripeWebhookPolicy.js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
export const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

export const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

if (!stripe) {
  console.log("[stripe] STRIPE_SECRET_KEY not set (server/.env) — checkout will return 503 until it's configured");
}

// Phase 12 — say clearly at startup how webhooks will be treated (no secrets printed).
const webhookNotice = stripe ? stripeWebhookModeNotice() : null;
if (webhookNotice) console.warn(webhookNotice);
