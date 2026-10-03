# HC-QA-028 — Cancel/archive/leave side effects incomplete

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/routes/games.ts cancel, lifecycle, leave.
(A) Cancel is idempotent: conditional UPDATE; only the request that flips status fans out (repeat → 200 `alreadyCancelled`, no notifications). (B) Cancel closes waiting/offered waitlist entries (`cancelled`) and notifies waitlisted residents once; participants notified once as before. (C) Archive is administrative: blocked (409) for an upcoming, uncancelled activity with other joined participants — cancel first — and silent otherwise (cancelled/completed/empty). (D) Host cannot leave their own activity (400, same rule as host self-remove); the host's participant row is the ownership seat.

Verification (isolated QA, real API/MySQL/browser): Four original sub-regressions and HC-QA-028-INVARIANT: one cancellation notification each to participant and waitlisted resident, waitlist closed, list/host profile/Circle nextPlan updated, join 409, leaving a cancelled activity creates no offer, archive rules, host seat intact.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-028'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P3. Category: FUNCTIONAL. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-028'`. It must turn green after a fix without editing the assertion.

## Journey
Cancel / archive / leave (Parts 7, 22, 23)

## Expected
Cancelling closes waitlist entries and tells waitlisted residents; a repeated cancel is a no-op; archiving an upcoming activity with participants is blocked or communicated; the host cannot leave their own activity.

## Actual
(a) After cancel the waitlisted resident's entry stays 'waiting', detail still shows waitlistedByMe=true, no notification. (b) A second POST /cancel returns 200 and re-sends "Cancelled:" (2 notifications). (c) POST /lifecycle archived on an upcoming activity with a joined participant returns 200 with no participant notification; participant stays 'joined' to a hidden activity. (d) Host DELETE /:id/join returns 200; host's participant row is cancelled and joined drops to 0 (POST …/participants/:self/remove correctly returns 400). (b)-(d) are API-only; no UI exposes them.

## Likely source
`server/src/routes/games.ts` POST /:id/cancel (no already-cancelled guard, no waitlist handling), POST /:id/lifecycle (no archive side effects), DELETE /:id/join (no host guard).

## Proposed minimum fix (not applied)
Guard repeat cancel; close/notify waitlist on cancel; block or notify on archive with participants; mirror the remove-route host guard on leave.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
