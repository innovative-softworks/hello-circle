# Document 14 — Booking & Transaction Model

One shared Stripe Checkout service backs six transaction types; pricing is always computed server-side.

## Pricing formula (server/src/pricing.ts)

| Component | Rule |
|---|---|
| VAT | 23% (Irish standard rate) on the taxable amount |
| Platform fee | 5% on the taxable amount |
| Taxable amount | `max(0, subtotal − coupon discount)` |
| Deposit (bookings only) | Fixed `DEPOSIT_CENTS`, refundable, **not** taxed or fee'd, skipped for cash bookings |
| Coupons | Percent or fixed, capped at subtotal; active/expiry/max-uses checked against the `coupons` table; a conditional `UPDATE…WHERE used_count < max_uses` closes the race on a single-use code being redeemed twice concurrently |
| Open Booking cost-split | `splitCostPerPerson()` divides total by (open spots + 1), ceiling-rounded; each joiner pays fresh — **not** a refund/credit back to the original booker |

## Checkout (server/src/checkoutService.ts) — 6 transaction types, one service

`createCheckoutSession()`/`pricingLineItems()` is shared by bookings, registrations, games, programs, passes, and experiences — every caller owns its own pending-row insert/cleanup, and only bookings.ts wraps its insert in a row-locked transaction with a deposit line item. For a signed-in resident, `resolveStripeCustomer()` creates or reuses a Stripe Customer (itself row-locked to avoid duplicate customers on concurrent first checkouts) so Stripe's native "save payment method" checkbox works; guests get no Stripe customer, just an email. Mobile checkout redirects to `/mobile-checkout-return` instead of the web success/cancel pages.

## Webhook confirmation (server/src/routes/stripeWebhook.ts)

| Stripe event | Effect |
|---|---|
| `checkout.session.completed` (payment_status=paid) | Confirms the resource — idempotent via `UPDATE…WHERE payment_status='pending'` + zero-rows-changed early return, safe on webhook retry |
| `checkout.session.async_payment_succeeded` | Confirms delayed-settlement methods (e.g. SEPA/Bacs) that were `completed` but not yet `paid` |
| `checkout.session.async_payment_failed` | Marks failed — booking/registration set `payment_status='failed'`; game/pass/program/experience pending rows are **deleted**, not soft-failed |
| `checkout.session.expired` | Same as async_payment_failed |

Confirm functions (`confirmBooking`, `confirmRegistration`, `confirmGameJoin`, `confirmPass`, `confirmProgramEnrollment`, `confirmExperienceBooking`) each also: record coupon use, notify guest+vendor+admins, upgrade any matching favourite's status, claim a waitlist offer if this was one, re-check the min-participants threshold (games), and — uniquely for bookings — call `createGameFromOpenBooking()` to spin off a Game when the booking was made "open." In production, an unverified webhook (missing `STRIPE_WEBHOOK_SECRET`) is refused with 503; dev mode accepts unsigned events with a console warning.

## Refunds — not implemented, by explicit convention

> **No Stripe refund call exists anywhere in this codebase.** Every cancellation route (bookings, registrations, games, vendor-side operations) is comment-documented as "refunds are handled off-platform." Deposits are described to the user as "refundable," but that refund is manual, not automated. This is a real limitation for a platform processing live payments at scale — see [Doc 20](20-gap-analysis.md) for severity.

## Cancellation rules, per transaction type

| Type | Who | Cutoff | Refund |
|---|---|---|---|
| Booking | Owner (client_id/resident), or vendor `centre_manager` | Org-configured `cancellationHours` | Off-platform |
| Registration | Owner, or vendor | None (not date-bound) | Off-platform |
| Game | Host only (ends for everyone) | None | Off-platform, no auto-refund of paid joins |
| Program enrollment | **No one** — no route exists | N/A | N/A |
| Pass | No cancellation path for the purchase itself | N/A | N/A |

---
[← Search & Discovery](13-search-discovery.md) · [Next: Circle & Community Model →](15-circle-community-model.md)
