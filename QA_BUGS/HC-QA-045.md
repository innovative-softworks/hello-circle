# HC-QA-045 — Past-dated experience sessions remain bookable

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Experience checkout rejects a session whose Ireland wall-clock start has passed (409); past bookings stay viewable. Verified: past → 409; earlier today → 409; later today → 201; future → 201.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-045'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P3. Category: BOOKING / FUNCTIONAL.
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-045'`. It must turn green after a fix without changing the assertion.

## Journey
Availability (Part 3)

## Expected
A session whose date has passed can't be booked.

## Actual
A session dated 2021-05-05 with status `scheduled` → booking 201.

## Likely source
`server/src/routes/experiences.ts` checkout checks only `session.status === 'scheduled'`.

## Proposed minimum fix (not applied)
Reject sessions before Ireland today (or before start time), and hide them from detail.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
