# HC-QA-029 — Activity updates are returned oldest-first when posted in the same second

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: games.ts GET /:id/updates; residents.ts GET /me/notifications.
ORDER BY created_at DESC, id DESC (auto-increment id as stable tie-breaker).

Verification (isolated QA, real API/MySQL/browser): HC-QA-029 (original) and HC-QA-029-TIES: 5 updates with 4 same-second ties return newest-first on repeated reads; participant notifications likewise.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-029'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P3. Category: FUNCTIONAL. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-029:'`. It must turn green after a fix without editing the assertion.

## Journey
Activity updates (Part 20)

## Expected
GET /api/games/:id/updates returns newest first ("Latest update" module).

## Actual
Three updates posted in quick succession return first|second|third. created_at has one-second resolution and the query has no tiebreaker. Persistence and participant notifications (one each, in order) are correct.

## Likely source
`server/src/routes/games.ts` GET /:id/updates `ORDER BY created_at DESC` without `id DESC`. The resident notifications list uses the same pattern.

## Proposed minimum fix (not applied)
Add `, id DESC` as tiebreaker.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
