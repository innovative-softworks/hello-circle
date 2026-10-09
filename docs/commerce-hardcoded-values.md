# Commerce — hardcoded-value inventory (Phase 0)

Method: repository-wide search of `server/src`, `client/src`, `packages/` for fee/VAT rates, `* 100`
conversions, currency literals, hold/cancel/expiry durations, deposit/price literals, Stripe `price_`/`prod_`
IDs, points/reward constants. Tests, seed data and `reference/` excluded. Commit `544e663`.

Classification key: **TC** technical constant · **ENV** environment configuration · **CC** commercial
configuration (must move to versioned rules) · **LD** legacy duplicate · **?** needs a decision.

## Server

| # | Value | Location | Purpose | Class |
|---|---|---|---|---|
| H1 | `VAT_RATE = 0.23` | `server/src/pricing.ts:5` | VAT added on top of taxable amount | **CC** (and see decision D2: the VAT *model* is legal, not just a rate) |
| H2 | `PLATFORM_FEE_RATE = 0.05` | `pricing.ts:8` | Customer-paid platform fee on top of price | **CC** — conflicts with target €0 customer fee |
| H3 | `Math.round(...)` per component | `pricing.ts:23-24,93` | Rounding rule (half-away-from-zero on positive ints) | TC — must be documented and tested, kept stable for shadow mode |
| H4 | `currency: "eur"` | `checkoutService.ts:149` | Stripe line-item currency | **CC/ENV** — becomes per-order `currency` |
| H5 | `"VAT (23%)"`, `"Platform fee"`, `"Refundable deposit"`, `"Refunded within 5 days after your event"` | `checkoutService.ts:63-67` | Stripe line-item labels; restate rate & deposit promise | **LD** of H1/H8 — must derive from the resolved rule |
| H6 | `PENDING_HOLD_MINUTES = 30` | `bookingIntegrity.ts:14` | Capacity hold + Stripe session `expires_at` | **CC** with a hard floor of 30 and ceiling of 1440 (Stripe Checkout limits) |
| H7 | `INTERVAL ${PENDING_HOLD_MINUTES} MINUTE` | `bookingIntegrity.ts:21,26` | SQL hold predicate | TC (reads H6) |
| H8 | `DEPOSIT_CENTS = 100 * 100` | `routes/bookings.ts:52` | €100 refundable deposit on online venue bookings | **CC** |
| H9 | `duration >= 8 ? rate * 6.5 : rate * duration` | `bookings.ts:48-50` (`hireCost`) | Day-rate discount for venue hire | **CC** (per-venue pricing rule) |
| H10 | `MAX_OPEN_SPOTS = 20` | `bookings.ts:53` | Open Booking spot cap | TC/product limit, not money |
| H11 | `Math.ceil(total / (spots+1))` | `pricing.ts:39-41` | Open Booking per-person share | TC (rounding) — but the *policy* (no booker credit) is **?** |
| H12 | `* 100` on `rooms.rate`, `clubs.price` | `bookings.ts:194`, `registrations.ts:288`, `passes.ts:44` | Whole-euro list prices → cents | **LD** — mixed-unit columns (see risk R11) |
| H13 | `DEFAULT_ORG_POLICIES = { cancellationHours: 48, bookingWindowDays: 90 }` | `db/queries.ts:509` | Fallback cancellation cut-off | **CC** (global default; org override already in `org_policies`) |
| H14 | `cancellation_hours INT DEFAULT 48`, `booking_window_days DEFAULT 90` | `db/index.ts:1001-1005` | Schema default duplicating H13 | **LD** |
| H15 | Programme self-cancel: no cut-off | `selfCancel.ts:29` | Policy by omission | **CC** |
| H16 | Club registration self-cancel: no cut-off | `registrations.ts:447-455` | Policy by omission | **CC** |
| H17 | Coupon percent bound 1–100 | `routes/admin.ts:483` | Admin coupon validation only | TC — absent on vendor/host routes (risk R4) |
| H18 | `club.price * 100 * creditsTotal`, no tiering, no expiry | `passes.ts:44` | Pass price | **CC** |
| H19 | `hc-refund-${session}` | `checkoutService.ts:224` | Refund idempotency key | TC |
| H20 | `mode: "payment"`, `saved_payment_method_options` | `checkoutService.ts:146,164` | Stripe session shape | TC |
| H21 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CLIENT_URL`, `ALLOW_UNSIGNED_STRIPE_WEBHOOKS`, `APP_ENV` | `stripe.ts`, `stripeWebhookPolicy.ts` | Provider config | **ENV** (correct today) |
| H22 | `FEATURE_FLAG_KEYS` + `DEFAULT_FEATURE_FLAGS` (all true) | `db/queries.ts:537-541` | Per-org opt-out flags | TC (key list) |
| H23 | `FIRST_TIMER_MIN = 3` etc. | `games.ts` | Privacy thresholds | TC, not commerce |
| H24 | `lookupLimiter` 10 / 15 min | `rateLimit.ts:51` | Lookup/cancel throttle | ENV/TC — not applied to coupon validate (risk R5) |
| H25 | `"Refunded within 5 days"` promise | `checkoutService.ts:67` | Deposit refund SLA, not implemented | **CC** + risk R7 |

Searched and **not found** in server code: Stripe `price_…`/`prod_…` IDs, subscription prices, reward/points
constants, payout delays, success-fee rates, coupon min-spend/max-discount, refund percentages, category fee rules.
Nothing to migrate there — they are net-new configuration.

## Client (duplicates of server rules)

| # | Value | Location | Class |
|---|---|---|---|
| C1 | `VAT_RATE = 0.23`, `PLATFORM_FEE_RATE = 0.05` | `client/src/api/public.ts:291-292` | **LD** of H1/H2 |
| C2 | `DEPOSIT_EURO = 100` | `client/src/pages/BookingFlow.tsx:49`, also text at `:554`, `CentreDetail.tsx:321` ("+ €100 refundable deposit") | **LD** of H8 |
| C3 | `room.rate * 6.5` day rate | `BookingFlow.tsx:160` | **LD** of H9 |
| C4 | `taxable × VAT_RATE`, `taxable × PLATFORM_FEE_RATE` | `BookingFlow.tsx:163-164`, `RegistrationFlow.tsx:127-128` | **LD** — replace with server quote |
| C5 | `club.price * 10 * (1 + VAT_RATE + PLATFORM_FEE_RATE)` | `ClubDetail.tsx:291,332` | **LD** — also assumes a 10-pack |
| C6 | "VAT (23%)" labels | `BookingFlow.tsx:675`, `RegistrationFlow.tsx:640` | **LD** |
| C7 | "48 hours to claim" waitlist text | `RegistrationFlow.tsx:552`, `VendorClubEditor.tsx:473` | Waitlist policy text, not money — **?** (leave) |

Programmes, Experiences and Games already render the server's quote (`quote.vatCents`, `quote.platformFeeCents`),
so they hold no client-side rate — they are the pattern to copy.

## Summary

- **Commercial values to move to versioned config:** H1, H2, H4, H6, H8, H9, H13, H15, H16, H18, H25 (11).
- **Legacy duplicates to delete once the server quote is authoritative:** H5, H12, H14, C1–C6.
- **Already correctly environment-scoped:** H21.
- **Net-new configuration (no current value):** success fee, payment-cost policy, coupon funding/limits, Circle
  Credits rates/threshold/reward, Pro price, boost pricing, payout timing, category/partner overrides.
