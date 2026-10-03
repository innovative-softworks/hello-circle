# HC-QA-051 — Concurrent vendor refunds each called the provider; losers crashed with 500

Severity: P2. Category: REFUND. Status: FIXED LOCALLY — NOT DEPLOYED.
Found in Phase 9 (Stripe TEST mode, isolated QA environment, 2026-10-01). No live keys, no live money.

- **Expected:** N simultaneous refund requests give exactly one provider refund, one transition, one audit row and notification set, and clean 409s for the rest.
- **Actual (before):** Every refund route (`bookings`, `registrations`, `programmes`, `experiences`, `activities`) called `stripe.refunds.create` **before** its `payment_status='paid'` guard, with no idempotency key. Four concurrent requests returned `200,500,500,500`. Money was safe only because Stripe itself refuses to fully refund the same charge twice.
- **Financial invariant:** Double-refund protection depended entirely on provider behaviour; unhandled errors.
- **Fix:** `refundPaidOnce()` in `checkoutService.ts` locks the row, re-checks status, refunds with idempotency key `hc-refund-<session>`, and marks refunded in one transaction. Provider errors are caught (502, row stays paid). Applied to all five routes.
- **Verification:** Red: `200,500,500,500` (1 provider refund). Green: `200,409,409,409`, 1 provider refund, 1 audit. Test: `STRIPE-REFUND-CONCURRENT` in `stripe-refund.spec.ts`.
