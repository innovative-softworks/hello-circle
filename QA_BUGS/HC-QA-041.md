# HC-QA-041 — Pending (mid-checkout) reservations don't hold capacity for registrations, enrolments or experience bookings

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

A pending paid row is a capacity hold for `PENDING_HOLD_MINUTES` (30), aligned with the provider session `expires_at`. Expiry is read-time, so no scheduler is needed; the provider's expired event later marks it failed. This applies to registrations, programmes, experiences, hall slots and (cross-model) activities. Confirm functions settle under the parent lock: replays are no-ops; a live hold confirms; a stale hold re-proves capacity, otherwise it becomes cancelled + paid with a `*.refund_required` audit row. Verified through the QA provider seam (no Stripe): hold blocks competitors, success, duplicate success, failure release, expiry release, late success → refund required, 6 concurrent paid checkouts → 1 hold.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-041'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P1 (latent: blocks Stripe test mode). Category: BOOKING (held capacity).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-041'`. It must turn green after a fix without changing the assertion.

## Journey
Held capacity (Part 7)

## Expected
Capacity is reserved for an in-flight paid checkout, or confirmation re-checks capacity, so paid orders can never exceed capacity.

## Actual
With one synthetic pending row on a capacity-1 club, programme or experience session, a competing booking still returned **201** in all three models. These capacity checks count only `payment_status='paid'`, and `stripeWebhook.ts` confirm functions for these types don't re-check capacity. Once Stripe is enabled, N people can pay for the last place. Today Stripe is off, so pending rows can't persist (the 503 path deletes them); the defect is latent. Hall bookings (pending holds the slot) and activity joins (`pending_payment` counted) are correct.

## Likely source
Capacity checks in `registrations.ts`, `programs.ts` and `experiences.ts`. Confirm functions in `stripeWebhook.ts`.

## Proposed minimum fix (not applied)
Count unexpired pending rows as held (with an expiry tied to the checkout session lifetime), and/or re-check capacity in the confirm functions and auto-refund on conflict. Must be fixed before Stripe test-mode booking runs.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
