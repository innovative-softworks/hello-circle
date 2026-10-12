// Commercial release gates (commercial claims safety audit, 2026-10-11).
// Server-side, fail-closed checks that keep paid commerce shut until it is
// approved — hiding a button in the client is never the only protection.
//
// They don't price anything and change no rule: they only decide whether a
// paid transaction or a Pro purchase may start at all.

/**
 * Paid customer checkout (every Stripe Checkout created by checkoutService):
 *   PAID_CHECKOUT=open    → allowed
 *   PAID_CHECKOUT=closed  → refused
 *   unset                 → refused in production, allowed elsewhere (dev, QA
 *                           and test profiles run NODE_ENV=development/test)
 * Paid bookings are NO-GO for launch (booking-release-readiness, R3B), so a
 * production deploy that forgets the variable fails toward "no paid checkout".
 * Free, cash and €0 orders never reach Stripe and are unaffected.
 */
export function paidCheckoutOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.PAID_CHECKOUT?.trim().toLowerCase();
  if (v === "open") return true;
  if (v === "closed") return false;
  return env.NODE_ENV !== "production";
}

export const PAID_CHECKOUT_CLOSED_ERROR = "Paid bookings aren't open yet — only free bookings are available for now.";

/**
 * The partner fee model behind the Free/Pro plan rules (9% / 7% success fee)
 * is a proposal, not what checkout charges (R3B finding F1, decision D1).
 * Changing this to "approved" is a reviewed code change made together with
 * one formula for checkout, settlement and /pricing — never a runtime toggle.
 */
export const PARTNER_FEE_MODEL_STATUS: "proposed" | "approved" = "proposed";

export function partnerFeeModelApproved(): boolean {
  return PARTNER_FEE_MODEL_STATUS === "approved";
}

/** Switches whose whole value rests on the unapproved fee model: Pro (a lower
 * success fee) and partner reward points (earned on success-fee settlements,
 * redeemed for Pro months). */
export const FEE_MODEL_SWITCHES = ["commerce.pro_subscriptions", "commerce.circle_credits"] as const;

export const FEE_MODEL_NOT_APPROVED_ERROR = "Pro and partner rewards stay off until the partner fee model is approved.";

/** Pro purchase / reward redemption: refused until the model is approved.
 * The isolated test profile (NODE_ENV=test) keeps exercising the built flows. */
export function proPurchaseAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return partnerFeeModelApproved() || env.NODE_ENV === "test";
}
