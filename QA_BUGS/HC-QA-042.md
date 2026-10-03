# HC-QA-042 — Experience booking form shows a lower total than the server charges

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

`POST /api/experiences/:id/sessions/:sid/quote` shares `quoteExperience()` with checkout. The booking form displays that total with VAT and fee broken out. Verified: shown €12.80 = stored €12.80; party of 2 shows €25.60 = stored.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-042'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P2. Category: UX / BOOKING (pricing transparency).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-042'`. It must turn green after a fix without changing the assertion.

## Journey
Price authority (Part 9) / browser journey (Part 24)

## Expected
The amount shown before confirming equals the authoritative server total (or VAT and fees are shown explicitly).

## Actual
For a €10 cash adventure, the dialog shows **€10.00** (and €20.00 for a party of 2), but the stored amount owed is **€12.80** (€25.60): the server adds 23% VAT and the 5% platform fee. The guest is told one amount and owes another.

## Likely source
`client/src/pages/ExperienceDetail.tsx` `bookingTotalCents = priceCents × partySize`, whereas the server uses `computePricing` (VAT + fee).

## Proposed minimum fix (not applied)
Show the server-computed breakdown (a quote endpoint or a shared pricing helper) or the inclusive total. Product decision on VAT-inclusive pricing.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
