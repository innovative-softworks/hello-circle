# HC-QA-031 — Clicking an activity card's photo does not open the activity

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: client/src/components/Photo.tsx, client/src/index.css.
The Photo overlay layer gets class `photo-content` with `pointer-events: none`; interactive descendants (a, button, input, select, textarea, label, [role=button], [tabindex]) re-enable pointer events. Card markup unchanged; the stretched `<a aria-label>` stays the single card link.

Verification (isolated QA, real API/MySQL/browser): HC-QA-031 (original) and HC-QA-031-INTERACTION: photo and text area clicks navigate; save button inside the photo toggles a real favourite without navigating; keyboard focus + Enter opens the card; no nested interactive content in the link.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-031'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P3. Category: UX. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-031:'`. It must turn green after a fix without editing the assertion.

## Journey
Discover → detail (Parts 6, 24)

## Expected
The whole card, including the photo, opens the activity detail.

## Actual
On /games the Photo content layer sits above the card's stretched link; a click on the photo area hits a non-link div (evidence: photoAreaClickReachesLink=false, textAreaClickReachesLink=true). Users must click the text area. Long-standing (Photo.tsx line from 2026-07-23), not a regression.

## Likely source
`client/src/components/Photo.tsx` children wrapper `position: relative; zIndex: 1` vs `client/src/components/ui.tsx` CardLink `.stretched-link` (z-index 1, earlier in DOM). Likely affects other cards combining Photo children with CardLink.

## Proposed minimum fix (not applied)
Give the wrapper `pointer-events: none` (re-enable on interactive children such as SaveButton) or raise the stretched link with `.stretched-link-above` on controls.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
