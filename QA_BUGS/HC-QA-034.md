# HC-QA-034 — Club-wide capacity overbooked by concurrent registrations

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

`registrations.ts` now has a single `reserveRegistration` transaction: a `SELECT … FROM clubs … FOR UPDATE` row lock, then the duplicate check, club-wide capacity (occupancy + live holds + held offers), session capacity under the session lock, coupon consumption and the insert. The unlocked pre-check is gone. Verified: capacity 1 with 6 racers → 1; capacity 2 with 6 → 2; 6 different clubs in parallel → 6 (no cross-club blocking); waitlist → offer → claim stays within capacity; 6 concurrent paid checkouts → one hold.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-034'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P1. Category: BOOKING / DATA INTEGRITY.
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-034'`. It must turn green after a fix without changing the assertion.

## Journey
Concurrent booking (Part 5) / capacity 1 (Part 6)

## Expected
Club-wide confirmed registrations (paid and not cancelled) never exceed `clubs.capacity`.

## Actual
On a capacity-1 free club, 6 concurrent registrations all returned 201 and **6 were confirmed** (evidence: `confirmed=6`, `capacity=1`). The same race exists for cash clubs. The per-session capacity path is row-locked and held correctly (6 racers, 1 confirmed).

## Likely source
`server/src/routes/registrations.ts` POST /checkout: the club-wide count is read outside any transaction or lock, then `insertRegistrationWithSessionLock` takes the plain insert path when there's no session. The code comment accepts this race as a "minor risk".

## Proposed minimum fix (not applied)
Lock the club row (`SELECT … FROM clubs WHERE id = ? FOR UPDATE`) and do the club-wide count (including held offers) and the insert in one transaction, the same way the session path already works.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
