// Commercial release gate (paid-checkout exposure check, 2026-10-11).
// Server-side and fail-closed: hiding a payment button in the client is never
// the only protection. It prices nothing and changes no rule — it only decides
// whether a paid (card) checkout may start at all.

/**
 * Paid customer checkout (every Stripe Checkout created by checkoutService):
 *   PAID_CHECKOUT=open    → allowed
 *   PAID_CHECKOUT=closed  → refused
 *   unset                 → refused in production, allowed elsewhere
 * Paid bookings are NO-GO for launch, so a production deploy that forgets the
 * variable — or later gains a Stripe key — still fails toward "no paid
 * checkout". Free, cash and €0 orders never reach Stripe and are unaffected,
 * as are refunds, payment-status handling and webhooks for existing payments.
 */
export function paidCheckoutOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.PAID_CHECKOUT?.trim().toLowerCase();
  if (v === "open") return true;
  if (v === "closed") return false;
  return env.NODE_ENV !== "production";
}

export const PAID_CHECKOUT_CLOSED_ERROR = "Paid bookings aren't open yet — only free bookings are available for now.";
