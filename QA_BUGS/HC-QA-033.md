# HC-QA-033 — Circle membership input validation and duplicate join-request notifications

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/routes/circles.ts invite + join.
Circle invitations are resident-account invitations (no email model): an unknown residentId → 404, nothing written. A repeat join request while one is pending returns the same 202 without notifying; a request after a decline is a new pending request and notifies once.

Verification (isolated QA, real API/MySQL/browser): HC-QA-033-GHOST-INVITE, HC-QA-033-REPEAT-REQUEST (originals) and HC-QA-033-SEMANTICS: no orphan invite or notification rows; 3 repeats → 1 notification; decline → re-request → 2; repeat → still 2.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-033'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P3. Category: DATA INTEGRITY. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-033'`. It must turn green after a fix without editing the assertion.

## Journey
Circle invitations / join requests (Parts 14-15, 21)

## Expected
Invitations target existing residents only; re-sending a pending request does not re-notify organisers.

## Actual
(a) POST /api/circles/:id/invite with a random residentId returns 201 and creates an orphan circle_invites row plus a notification row for a non-existent resident. (b) A resident repeating POST /join on an approval Circle gets 202 each time (still one request row, correct) but organisers get one "Join request" notification per submission.

## Likely source
`server/src/routes/circles.ts` POST /:id/invite (no resident existence check); POST /:id/join approval branch always notifies.

## Proposed minimum fix (not applied)
Validate the resident; notify only when the request transitions to pending.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
