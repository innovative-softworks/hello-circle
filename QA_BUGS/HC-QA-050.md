# HC-QA-050 — A single-use coupon discounted more than one real payment

Severity: P1. Category: PAYMENT / BOOKING (wrong amount). Status: FIXED LOCALLY — NOT DEPLOYED.
Found in Phase 9 (Stripe TEST mode, isolated QA environment, 2026-10-01). No live keys, no live money.

- **Expected:** A coupon with `max_uses = 1` discounts at most one paid order.
- **Actual (before):** Paid checkouts only *validated* the coupon, and consumption happened at provider success through `recordCouponUse`, which silently logs when exhausted. Two customers each opened a checkout with the same single-use 50% coupon, both paid (Stripe TEST mode), and **both were charged the discounted price**. `used_count` stayed at 1, so the over-use was invisible.
- **Financial invariant:** Wrong amount charged (unauthorised discount); revenue loss bounded by the coupon value.
- **Fix:** Coupon use is reserved atomically (`consumeCoupon`) inside every reservation transaction (halls, clubs, programmes, experiences, activities). It is released exactly once by `endPendingHold()` when a pending hold ends unpaid (provider session creation failed, provider failure, or expiry). The confirm functions no longer consume. The second checkout is refused at creation (400 "fully redeemed").
- **Verification:** Red: `{statuses:"201,201", discountedPayments:2, usedCount:1}`. Green: `{statuses:"201,400", discountedPayments:1, usedCount:1}`. Test: `HC-QA-050-LIVE STRIPE-COUPON-SINGLE-USE` in `stripe-payment.spec.ts`. Expiry hands the use back (`STRIPE-EXPIRY`: used_count 0).
