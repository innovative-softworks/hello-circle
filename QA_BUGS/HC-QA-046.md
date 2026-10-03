# HC-QA-046 — Concurrent duplicate cancels are not idempotent (duplicate notifications)

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Every cancel route (guest and vendor; hall, registration, enrolment, experience) and activity self-leave uses `UPDATE … WHERE … AND status != 'cancelled'` (or `status = 'joined'`) and only acts when `changes === 1`. Losers get 409. Verified: 6 simultaneous cancels per model → 1×200 + 5×409, one notification set, a single capacity release (the freed place rebooks exactly once).

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-046'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P2. Category: BOOKING (idempotency).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-046'`. It must turn green after a fix without changing the assertion.

## Journey
Cancellation idempotency (Parts 15, 21)

## Expected
Concurrent identical cancel requests produce exactly one state change and one notification fan-out.

## Actual
3 concurrent cancels of one registration → 200, 200, 409 with **4** notifications. 3 concurrent cancels of one hall booking → 200, 200, 200 with **6** notifications. Each registration success also triggers waitlist promotion. Sequential repeats are correctly rejected with 409.

## Likely source
Cancel routes in `bookings.ts`, `registrations.ts`, `programs.ts`, `experiences.ts` and the vendor equivalents do check-then-`UPDATE … WHERE ref = ?` without a status predicate.

## Proposed minimum fix (not applied)
Use `UPDATE … SET status='cancelled' WHERE ref = ? AND status != 'cancelled'` and act only when `changes === 1`, the same pattern as the Phase 7 HC-QA-028 activity cancel.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
