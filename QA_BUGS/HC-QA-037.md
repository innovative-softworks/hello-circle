# HC-QA-037 — Single-use coupons can be redeemed repeatedly on cash or fully-discounted orders

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

`consumeCoupon()` (`bookingIntegrity.ts`) runs an atomic `UPDATE … used_count+1 WHERE used_count < max_uses` inside the order's transaction for every order confirmed without a provider (cash, free, fully discounted, experiences confirmed immediately). Paid orders consume once at provider success; `confirmExperienceBooking` now records coupon use too. Verified: sequential reuse → 400; 6 concurrent redemptions → exactly 1 use; provider-success replay → still 1.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-037'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P2. Category: BOOKING (pricing).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-037'`. It must turn green after a fix without changing the assertion.

## Journey
Coupons (Part 11)

## Expected
A coupon with `max_uses = 1` can be used once, whichever payment path completes the order.

## Actual
A 25% single-use coupon on two cash hall bookings → 201, 201. A 100% single-use coupon on two online-club registrations, which become free and confirm internally → 201, 201. `used_count` stays **0** for both.

## Likely source
`server/src/pricing.ts` `recordCouponUse()` is called only from `stripeWebhook.ts` confirm functions. The cash, free, trial and immediate-confirm paths in bookings, registrations, programs and experiences never record it.

## Proposed minimum fix (not applied)
Record coupon use (atomically against `max_uses`) whenever an order using it is confirmed without Stripe. Treat a lost race as a rejection.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
