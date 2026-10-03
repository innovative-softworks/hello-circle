# HC-QA-040 — Cancelling an experience session leaves its bookings confirmed and active

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

The vendor session cancel is one transaction under a session row lock: the session is cancelled; active paid and pending bookings are cancelled (paid ones stay `payment_status='paid'`, the existing "refund required" state handled by the vendor refund route, with no fabricated refund; pending holds are marked failed); an audit row is written; each affected booking is notified once. A repeat cancel is a no-op (`bookingsCancelled: 0`), and new bookings are denied under the lock.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-040'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P2. Category: BOOKING (resource cancellation).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-040'`. It must turn green after a fix without changing the assertion.

## Journey
Resource cancellation (Part 17) / notifications (Part 20)

## Expected
When a vendor cancels a session, its active bookings move to cancelled and the booked participants are told.

## Actual
After `DELETE /api/vendor/experiences/:id/sessions/:sid` the session is `cancelled`, but the booking stays **confirmed/paid**, still appears in the participant's bookings, and the resident gets no cancellation notification (only the original confirmation).

## Likely source
`server/src/routes/vendorExperiences.ts` session DELETE only updates `experience_sessions.status`.

## Proposed minimum fix (not applied)
Cancel the session's active bookings in the same transaction and fan out `notifyCancellation` once per booking. Payment refunds stay at the provider boundary.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
