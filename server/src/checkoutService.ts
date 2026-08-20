import type Stripe from "stripe";
import { CLIENT_URL, stripe } from "./stripe.js";

// Shared by bookings.ts/registrations.ts/games.ts/programs.ts/passes.ts —
// each independently hand-rolled the same stripe.checkout.sessions.create
// call (mode, success/cancel URL template, the "not configured" 503, the
// try/catch-then-cleanup-on-failure shape). This factors that duplication
// out; it deliberately does NOT touch the database — every resource has its
// own pending-row shape and, in bookings.ts's case, its own row-locked
// transaction around the insert, so ownership of that insert (and of
// cleanup on failure) stays with the caller.

export type CheckoutType = "booking" | "registration" | "game" | "program" | "pass" | "experience";

export interface CheckoutLineItem {
  name: string;
  description?: string;
  unitAmountCents: number;
}

interface PricingLike {
  taxableCents: number;
  vatCents: number;
  platformFeeCents: number;
  depositCents?: number;
}

/** The subtotal/VAT/platform-fee (and optional deposit) breakdown every
 * checkout path bills identically — only the first line's name/description
 * differs per resource, and only bookings.ts has a deposit line. */
export function pricingLineItems(pricing: PricingLike, subtotal: { name: string; description?: string }): CheckoutLineItem[] {
  const items: CheckoutLineItem[] = [
    { name: subtotal.name, description: subtotal.description, unitAmountCents: pricing.taxableCents },
    { name: "VAT (23%)", unitAmountCents: pricing.vatCents },
    { name: "Platform fee", unitAmountCents: pricing.platformFeeCents },
  ];
  if (pricing.depositCents) {
    items.push({ name: "Refundable deposit", description: "Refunded within 5 days after your event", unitAmountCents: pricing.depositCents });
  }
  return items;
}

export type CheckoutResult = { ok: true; session: Stripe.Checkout.Session } | { ok: false; status: 503 | 400; error: string };

/** Creates the Stripe Checkout session for a `ref` that the caller has
 * already inserted as a `pending` (or `pending_payment`) row. On `{ok:
 * false}` the caller must clean that row up (delete, or mark failed) before
 * returning `res.status(result.status).json({ error: result.error })`. On
 * `{ok: true}` the caller must `UPDATE ... SET stripe_session_id = ?`.
 *
 * Preserves the exact `{ type, ref }` metadata contract stripeWebhook.ts's
 * confirm* functions match on to route a paid session back to the right
 * table/columns — don't change `type`'s literal values, and `ref` must be
 * the same value already written to the row, without updating
 * stripeWebhook.ts in lockstep. */
export async function createCheckoutSession(params: {
  ref: string;
  type: CheckoutType;
  customerEmail: string;
  lineItems: CheckoutLineItem[];
}): Promise<CheckoutResult> {
  if (!stripe) return { ok: false, status: 503, error: "Payments aren't configured yet" };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: params.lineItems.map((li) => ({
        price_data: {
          currency: "eur",
          product_data: { name: li.name, description: li.description },
          unit_amount: li.unitAmountCents,
        },
        quantity: 1,
      })),
      customer_email: params.customerEmail,
      success_url: `${CLIENT_URL}/payment/success?ref=${params.ref}`,
      cancel_url: `${CLIENT_URL}/payment/cancel?ref=${params.ref}`,
      metadata: { type: params.type, ref: params.ref },
    });
    return { ok: true, session };
  } catch (e) {
    console.error(`[stripe] ${params.type} checkout session creation failed:`, e instanceof Error ? e.message : e);
    return { ok: false, status: 400, error: "Couldn't start checkout — please try again" };
  }
}
