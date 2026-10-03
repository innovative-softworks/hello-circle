# HC-QA-091 — A refund made outside HelloCircle is ignored; the vendor refund then fails with "try again" forever

Severity: P2. Category: PAYMENTS. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 11A, 2026-10-03; Policy A approved). Found Phase 11.
Found with real Stripe-delivered TEST-mode webhooks (Stripe CLI `listen`, `livemode=false` verified before start) against an isolated local stack. Synthetic data only.

- **Screen:** Vendor dashboard → Bookings → Refund; resident My bookings; slot availability.
- **Actor:** Vendor/finance staff, the platform operator (Stripe Dashboard user), and the booker.
- **Viewport / browser:** n/a (server/payment state).

**Steps**

1. Pay a centre booking through hosted Stripe Checkout (test card). The real `checkout.session.completed` delivery gets 200, and the booking becomes `paid`/`confirmed`.
2. Refund that payment outside HelloCircle (Stripe API `refunds.create`, which is what a Stripe Dashboard refund produces).
3. Wait for Stripe's `charge.refunded` delivery.
4. As the vendor, press Refund on the booking in HelloCircle.

- **Expected (either policy):**
  - Policy B (Dashboard refunds allowed): the booking reconciles to `refunded` (and its slot or capacity is released per the cancellation rules).
  - Policy A (refunds only inside HelloCircle): the app at least detects "already refunded in Stripe", marks it refunded and audits it, instead of failing.
- **Actual:**
  - Step 3: `charge.refunded` was delivered and **acknowledged 200 but ignored**. The booking stayed `payment_status=paid`, `status=confirmed`, and its slot stayed held.
  - Step 4: **502 "The refund couldn't be completed — please try again"**. The server log shows Stripe's "Charge … has already been refunded."
  - Retrying can never succeed. The booker is refunded but still appears booked, and the vendor sees revenue that was returned.
  - Good: there was **no double refund**; Stripe still shows exactly 1 refund.
- **Evidence:** Scratchpad `stripe-policyb.mjs` → `dashboard_style_refund: {stripeRefundStatus: succeeded, chargeRefundedEventDelivered: true, appResponseCodes: ["200"], bookingPaymentAfter: "paid", bookingStatusAfter: "confirmed", slotStillHeld: 1}`; `helloCircle_refund_after_external: {status: 502, stripeRefundCount: 1, bookingPayment: "paid"}`.
- **Root cause:**
  - `server/src/routes/stripeWebhook.ts` only consumes `checkout.session.*` events.
  - `refundCheckoutSession()` (`server/src/checkoutService.ts`) treats Stripe's `charge_already_refunded` as a generic failure.
- **Scope note:** The same applies to every paid type that refunds through `refundCheckoutSession()`: registrations, experience bookings and programme enrolments.
- **Recommendation:** Adopt **Policy A** (all refunds inside HelloCircle). Still make the refund path idempotent against `charge_already_refunded`: reconcile to `refunded` and audit "refunded externally". Optionally consume `charge.refunded` to flag mismatches to admins. Policy B would need full `charge.refunded` / partial-refund reconciliation across five tables.
- **Regression status:** None yet. A test can be added to `qa:stripe` (external refund → HelloCircle refund → expect reconciled, not 502).

## Phase 11A remediation (Policy A)

**Policy:** HelloCircle is the authoritative refund workflow. Dashboard/manual refunds aren't a supported workflow, but an already-refunded charge must reconcile, not fail forever.

**Fix:** `server/src/checkoutService.ts`.
- `issueStripeRefund()` reads the **provider state first**: `paymentIntents.retrieve(…, expand latest_charge)`.
  - **Fully refunded at Stripe** → returns `reconciled: true` and **never requests another refund**.
  - **Partially refunded** → `unsupported`: refused, no guess.
  - **Otherwise** → one refund with the existing idempotency key, plus `metadata.hc_checkout_session`.
  - Stripe's `charge_already_refunded` race (refunded between check and request) is re-checked and reconciled the same way.
- `refundPaidOnce()` is unchanged in shape: it locks the row (`FOR UPDATE`), re-checks it, and makes **one** `paid → refunded` transition in the same transaction. Concurrent or repeated attempts get 409.
- A partial external refund returns 409 with a clear message (not a retryable 502). It logs `[payments] RECONCILIATION REQUIRED …` and writes an operational audit row `payment.refund_reconciliation_blocked`; the row stays `paid`.
- All five callers pass their audit context:
  - booking, registration and programme enrolment (`vendorOperations.ts`, `vendorPrograms.ts`);
  - experience booking (`vendorExperiences.ts`);
  - game participant (`games.ts`).

  A reconciled refund is audited as `<type>.refund_reconciled_external` (`newValue.source = "stripe_external"`), not as `refunded_by_vendor/host`.
- **Capacity and status follow the existing refund rule unchanged:** a refund only changes `payment_status`, and cancellation/release stays a separate action. So reconciliation releases nothing extra and nothing twice.
- The existing refund notification is sent once, on the single transition.

**Regressions:** Stripe TEST mode, real hosted payments, `tests/integration/specs/stripe-refund-external.spec.ts`, batch `stripe-refund-external`.

| Test | Before | After |
|---|---|---|
| HC-QA-091-HALL (3 concurrent HelloCircle refunds after an external refund) | **FAIL:** `[502, 502, 502]` | PASS: `[200, 409, 409]`, replay 409, 1 provider refund (the external one), `refunded`, status unchanged, 1 reconciled audit, 0 vendor-refund audits, notifications added once and not on replay |
| HC-QA-091-CLUB / PROGRAMME / EXPERIENCE / ACTIVITY | — | PASS (same assertions, every model using the shared refund path) |
| HC-QA-091-PARTIAL (external €1 partial refund) | — | PASS: 409 (no "try again"), stays `paid`, no extra provider refund, 1 operational audit |
| `server/src/checkoutService.refund.test.ts` (fake Stripe: none / full / race / partial / provider error) | — | PASS |

Not changed (out of scope by decision): partial-refund support; automatic reconciliation from the `charge.refunded` webhook. The webhook still acknowledges and ignores the event; reconciliation happens on the next HelloCircle refund action.
