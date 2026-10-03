# HC-QA-036 — Hall booking accepts guests above room capacity, negative guests and past dates; a malformed date crashes

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Guests are an integer ≥ 1 and ≤ `rooms.cap` (when set); the date must be a real calendar date, today or later in Ireland, with the start not yet passed. The same date rules apply to reschedule. Verified: over-capacity, negative and fractional guests, past dates, today's already-passed hour, 2030-02-31 and malformed text → 400; no 500 and no row left behind.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-036'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P2. Category: BOOKING / FUNCTIONAL.
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-036'`. It must turn green after a fix without changing the assertion.

## Journey
Availability and capacity (Parts 3, 6)

## Expected
`guests` must be 1..`rooms.cap`; the date must be a valid date that is today or later; invalid input returns 400.

## Actual
`guests: 500` (room cap 10) → 201. `guests: -3` → 201. `date: 2021-03-03` → 201 (a confirmed past booking). `date: not-a-date` → **500**; no row was left behind, so that path is atomic.

## Likely source
`server/src/routes/bookings.ts` `createBookingInternal`: no guests-vs-capacity check and no date validation. The same applies to `/reschedule`.

## Proposed minimum fix (not applied)
Validate guests against the room cap, and the date format and range (Ireland today), before the transaction.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
