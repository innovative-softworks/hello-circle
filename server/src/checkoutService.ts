import type Stripe from "stripe";
import { logEvent } from "./analytics.js";
import { writeAudit } from "./audit.js";
import { db } from "./db/index.js";
import { CLIENT_URL, stripe } from "./stripe.js";
import { PENDING_HOLD_MINUTES } from "./bookingIntegrity.js";

/** Phase 8 QA seam: a deterministic, network-free provider stand-in so the
 * internal pending → success/failure/expiry state machine can be proven
 * before any real provider exists. Active ONLY when all three hold — the same
 * double guard index.ts uses for its QA seeding exception, plus an explicit
 * per-run opt-in. Never true in development or production. */
export function qaProviderStubEnabled(): boolean {
  return process.env.NODE_ENV === "test" && process.env.QA_E2E_ENABLED === "true" && process.env.QA_PAYMENT_PROVIDER_STUB === "1";
}

/** Whether a paid checkout can be started at all (real provider or QA seam). */
export function paymentsAvailable(): boolean {
  return !!stripe || qaProviderStubEnabled();
}

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
  if (qaProviderStubEnabled()) {
    // QA-only provider seam (see qaProviderStubEnabled) — no network, no Stripe.
    return { ok: true, session: { id: `cs_qa_stub_${params.ref}`, url: null } as unknown as Stripe.Checkout.Session };
  }
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
      // Phase 8 (HC-QA-041) — the provider session lives exactly as long as
      // the capacity hold its pending row represents (bookingIntegrity.ts).
      expires_at: Math.floor(Date.now() / 1000) + PENDING_HOLD_MINUTES * 60,
    });
    void logEvent("booking_started", { residentId: params.residentId ?? null, metadata: { type: params.type, ref: params.ref } });
    return { ok: true, session };
  } catch (e) {
    console.error(`[stripe] ${params.type} checkout session creation failed:`, e instanceof Error ? e.message : e);
    return { ok: false, status: 400, error: "Couldn't start checkout — please try again" };
  }
}

export type StripeRefundResult =
  | { ok: true; amountCents: number; reconciled: boolean }
  | { ok: false; kind: "provider" | "unsupported"; error: string };

/** Shared by every vendor-issued refund route (bookings/registrations in
 * vendorOperations.ts, programs/experiences in vendorPrograms.ts/
 * vendorExperiences.ts — Phase 0 protect) — previously duplicated only in
 * vendorOperations.ts as an unexported local function; factored out here
 * alongside createCheckoutSession rather than duplicated again per resource.
 *
 * HC-QA-091 (Policy A) — refunds originate in HelloCircle, but the provider
 * state is checked first: a charge already FULLY refunded at Stripe (an
 * accidental Dashboard/manual refund) is reconciled (`reconciled: true`)
 * instead of failing forever, and no second refund is ever requested. A
 * partial external refund isn't a supported state, so it is refused
 * (`kind: "unsupported"`) rather than guessed at. */
