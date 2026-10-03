# HC-QA-027 — Leaving a free activity tells the host the participant paid and should be refunded

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/routes/games.ts DELETE /:id/join.
The refund notice now requires a genuinely priced activity (`price_cents > 0`), matching the existing rejoin guard. Free leave sends no host notification (current semantics: hosts are only told about leaves that need a refund).

Verification (isolated QA, real API/MySQL/browser): HC-QA-027 (original) and HC-QA-028-INVARIANT's free-leave check: zero host notifications. Paid path not exercised (no Stripe).
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-027'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P3. Category: FUNCTIONAL. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-027:'`. It must turn green after a fix without editing the assertion.

## Journey
Leave participation (Part 7) / notifications (Part 21)

## Expected
Leaving a free activity sends no payment/refund notification.

## Actual
Host receives "X left …" with body "They'd paid to join — you can issue a refund from your activity's participant list." for a FREE activity (evidence: refundWordingNotifications=1). Any refund attempt fails (no payment record).

## Likely source
`server/src/routes/games.ts` DELETE /:id/join checks `participant.paymentStatus === 'paid'` only; free joins default `payment_status='paid'` (the join route's own comment acknowledges this for rejoin).

## Proposed minimum fix (not applied)
Also require `games.price_cents > 0` (as the rejoin guard already does).

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
