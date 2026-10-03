# HC-QA-038 — Repeated identical registration or enrolment creates a second record and consumes capacity twice

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

One active registration per owner (client id or resident) + club + session + participant (name + DOB), and one active enrolment per owner + programme + participant. Both are checked inside the parent-row-locked transaction, so concurrent retries serialize. Verified: 4 concurrent identical → 201 + 3×409 (both models); a sibling is allowed; rebooking after cancellation is allowed.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-038'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P2. Category: BOOKING (idempotency).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-038'`. It must turn green after a fix without changing the assertion.

## Journey
Duplicate booking (Part 4) / idempotency (Part 21)

## Expected
A retry or double-submit of the same registrant/participant for the same club or programme doesn't create a second active record.

## Actual
Two identical club registrations → 201, 201 (2 rows). Two identical programme enrolments → 201, 201 (2 rows). Both consume capacity. Hall bookings are naturally protected by the slot overlap, and activity joins by UNIQUE(game, resident).

## Likely source
`registrations.ts` /checkout and `programs.ts` /enroll have no duplicate check or idempotency key.

## Proposed minimum fix (not applied)
Reject (or return the existing ref for) an active registration or enrolment with the same owner and participant identity, or accept a client idempotency key.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