export async function issueStripeRefund(stripeSessionId: string): Promise<StripeRefundResult> {
  if (!stripe) return { ok: false, kind: "provider", error: "Payments aren't configured on this server" };
  const client = stripe;
  let paymentIntentId: string | null = null;
  const providerState = async () => {
    const pi = await client.paymentIntents.retrieve(paymentIntentId!, { expand: ["latest_charge"] });
    const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
    return { amount: charge?.amount ?? pi.amount_received ?? 0, refunded: charge?.amount_refunded ?? 0 };
  };
  const reconcile = (state: { amount: number; refunded: number }): StripeRefundResult | null => {
    if (state.refunded <= 0) return null;
    if (state.amount > 0 && state.refunded >= state.amount) return { ok: true, amountCents: state.refunded, reconciled: true };
    return { ok: false, kind: "unsupported", error: "This payment was partly refunded outside HelloCircle, so it can't be refunded here. Please contact support to reconcile it." };
  };
  try {
    const session = await client.checkout.sessions.retrieve(stripeSessionId);
    if (!session.payment_intent) return { ok: false, kind: "provider", error: "No payment found for this booking" };
    paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
    const already = reconcile(await providerState());
    if (already) return already;
    // HC-QA-051 — one refund per paid session, even if a retry reaches the
    // provider (e.g. the local commit failed after the provider succeeded).
    const refund = await client.refunds.create(
      { payment_intent: paymentIntentId, metadata: { hc_checkout_session: stripeSessionId } },
      { idempotencyKey: `hc-refund-${stripeSessionId}` }
    );
    return { ok: true, amountCents: refund.amount ?? session.amount_total ?? 0, reconciled: false };
  } catch (e) {
    // Race: refunded at Stripe between the state check and our request.
    if (paymentIntentId && (e as { code?: string })?.code === "charge_already_refunded") {
      try {
        const late = reconcile(await providerState());
        if (late) return late;
      } catch { /* fall through to the generic provider failure */ }
    }
    console.error("[stripe] refund failed:", e instanceof Error ? e.message : e);
    return { ok: false, kind: "provider", error: "The refund couldn't be completed — please try again" };
  }
}

type RefundTable = "bookings" | "registrations" | "program_enrollments" | "experience_bookings" | "game_participants";

/** Who/what a refund attempt is about — used for the operational audit row
 * when a provider state can't be reconciled safely (HC-QA-091). */
export interface RefundAuditContext { actorUserId: string | null; objectType: string; objectId: string }

/** HC-QA-051 — refund a paid row exactly once. The row is locked and re-checked
 * before the provider is called and marked refunded in the same transaction,
 * so concurrent requests serialize: one refunds, the rest see 'refunded' (409)
 * instead of each calling the provider. A provider failure rolls back (stays paid).
 * HC-QA-091 — the same single transition covers reconciling a payment already
 * refunded at Stripe (`reconciled: true`; callers audit it distinctly). */
export async function refundPaidOnce(table: RefundTable, where: string, params: unknown[], stripeSessionId: string, alreadyMessage: string, audit?: RefundAuditContext):
  Promise<{ ok: true; amountCents: number; reconciled: boolean } | { ok: false; status: number; error: string }> {
  class ProviderRefundError extends Error {
    constructor(message: string, readonly unsupported: boolean) { super(message); }
  }
  try {
    return await db.transaction(async (tx) => {
      const row = (await tx.prepare(`SELECT payment_status FROM ${table} WHERE ${where} FOR UPDATE`).get(...params)) as { payment_status: string } | undefined;
      if (!row) return { ok: false as const, status: 404, error: "Not found" };
      if (row.payment_status === "refunded") return { ok: false as const, status: 409, error: alreadyMessage };
      if (row.payment_status !== "paid") return { ok: false as const, status: 400, error: "Only a paid booking can be refunded" };
      const result = await issueStripeRefund(stripeSessionId);
      if (!result.ok) throw new ProviderRefundError(result.error, result.kind === "unsupported");
      await tx.prepare(`UPDATE ${table} SET payment_status = 'refunded' WHERE ${where} AND payment_status = 'paid'`).run(...params);
      return { ok: true as const, amountCents: result.amountCents, reconciled: result.reconciled };
    });
  } catch (e) {
    if (e instanceof ProviderRefundError && e.unsupported) {
      // Operational error: never guess which part of a partial refund maps to
      // which local state — leave the row untouched and make it visible.
      console.error(`[payments] RECONCILIATION REQUIRED: ${table} ${audit?.objectId ?? "(unknown)"} was partly refunded outside HelloCircle`);
      if (audit) {
        await writeAudit({ ...audit, action: "payment.refund_reconciliation_blocked", newValue: { table, reason: "partial_external_refund" } });
      }
      return { ok: false, status: 409, error: e.message };
    }
    if (e instanceof ProviderRefundError) return { ok: false, status: 502, error: e.message };
    throw e;
  }
}
