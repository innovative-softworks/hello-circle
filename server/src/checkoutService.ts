import type Stripe from "stripe";
import { db } from "./db/index.js";
import { CLIENT_URL, stripe } from "./stripe.js";

// Shared by bookings.ts/registrations.ts/games.ts/programs.ts/passes.ts —
// each independently hand-rolled the same stripe.checkout.sessions.create
// call (mode, success/cancel URL template, the "not configured" 503, the
// try/catch-then-cleanup-on-failure shape). This factors that duplication
// out; it deliberately does NOT touch the database — every resource has its
// own pending-row shape and, in bookings.ts's case, its own row-locked
// transaction around the insert, so ownership of that insert (and of
// cleanup on failure) stays with the caller.
//
// Architectural decision record (onboarding audit F-7): every Checkout
// session here is created against the platform's own single STRIPE_SECRET_KEY
// — there is no Stripe Connect (or any other) vendor payout integration
// anywhere in this codebase. A vendor's `payment_method` field on a room/
// club/centre only chooses 'online' vs 'cash' at the venue; it is not a
// payout-readiness gate, because no such gate exists. This is a v1 model,
// not an oversight: the platform is the sole merchant of record, and vendor
// settlement is manual/off-platform. Don't assume a "connect your bank
// account" vendor onboarding step exists anywhere — it doesn't.

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

/** Payment-methods screen (implementation backlog #1) — resolves the Stripe
 * Customer behind a signed-in resident, creating one on first checkout if
 * they don't have one yet. Centralized here (not per-caller) so every
 * checkout path gets saved-card support automatically just by passing
 * `residentId` through — no per-resource Stripe logic needed. Returns null
 * for a guest checkout (no residentId) or when Stripe isn't configured;
 * both are treated as "just don't attach a customer," never a hard error —
 * saved cards are additive, not a checkout requirement. */
async function resolveStripeCustomer(residentId: string | null, email: string): Promise<string | null> {
  if (!stripe || !residentId) return null;
  try {
    // FOR UPDATE (same row-locking pattern bookings.ts uses) so two
    // concurrent first-time checkouts by the same resident can't both read
    // "no customer yet," both create one, and both write — the loser's
    // customer would otherwise be silently orphaned (never referenced again).
    // Held across the Stripe API call deliberately: this only serializes
    // concurrent requests for the same resident's very first checkout, a
    // rare, one-time code path.
    return await db.transaction(async (tx) => {
      const row = (await tx.prepare(`SELECT stripe_customer_id as stripeCustomerId FROM residents WHERE id = ? FOR UPDATE`).get(residentId)) as
        | { stripeCustomerId: string | null }
        | undefined;
      if (row?.stripeCustomerId) return row.stripeCustomerId;
      const customer = await stripe!.customers.create({ email });
      await tx.prepare(`UPDATE residents SET stripe_customer_id = ? WHERE id = ?`).run(customer.id, residentId);
      return customer.id;
    });
  } catch (e) {
    console.error("[stripe] customer creation failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

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
  /** Payment-methods screen (implementation backlog #1) — pass the signed-
   * in resident's id (null/omitted for a guest checkout) to attach a
   * Stripe Customer and offer Checkout's own "save my payment details"
   * checkbox. Never required — every existing guest-checkout call site
   * keeps working unchanged without passing this. */
  residentId?: string | null;
  /** Mobile checkout hand-off (Phase 3) — set when the request originated
   * from the Expo app (X-Client-Platform: mobile). Routes Stripe's redirect
   * through /mobile-checkout-return (server/src/index.ts) instead of the
   * web's /payment/success or /payment/cancel pages, which a native app has
   * no way to render/receive — same isNative pattern already used in
   * guestAuth.ts for the resident magic-link flow. */
  isNative?: boolean;
}): Promise<CheckoutResult> {
  if (!stripe) return { ok: false, status: 503, error: "Payments aren't configured yet" };

  try {
    const customerId = await resolveStripeCustomer(params.residentId ?? null, params.customerEmail);
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
      // Checkout requires exactly one of customer / customer_email — a
      // Customer already carries its own email, passing customer_email too
      // would 400.
      ...(customerId ? { customer: customerId } : { customer_email: params.customerEmail }),
      // Stripe Checkout's built-in "Save my payment details for future
      // purchases" checkbox — only meaningful with a customer attached; a
      // future checkout for the same resident (customer) then shows this
      // card as a one-click option automatically, no separate SetupIntent
      // flow needed.
      ...(customerId ? { saved_payment_method_options: { payment_method_save: "enabled" as const } } : {}),
      success_url: params.isNative
        ? `${CLIENT_URL}/mobile-checkout-return?status=success&ref=${params.ref}&type=${params.type}`
        : `${CLIENT_URL}/payment/success?ref=${params.ref}`,
      cancel_url: params.isNative
        ? `${CLIENT_URL}/mobile-checkout-return?status=cancel&ref=${params.ref}&type=${params.type}`
        : `${CLIENT_URL}/payment/cancel?ref=${params.ref}`,
      metadata: { type: params.type, ref: params.ref },
    });
    return { ok: true, session };
  } catch (e) {
    console.error(`[stripe] ${params.type} checkout session creation failed:`, e instanceof Error ? e.message : e);
    return { ok: false, status: 400, error: "Couldn't start checkout — please try again" };
  }
}

/** Shared by every vendor-issued refund route (bookings/registrations in
 * vendorOperations.ts, programs/experiences in vendorPrograms.ts/
 * vendorExperiences.ts — Phase 0 protect) — previously duplicated only in
 * vendorOperations.ts as an unexported local function; factored out here
 * alongside createCheckoutSession rather than duplicated again per resource. */
export async function issueStripeRefund(stripeSessionId: string): Promise<{ ok: true; amountCents: number } | { ok: false; error: string }> {
  if (!stripe) return { ok: false, error: "Payments aren't configured on this server" };
  const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
  if (!session.payment_intent) return { ok: false, error: "No payment found for this booking" };
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
  return { ok: true, amountCents: refund.amount ?? session.amount_total ?? 0 };
}
