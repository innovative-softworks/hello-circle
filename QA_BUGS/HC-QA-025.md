# HC-QA-025 — Publishing-state endpoint can silently cancel or complete an activity

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/routes/games.ts POST /:id/lifecycle.
State model: `lifecycle` = host publishing choice (draft/coming_soon/active/paused/archived); `status` = operational, sole cancellation authority; `completed` derived from date; publish_at/booking windows = read-time schedule. The endpoint now rejects `cancelled` (use POST /cancel) and `completed` (derived) with 409, and a cancelled activity can only be archived. No new state system.

Verification (isolated QA, real API/MySQL/browser): HC-QA-025 (original) and HC-QA-025-INVARIANT: invalid transitions 409 with games/participants/notifications snapshots unchanged; canonical cancel → status cancelled, lifecycle untouched, one notification; no lifecycle=cancelled/completed rows.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-025'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P2. Category: DATA INTEGRITY. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-025:'`. It must turn green after a fix without editing the assertion.

## Journey
Activity lifecycle transitions (Part 12/22)

## Expected
Cancellation goes through POST /:id/cancel (status=cancelled, participants notified). `completed` is derived from the date and never stored.

## Actual
POST /api/games/:id/lifecycle {lifecycle:'cancelled'} returns 200, stores lifecycle=cancelled while status stays 'open', and notifies nobody (evidence: storedStatus=open, storedLifecycle=cancelled, participantNotified=0). {lifecycle:'completed'} on a 2030 activity returns 200 and it reads as completed. Produces an invalid status/lifecycle combination and a silent cancellation for joined participants. API-only (the host UI does not offer these), but the endpoint is the one the UI uses.

## Likely source
`server/src/routes/games.ts` POST /:id/lifecycle uses `validateLifecycleTransition('activity', …)`; `server/src/lifecycle.ts` allows active→cancelled/completed for activities, contradicting the games.ts header comment that activities never store cancelled/completed.

## Proposed minimum fix (not applied)
Reject `cancelled`/`completed` on the activity lifecycle endpoint (direct callers to /cancel), or route them through the full cancel semantics.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
