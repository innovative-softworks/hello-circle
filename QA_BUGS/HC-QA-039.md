# HC-QA-039 — Experience party size: fractional values mismatch price and seats; string values break the capacity check

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

`partySize` is optional (defaults to 1); if present it must be an integer ≥ 1, otherwise 400. Capacity and price use the same accepted value. Verified: 0, −1, 1.5, "two", "2" and "NaN" → 400; over capacity → 409; 1 and the maximum accepted; subtotal = unit price × stored party size; the quote endpoint returns the same amount.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-039'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P2. Category: BOOKING (price / capacity).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-039'`. It must turn green after a fix without changing the assertion.

## Journey
Quantity (Part 10)

## Expected
`partySize` is a positive whole number within capacity, and the price always equals price × stored seats.

## Actual
`partySize: 1.5` gives 201, **priced for 1.5 seats** (subtotal €15) but stored as 2 seats. `partySize: "1"` (a string) is concatenated in the capacity check (`booked + "1"` → "21"), so capacity is judged on a string (409 here; it can equally accept wrongly). Zero and negative silently become 1.

## Likely source
`server/src/routes/experiences.ts` checkout: `body.partySize > 0 ? body.partySize : 1` with no integer or type check. The capacity check does `Number(booked) + partySize`.

## Proposed minimum fix (not applied)
Coerce and validate `Number.isInteger(partySize) && partySize >= 1`, and reject anything else with 400.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
