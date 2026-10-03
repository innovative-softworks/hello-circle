# HC-QA-049 — Paid activity confirmation stated the list price, not the amount charged

Severity: P2. Category: PAYMENT / UX (receipt). Status: FIXED LOCALLY — NOT DEPLOYED.
Found in Phase 9 (Stripe TEST mode, isolated QA environment, 2026-10-01). No live keys, no live money.

- **Expected:** The payer's in-app confirmation and email state the amount actually charged.
- **Actual (before):** The confirmation used `games.price_cents`: it said "€8.00 paid" while Stripe charged €9.22 (VAT 23% + fee 5% − 10% coupon). Activity joins also stored no local amount, so the charge couldn't be reconciled against the database.
- **Financial invariant:** Receipt amount ≠ charged amount; reconciliation gap.
- **Fix:** New nullable `game_participants.total_cents` (idempotent `ensureColumn`), written with the provider session id from the same `computePricing` result that built the Checkout line items. `confirmGameJoin` reports it.
- **Verification:** Red: charged €9.22, notification "€8.00 paid". Green: "€9.22 paid". Test: `HC-QA-049` in `stripe-findings.spec.ts`. The amount-integrity spec now also checks activity database total = Stripe.
