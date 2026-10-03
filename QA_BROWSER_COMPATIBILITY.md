# HelloCircle — Browser compatibility

## Phase 11A update — 2026-10-03 (current)

Production build (`QA_PROD_BUILD=1 npm run qa:browsers`):

| Engine | Result |
|---|---|
| Chromium | 53/53 |
| Firefox | 53/53 |
| WebKit | 49 passed; failure is BRW-2 only (known), plus 1 intentional skip |

New `product-deploy` batch (HC-QA-090/094):

| Test | Result |
|---|---|
| STALE-TAB | Passes in Chromium and Firefox. Skipped in WebKit only, because WebKit keeps a failed module record for an identical URL; a real deploy changes the URL |
| PERSISTENT | Passes in all three engines |
| NAVIGATE-AWAY | Passes in all three engines |

**Real deploy simulation** (rebuild with new hashes + server restart + old tab navigates in-app) on an isolated stack: Chromium, Firefox and WebKit each do **1 reload**, the route renders, never blank.

HC-QA-066 failed in Firefox and WebKit with the first HC-QA-090 fix. That was a real regression, HC-QA-094, now fixed.

## Phase 11 update: production build, 2026-10-03

`QA_PROD_BUILD=1 npm run qa:browsers` was added to the harness. It builds the client once, using the isolated config with no `client/.env` and providers disabled, then serves that production bundle through `vite preview` with the same API proxy. The test journeys are the same as the dev-server runs.

**BRW-1 is settled as a dev-server artifact.** WebKit `LC-UI-DESKTOP-HOST` passed on the production build **5/5**. It had failed 3/6 on the dev server.

| Engine (production build) | Result |
|---|---|
| Chromium | **PASS:** 50/50 |
| Firefox | **PASS:** 47/48 on the first pass. `LC-UI-TABLET` timed out once, then the responsive batch (TABLET, MOBILE, MOBILE-CONSENT) passed 2/2 reruns. It is a timing flake, not a defect |
| WebKit | **PASS with BRW-2:** 47/48. The only failure is `HC-QA-001-CONSENT`, the known Safari plain-Tab convention (BRW-2), unchanged |

**New finding.** The "no recovery UI if a lazy chunk fails" note under BRW-1 is now reproduced on the production build as **HC-QA-090 (P2)**. A tab that was open before a deploy goes blank on its next in-app navigation, because old chunk URLs return `200 text/html`.

## Phase 10A update — 2026-10-03

Playwright Firefox (firefox-1543) and WebKit 26.6 were installed (`npx playwright install firefox webkit`, approved in the Phase 10A brief). The new `npm run qa:browsers` mode runs the critical journeys per engine against the real isolated stack (`QA_BROWSER=chromium|firefox|webkit`). Stripe financial batches were not repeated per engine.

| Engine | Result |
|---|---|
| Chromium | **PASS:** 50/50 |
| Firefox | **PASS:** all batches green. In one run a batch's web server timed out at startup (0 tests executed); that batch then passed 3/3 consecutive runs |
| WebKit | **PASS with notes:** all critical journeys pass; see browser-specific notes below |

Firefox emulates mobile viewport and touch without `isMobile` (unsupported by the engine).

**Browser-specific findings (confirmed and fixed):**
- **HC-QA-088 (WebKit):** Modal/dialog focus trap escaped because Safari's default Tab skips buttons. Fixed: the trap cycles focus itself.
- **HC-QA-089 (most visible in WebKit):** after a step change, focus stayed on the bottom button and Safari's Tab then left the page. Fixed: focus moves to the new step heading.

**Browser-specific notes (not app defects):**
- **BRW-1 (WebKit, dev server only):** LC-UI-DESKTOP-HOST intermittently (3/6) logs `TypeError: Importing a module script failed` from the Vite dev server's dependency optimizer during lazy route loads; it passes on rerun. Verify on a production build in staging. Separately (post-MVP): there's no recovery UI if a lazy route chunk fails to load, e.g. a stale tab after a deploy.
- **BRW-2 (WebKit, platform convention):** the existing HC-QA-001-CONSENT test presses plain Tab from "Learn more" to the consent buttons. Safari's macOS default reaches buttons with Option+Tab, and that path was verified to reach and operate the banner. The existing regression is unchanged (still green in Chromium/Firefox).
- **BRW-3 (Firefox/WebKit):** cold Vite compilation on each batch's first page load is slower, so the non-Chromium time budgets were raised (90 s test, 10 s expect); retries remain 0.

Still not covered: real iOS Safari, Android Chrome devices, and production-build cross-browser runs (staging).

## Phase 10 baseline (historical)

| Engine / profile | Status | Coverage |
|---|---|---|
| Chromium desktop (Playwright Chromium, headless; Chrome 1440×900 / 1280) | **PASS** | All Phase 10 journeys and sweeps; Stripe hosted checkout (gate); auth; consent; uploads (vendor); date/time inputs; fixed navigation |
| Chromium mobile emulation (320–430, `isMobile` + touch) | **PASS** | Width sweep, bottom tab bar + consent (HC-QA-001 gate), mobile Stripe journey (gate) |
| Google Chrome (real, with extensions) | Partial | Landing and signup only. Abandoned because a password-manager extension's overlay blocked screenshots and scripting on password fields. Not an application defect |
| Firefox (Gecko) | **BLOCKED** | Playwright Firefox is not installed on this machine. Installing requires downloading browser binaries, which was not approved in this checkpoint |
| WebKit / Safari equivalent | **BLOCKED** | Playwright WebKit not installed (same reason). No macOS Safari automation configured |
| Mobile Chrome (real device) | **BLOCKED** | No device/emulator farm available |
| Mobile Safari / iOS WebKit | **BLOCKED** | As above |

**No browser-specific defects were recorded**, because only one engine could be exercised. Do not read this as cross-browser PASS.

## Highest-risk areas to verify first in Firefox and WebKit

1. Native date and time inputs: the host activity form, programme session and experience departure use `type=date/time`. Safari's pickers and value formats differ.
2. The fixed bottom tab bar with `env(safe-area-inset-bottom)`, and the consent banner (HC-QA-001 class) on iOS Safari's dynamic toolbar.
3. Cookie/session handling on the Stripe redirect and return (ITP on Safari), and the single-origin session cookies.
4. The `position: sticky` right rail on Circle and activity detail; `view-transition` / shared-element animations (Chromium-only API; check the fallback).
5. AVIF hero images (`/illustrations/host-hero.avif`): older Safari versions lack AVIF.
6. The file upload `<label>`-wrapped hidden input (067) behaves differently per engine.

**Next step:** `npx playwright install firefox webkit` (needs approval to download), then run the width sweep and keyboard scripts with `browserName` set to `firefox` and `webkit`.
