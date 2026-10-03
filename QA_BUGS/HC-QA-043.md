# HC-QA-043 — A keyboard-focused control can sit hidden behind the mobile consent banner

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

`CookieNotice` publishes `--consent-reserve`, and `html { scroll-padding-bottom: calc(var(--bottom-chrome) + var(--consent-reserve) + 16px) }` makes focus moves and `scrollIntoView` stop above the tab bar, join bars and the banner. The bottom-chrome architecture is unchanged. Verified: a focused Cancel control on mobile My Life with the banner shown is visible and reachable; the HC-QA-001 suites stay green.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-043'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P2. Category: UX / accessibility (HC-QA-001 residual).
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-043'`. It must turn green after a fix without changing the assertion.

## Journey
Mobile booking journey (Parts 24-25)

## Expected
Focusing or scrolling a control into view never leaves it underneath fixed bottom UI (the consent banner or tab bar).

## Actual
On My Life at 390×844 with the consent banner shown, focusing a booking's Cancel button leaves it at y≈625–654, **under the banner** (the hit-test lands on the banner). The original HC-QA-001 regression and tap journeys stay green; this is about focus and scroll-into-view.

## Likely source
There's no `scroll-padding-bottom` for the fixed bottom chrome or the banner's height. `--bottom-chrome` (HC-QA-001) excludes the banner.

## Proposed minimum fix (not applied)
Publish the banner's height (e.g. `--consent-reserve`) and set `html { scroll-padding-bottom: calc(var(--bottom-chrome) + var(--consent-reserve, 0px) + 16px) }`.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
