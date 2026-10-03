# HC-QA-032 — Host create flow: draft confirmed as "You're live." and past dates accepted

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: client/src/pages/HostGamePage.tsx; server/src/routes/games.ts.
(A) Confirmation matches the saved state: "Draft saved." (no Share for drafts), "Announced." for coming soon, "You're live." only when active. (B) Server: create requires a valid date ≥ today (Ireland); edit rejects only a CHANGED past date, so completed activities stay editable. Client: date input `min` = today when creating (none when editing an already-past activity) and a step error.

Verification (isolated QA, real API/MySQL/browser): HC-QA-032-DRAFT-COPY, HC-QA-032-PAST-DATE (originals) and HC-QA-032-SEMANTICS: today allowed, past/invalid rejected; past activity title edit 200, change to another past date 400; client min/step validation; coming-soon copy.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-032'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P3. Category: UX. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-032'`. It must turn green after a fix without editing the assertion.

## Journey
Activity creation / draft (Parts 1-2)

## Expected
Saving a draft confirms it as a draft; an activity cannot be created in the past.

## Actual
(a) Choosing "Save as draft" shows the "You're live." card ("…is posted — share it") although the activity is a private draft. (b) POST /api/games with date 2020-01-01 returns 201; the activity is instantly 'completed' (the date input has no min). Draft privacy itself is correct.

## Likely source
`client/src/pages/HostGamePage.tsx` justCreated card ignores lifecycle; `server/src/routes/games.ts` POST / and PUT /:id lack a not-in-the-past check.

## Proposed minimum fix (not applied)
Lifecycle-specific confirmation copy; validate date >= today (Ireland) server-side and set the input min.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
