# HC-QA-001 — Mobile bottom navigation covers the cookie consent controls

Severity: P1 (UI — consent cannot be given/refused on mobile). Category: UX / layout.

## Status — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

The original regression is unchanged: `tests/smoke/application.spec.ts` QA-SMK-002 (chromium-mobile-mock).
- **Before:** FAIL — `locator.click` timed out because "`<nav aria-label="Primary" class="mobile-tab-bar">` subtree intercepts pointer events". Artifacts are in `test-results/hc-qa-001-before/` (screenshot, video, trace).
- **After:** PASS (`test-results/hc-qa-001-after/`).

## Measured layout (before → after)
Geometry was captured with a temporary hit-testing diagnostic, since removed. Files:
`test-results/hc-qa-001/geometry-{before,after}.json`.

| Viewport | Tab bar | Banner before | Before: overlap / buttons clickable | After: banner bottom / clickable |
|---|---|---|---|---|
| 320×568 | top 506, 62px | bottom 552, z 50 | 46px / no | 490 (16px above bar) / yes |
| 390×844 | top 782, 62px | bottom 828 | 46px / no | 766 / yes |
| 430×932 | top 870, 62px | bottom 916 | 46px / no | 854 / yes |
| 393×852 + simulated 34px safe area | top 756, 96px | bottom 836 | 80px / no | 740 / yes (no double count) |
| 390×500 (short) | top 438 | bottom 484 | 46px / no | 422 / yes |
| 844×390 (landscape) | top 328 | bottom 374 | 46px / no | 312 / yes |
| 820×1180 (tablet, tab bar ≤860px) | top 1118 | bottom 1164 | 46px / no | 1102 / yes |
| 1440×900 (desktop) | none | bottom 884 | 0 / yes | 884 (unchanged) / yes |

Chromium cannot emulate a real `env(safe-area-inset-bottom)`, so the safe-area row is simulated: the tab bar's bottom padding was enlarged by 34px, which is exactly what the inset does to it.

## Root cause
A combination of three things, confirmed by measurement:
1. **`CookieNotice`** used `position: fixed; bottom: 16px; z-index: 50`. It never adopted `--bottom-chrome`, the tab bar height that `BottomChromeSync` was already publishing (its own comment names the cookie banner as a consumer; only toasts used it). The tab bar is `z-index: 250`, so it covered the bottom 46px of the banner, which is where the buttons are. This affected every width up to the 860px tab-bar cutover, including tablet.
2. **Hard-coded offsets elsewhere in the same stack:**
   - `.mobile-join-bar` assumed a 64px tab bar (the real bar is 62px).
   - Between 861 and 900px, the join bar floated 64px above an empty bottom edge.
   - Browse's compare tray used `bottom: 0` under the tab bar.
   - The footer, which renders after `<main class="mobile-tab-bar-space">`, ended under the tab bar.
3. **Found while verifying:** `fadeUp` entrance animations used `fill-mode: both`. The retained end transform (an identity matrix) made the page wrapper the containing block for `position: fixed` descendants. So on activity/Circle/centre/club/programme/experience detail and booking pages, the `.mobile-join-bar` sat at the end of the content (y=2112 on an 844px viewport) instead of above the tab bar.

## Fix (reusable layout rule; no page-specific magic numbers)
- **`BottomChromeSync` publishes two measured values:**
  - `--bottom-nav` is the tab bar height. It includes `env(safe-area-inset-bottom)` via the bar's own padding; with no bar it falls back to the inset.
  - `--bottom-chrome` is the whole fixed bottom stack (the tab bar plus `.mobile-join-bar` / `[data-bottom-chrome]`).
  - It re-measures on route change, resize, bar resize, DOM mutation, and `animationend` / `transitionend`, coalesced to one measurement per frame.
- **Bars that sit on the nav use `bottom: var(--bottom-nav)`:** `.mobile-join-bar` and the Browse compare tray (which is also marked `data-bottom-chrome`).
- **Floating UI uses `bottom: calc(var(--bottom-chrome) + 16px)`:** the cookie banner (toasts already did).
  - The banner gets the new `zIndex.consent` (260) design token: above the mobile bars, below drawers and modals.
  - It also gets `max-height: calc(100dvh - var(--bottom-chrome) - 32px)` with internal scrolling, so both choices stay reachable on short viewports.
- **Footer:** `padding-bottom: var(--bottom-chrome)`, so it clears the chrome itself. On desktop this is 0 or the inset.
- **Entrance animation:** all 29 `fadeUp … both` became `… backwards`. The entrance looks the same, and no transform is left behind afterwards.
- **"Learn more"** in the banner went from a click-only `<span>` to a real `<a href="/cookies">`, so it's keyboard-reachable.
- **Consent semantics unchanged:** the same localStorage key and values, and GTM loads only on accept.

## Verification
- **Real QA environment** (`npm run qa:lifecycle -- --grep 'HC-QA-001'`, batch `lifecycle-ui-bottom-chrome`):
  - **CONSENT** (320×568, 390×844, 430×932, 390×420):
    - The banner sits above the tab bar, and both buttons hit-test reachable with touch height ≥32px.
    - Keyboard path: "Learn more" → Tab → "Necessary only" (visible focus ring) → "Accept".
    - Keyboard Enter on "Necessary only" rejects (rejected) and the body padding is restored.
    - Reopen via Cookie Policy "Change my cookie choice" (itself not obstructed), then tap Accept (accepted).
  - **STACK** (390×844, tablet 820, no-tab-bar 880):
    - Activity and Circle join bars sit flush on the tab bar, or on the bottom edge at 880.
    - The banner is above the join bar.
    - Join CTA and consent are both reachable, and `--bottom-chrome` equals the whole stack.
    - Joining through the join bar works.
  - **NAV:**
    - 5 tabs at 49px; tab navigation works; one tab shows the active state.
    - The Explore bottom sheet sits above the banner and its items are reachable.
    - At maximum scroll, content clears the banner (with it) and the tab bar (without it).
    - Desktop: no tab bar, banner 16px from the edge, no reserved bottom space.
- **Not UI-reachable here:** the Browse compare tray is behind the venue launch-gate carve-out (`/browse/centres` redirects to /coming-soon), so its fix is code-applied but not browser-verified.
- **No "cookie preferences / save preferences" UI exists** beyond the banner and the Cookie Policy "Change my cookie choice". Nothing was added.

## Original finding (historical)
Mobile 390×844, `/`, fresh visitor: the bottom navigation overlaps "Necessary only" / "Accept" and intercepts pointer events. Reported in `QA_REPORT.md` (Phase 1), with `CookieNotice.tsx` `zIndex: 50` vs `.mobile-tab-bar` `z-index: 250` as the likely source.
