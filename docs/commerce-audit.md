# HelloCircle Commerce Engine — Phase 0 audit (Audit Gate)

- **Branch / commit:** `staging` @ `544e663`, clean working tree, in sync with `origin/staging`.
- **Date:** 2026-10-09.
- **Scope:** read-only. No feature code was written. No database (dev, prod or test) was touched. No Stripe call
  was made, no email was sent, nothing was deployed or pushed.
- **Repository instructions:** `CLAUDE.md` was read. There is no `AGENTS.md` in the repo.

Companion documents:
- [`commerce-current-state-map.md`](commerce-current-state-map.md): every paid flow traced from UI to database.
- [`commerce-hardcoded-values.md`](commerce-hardcoded-values.md): 25 server and 7 client values, classified.
- [`commerce-risk-register.md`](commerce-risk-register.md): 27 risks, plus the areas that must stay untouched.
- [`commerce-implementation-plan.md`](commerce-implementation-plan.md): the proposed phases.

## 1. Executive summary

The payment plumbing is in better shape than the commercial model. Checkout runs through one module, coupon use
is reserved inside the hold transaction, webhooks fail safe and settle idempotently under row locks, late
payments are handled, and refunds happen exactly once. All of that is reusable as-is.

What doesn't exist is everything *commercial* above the plumbing:

- no configuration (the two rates are literals, on both server and client)
- no record of what any partner is owed
- no partial refunds
- no chargeback handling
- no coupon funding
- no fulfilment state
- no subscriptions or credits

The current fee model is also the **inverse** of the target. Today the customer pays a 5% fee plus 23% VAT on top
and the vendor keeps the list price. The target is a €0 customer fee with a 7% success fee taken from the partner.

## 2. Material findings

1. **The fee model conflicts with the target** (R1). Moving to "one transparent price, €0 customer fee" changes
   every checkout total and how VAT is presented. That is a business and tax decision, not something to fix in
   code.
2. **The platform is the sole merchant of record, with manual off-platform settlement** (R2). There is no Stripe
   Connect and no payables record. The ledger in Phase 4 would be the first record of what HelloCircle owes
   partners. The vendor "Payments" total overstates earnings today.
3. **Some existing defects in money paths are worth fixing before or alongside Phase 1** (D10):
   - R8: a boot-time backfill can flip an unpaid pending booking to `paid`.
   - R4: vendor coupons can apply platform-wide, and coupon amounts are unvalidated (including negative values).
   - R5: an unthrottled coupon-validation oracle.
   - R3: any resident can run paid Games.
   - R14: a suspended vendor's listings can still take payment.
4. **The €100 deposit has no working refund path** (R7). Refunds are full-only, and a manual partial refund
   permanently blocks in-app refunds for that booking.
5. **Stripe event coverage stops at Checkout** (R9). Disputes and external refunds are invisible, and there is no
   processed-event store. Both are needed before the ledger, credits or subscriptions.
6. **Data quality**: whole-euro and cent columns are mixed (R11), `subtotal_cents` stores the post-discount
   figure (R12), and three of the six flows store totals only.
7. **"Completion" isn't stored anywhere** (R22). Two attendance mechanisms exist: the `attendance` table and
   `game_participants.attended`, unified for reading by `attendanceState.ts`. Settlement needs a defined
   completion rule.

## 3. What to reuse

