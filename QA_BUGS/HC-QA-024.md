# HC-QA-024 — Poll votes are accepted and changed after the poll is closed

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/routes/circles.ts vote route.
Vote/toggle now rejected with 409 unless `circle_polls.status = 'open'`, after the unchanged HC-QA-013 parent→child poll resolution and membership check.

Verification (isolated QA, real API/MySQL/browser): HC-QA-024 (original) and HC-QA-024-INVARIANT: open vote and toggle work; after close, new vote, toggle-off and organiser vote all 409; vote rows and totals unchanged; cross-Circle poll access still 404. Security gate (incl. HC-QA-013) green.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-024'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P2. Category: FUNCTIONAL. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-024:'`. It must turn green after a fix without editing the assertion.

## Journey
Circle polls (Part 18)

## Expected
Voting on a closed poll is rejected (409) and stored votes do not change.

## Actual
Organiser closes the poll (status=closed); a member's vote still returns 200 and adds a vote (evidence: voteAfterCloseStatus=200, votesAfterClose=1). Results of a closed poll can keep changing.

## Likely source
`server/src/routes/circles.ts` POST /:id/polls/:pollId/options/:optionId/vote resolves the poll through the Circle (HC-QA-013 fix intact) but never checks `circle_polls.status`.

## Proposed minimum fix (not applied)
Reject votes when the poll status is not 'open'. HC-QA-013's parent→child scoping must stay unchanged.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
