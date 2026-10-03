# HC-QA-030 — Public host profile count includes drafts and private activities

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/routes/residents.ts host-profile.
`gamesHostedTotal` now reuses canonical `discoverableGameSql` and excludes cancelled activities; past public activities still count. No new predicate.

Verification (isolated QA, real API/MySQL/browser): HC-QA-030 (original) and HC-QA-030-TRANSITIONS: public +1; draft, invite-only and future publish_at 0; draft→published +1; public→invite −1; cancel −1.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-030'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P3. Category: DATA INTEGRITY (aggregation). Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-030:'`. It must turn green after a fix without editing the assertion.

## Journey
Draft lifecycle / public counts (Part 2)

## Expected
Public counts are unaffected by drafts, scheduled or private activities (canonical discovery policy).

## Actual
Anonymous GET /api/residents/:id/host-profile `gamesHostedTotal` goes 0→2 after the host creates one draft and one invite-only activity (also observed 1→2 for a single draft in LC-ACT-CREATE-DRAFT-PUBLISH). Reveals the existence of unpublished/private activities as a number; no content is exposed. Not covered by HC-QA-011/012/015's aggregation set.

## Likely source
`server/src/routes/residents.ts` host-profile `SELECT COUNT(*) FROM games WHERE host_resident_id = ?` (unfiltered), while `upcomingGames` correctly uses discoverableGameSql.

## Proposed minimum fix (not applied)
Apply discoverableGameSql (or a defined 'hosted publicly' predicate) to the count.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