| Existing piece | Reuse as |
|---|---|
| `checkoutService.ts:createCheckoutSession` / `{type, ref}` metadata contract | The only Stripe Checkout entry point. The order id travels in `ref`; the `type` literals stay unchanged. |
| `bookingIntegrity.ts` (holds, `consumeCoupon`/`releaseCoupon`, `endPendingHold`) | Capacity and coupon reservation inside order creation. |
| `stripeWebhook.ts:settlePending` + late-payment "refund required" state | Confirmation. The order layer updates in the same transaction. |
| `refundPaidOnce` / `issueStripeRefund` (HC-QA-051/091) | Extended with an amount for partial refunds. Semantics kept. |
| Server quote endpoints for games/programmes/experiences (HC-QA-047) | Template for `POST /api/commerce/quotes`. |
| `app_settings` + `getSetting` cache; `feature_flags` per-org | Global and per-org rollout flags. |
| `audit.ts:writeAudit` / `audit_log` | Extended with additive columns (actor kind, reason, correlation id). |
| `org_policies` (cancellation hours, booking window, refund policy text) | Partner-level override source for cancellation rules. |
| `requirePlatformRole("finance")`, `orgVendorIds`, `requireAdmin` | Authorisation for every new partner or admin finance route. |
| `attendanceState.ts:deriveAttendanceState` | Input to the completion rule. |
| Admin `featured` flag | The visibility effect for Boost vouchers. |
| Isolated test profile (`testIsolated.ts`, `testProfile.ts`) and `qaProviderStubEnabled` | Every new test. The Stripe stub seam drives webhook state tests without the network. |

## 4. Security and authorisation audit (summary)

| Control | Status |
|---|---|
| Webhook signature | ✅ Required when the secret is set. Unsigned only with a local opt-in, refused in prod and staging (`stripeWebhookPolicy.ts`). |
| Webhook idempotency | ⚠️ State-based only (`payment_status='pending'` guard). No event-id store (R9). |
| Client-supplied prices | ✅ Never trusted. Every route recomputes the price on the server. |
| Vendor org ownership | ✅ `vendorIds IN (...)` on refund, coupon and payment routes. |
| Vendor staff money actions | ✅ Refunds and coupon writes are `finance`-gated. ⚠️ Coupon *listing* is ungated (read-only). |
| Host refunds | ⚠️ Gated only to the host of that game, but the money comes from the platform's balance (R3). |
| Coupon ownership | ❌ Unscoped vendor coupons apply platform-wide, and amounts are unvalidated (R4). |
| Coupon enumeration | ❌ No rate limit, distinct error messages (R5). |
| Admin finance | ✅ `requireAdmin` on all admin routes. ⚠️ Coupon admin actions aren't audited (R6). |
| Suspended vendor | ❌ Listings stay bookable (R14, to verify). |
| Session vs Bearer separation | ✅ Bearer is read only in `guestAuth.ts:111` for the resident (mobile) path. Vendor auth is cookie-only. |
| Firebase or Google sign-in escalation | ✅ Google sign-in for vendors is login-only (per existing memory/docs). Nothing in commerce grants a role. |
| Rate limiting | ⚠️ In-memory per process (`rateLimit.ts`). Checkout endpoints are unthrottled. |
| Refund replay | ✅ Row lock plus Stripe idempotency key. |
| Duplicate checkout click | ⚠️ Each click creates a new pending row and hold. The capacity lock prevents overselling, but one person can hold several seats for 30 minutes. A quote-bound idempotency key in Phase 2 fixes this. |

## 5. Test inventory (summary)

- **Server (Vitest, isolated Docker MySQL, 50 test files).** Money-adjacent coverage:
  - `stripeWebhook.test.ts`, `paymentConfirmation.test.ts`: confirm idempotency and late payment.
  - `checkoutService.refund.test.ts`: exactly-once refund and reconciliation.
  - `stripeWebhookPolicy.test.ts`, `stripeDiagnostics.test.ts`, `selfCancel.test.ts`, `capacity.test.ts`.
  - Concurrency in `games.test.ts`, `registrations.test.ts`, `programs.test.ts`, `experiences.test.ts`,
    `vendorSignupRace.test.ts`.
- **Missing:** unit tests for `pricing.ts` / `evaluateCoupon` (R25), coupon reservation races across types,
  partial refunds (unsupported), disputes, pass purchase and redemption, cash-path totals, and authorisation tests
  for coupon creation scope.
- **Client (Vitest, 16 files).** Pure utilities only (`euro.test.ts` is the only money one). No checkout
  component tests.
