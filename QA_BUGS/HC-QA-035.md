# HC-QA-035 — Negative or fractional hall-hire duration manipulates the price

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

`createBookingInternal` (shared with Make It Happen) validates `duration` as an integer 1..24 before pricing, so the billed hours are the reserved hours (the end is derived from start + duration; there is no client end time). Verified: negative, zero, fractional, text, numeric-string and null are rejected (400); 13h past closing → 409; 1h and 3h are accepted with subtotal = rate × stored duration.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-035'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P1. Category: BOOKING (price integrity).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-035'`. It must turn green after a fix without changing the assertion.

## Journey
Price authority (Part 9) / quantity (Part 10)

## Expected
`duration` must be a positive whole number of hours, and the total always follows the stored duration.

## Actual
`duration: -2` on a cash room gives 201 and a **confirmed booking with total €0** (stored `duration=-2`). A negative range also never overlaps, so these bookings stack. `duration: 1.5` is priced as 1.5h (€38.40) but stored as 2h (INT column), so the guest pays for less time than the slot they hold. The online-room deposit path takes the same input.

## Likely source
`server/src/routes/bookings.ts` POST /checkout only checks `!body.duration`. `createBookingInternal` uses `hireCost(rate, duration)` with no type or range check. `computePricing` clamps a negative taxable amount to 0.

## Proposed minimum fix (not applied)
Validate `Number.isInteger(duration) && duration >= 1 && duration <= max` before pricing, on both /checkout and Make It Happen.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
