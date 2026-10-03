# HC-QA-023 — Circle plans created through the UI are always public, including for invite-only Circles

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/routes/games.ts POST /.
When `circleId` is set and no visibility is sent (the host UI never sends one), visibility is inherited from the Circle's join mode: open → `public`, approval/invite → `circle` (existing values; `circle` = members, invitees, participants per canViewGame). Explicit valid visibility is honoured; unknown values now 400.

Verification (isolated QA, real API/MySQL/browser): HC-QA-023 (original) and HC-QA-023-INHERIT across open/approval/invite Circles: detail (anon/outsider/member), discovery, host profile, organiser plans, member upcoming/nextPlan, share data and join eligibility all match the inherited visibility.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-023'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P2. Category: FUNCTIONAL (privacy-impacting product gap). Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-023:'`. It must turn green after a fix without editing the assertion.

## Journey
Circle-only activity / official Circle plan (Parts 11, 17, 24)

## Expected
A plan created for an invite-only (or approval) Circle is not publicly discoverable unless the organiser chooses public; the UI offers circle-only/invite-only visibility.

## Actual
HostGamePage never sends `visibility`, so every UI-created activity (including Start a Circle → Create first plan, and Manage → Create plan) is stored `public`. For an invite-only Circle the plan appears in anonymous GET /api/games with its `circleName` and date/location (evidence: storedVisibility=public, anonymousListed=true, circleNameExposed=true). Circle-only and invite-only activities can only be created through the API — no UI path exists.

## Likely source
`client/src/pages/HostGamePage.tsx` handleSubmit (no visibility field/control); `server/src/routes/games.ts` createGameRow defaults `visibility ?? 'public'`; toGameJson includes circleName on the public list. The canonical visibility policy itself behaves correctly — this is a default/UX gap, not an authorization bypass, so it is not a Stage B security regression.

## Proposed minimum fix (not applied)
Product decision: default a Circle plan to `circle` visibility for non-open Circles (or at least prompt), and expose a visibility control in the host form.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