- **Integration harness (`tests/integration`, `npm run qa:*`).** Includes `stripe-fixture.ts` /
  `stripe-models.ts` (`qa:stripe`, test mode only), `booking-fixture.ts` (`qa:booking`), authorisation, security
  gate, lifecycle and Playwright e2e. Payment harness runs are blocked until a Stripe **test-mode** key is
  provided, consistent with "Stripe Phase 9 paused".
- **CI.** `.github/workflows/web-ci.yml` exists and is the required "Web CI" check. `CLAUDE.md`'s "No CI" line is
  out of date.

## 6. Open decisions (needed before the noted phase)

| ID | Decision | Needed before | Recommendation |
|---|---|---|---|
| D1 | Adopt "€0 customer fee, one all-in price, 7% success fee from the partner" in place of today's "+5% fee +23% VAT on top"? If yes, do listed prices become VAT-inclusive (customers pay less) or do partners re-price? | Phase 2 go-live (not Phase 1) | Seed today's model as rule v1, keep the target as a draft v2, and decide before the first type goes live. |
| D2 | VAT model: HelloCircle as merchant of record charging VAT on the full supply (today), or VAT only on the commission? Needs an accountant. | Phase 2 go-live | The config stores the *assumption*. The legal model has to come from you. |
| D3 | Settlement: keep manual payouts with the ledger as the payables record (v1), or Stripe Connect now? And how are cash payments treated: no fee, or a receivable owed by the vendor? | Phase 4 | Ledger plus a manual payout export first. Connect only after separate approval. |
| D4 | Keep the €100 venue deposit? If yes, it needs partial refunds and a release trigger. | Phase 8 (bookings) | Make it a per-scenario configurable amount (0 allowed). Build partial refunds in Phase 4. |
| D5 | Require `host_status='verified'` for paid Games? | Phase 0.5 / Phase 8 | Yes, behind a flag. |
| D6 | Completion rule for the success fee, credit release and payout eligibility: session end + N hours with no open dispute, attendance optional? | Phase 4 | That rule, with N configurable. |
| D7 | Circle Credits are earned by partners only (vendor org and host resident), not customers? Earned on which GMV: customer-paid, or partner gross? | Phase 5 | Partners only. Earn on settled customer-paid GMV, excluding platform-funded discounts. |
| D8 | What does Pro unlock? Nothing in the app is plan-gated today. | Phase 6 | Define the benefit list before building billing. |
| D9 | Open Booking: keep joiners paying on top of the booker's full payment, or credit the booker? | Phase 8 (bookings) | Keep current behaviour under flag. Revisit with the ledger. |
| D10 | Approve a small Phase 0.5 hardening PR (R8, R4, R5, R14, optional R3) before Phase 1? These fall outside "commerce engine" scope but are live money defects. | Now | Yes. Each is small and independently revertable. |
| D11 | Drop the per-rule "environment" column (each environment has its own database) and record the environment in audit rows only? | Phase 1 | Yes. |
| D12 | Two-person approval for publishing rules (`created_by` ≠ `approved_by`), or single-admin publish with a mandatory reason? | Phase 1 | Store both fields. Enforce two-person approval only when an admin setting enables it, since there may be just one admin today. |

## 7. Proposed phase sequence

0.5 Hardening → 1 Config foundation → 2 Quotes, orders and shadow mode (Experiences live first) → 3 Coupons →
4 Ledger, partial refunds and disputes → 5 Circle Credits → 6 Pro (test mode) → 7 Boost → 8 Remaining types
(Programmes → Bookings → Registrations → Games → Passes) → 9 Readiness. Details, tables, flags, rollback and
effort are in `commerce-implementation-plan.md`.

## 8. Audit Gate

Phase 0 is complete. **No implementation will start until you approve this audit and the plan.** At a minimum,
please answer D10 (hardening now?), D11 and D12 (needed for Phase 1). D1/D2 can wait until the end of Phase 2,
because Phase 1 deliberately reproduces today's pricing.
