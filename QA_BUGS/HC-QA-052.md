# HC-QA-052 — Vendor signup cannot be completed by keyboard or screen reader (vendor type tiles are mouse-only)

Severity: P1. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /vendor/signup step 2 'About your place'
- **Actor:** Prospective vendor (anonymous)
- **Viewport / browser:** All widths; Chromium

**Steps**

1. Open /vendor/signup, complete step 1 (name, email, password) and Continue.
2. On step 2, try to reach 'What are you?' (Community hall or Centre / Sports club) with Tab.
3. Fill every other field and tick terms.

- **Expected:** The required vendor-type choice is reachable and operable by keyboard (radio group or buttons with aria-pressed) and announced by screen readers.
- **Actual:** The two tiles are <div onClick> with no role, tabIndex or key handler; Tab skips them. 'Create vendor account' stays disabled because formComplete requires vendorType, so keyboard-only and screen-reader users cannot create a vendor account. Tiles also hard-code background #fff (white tile in dark mode).
- **Evidence:** pages/VendorSignup.tsx:393-431 (div onClick={() => setVendorType(...)}); :221 formComplete requires vendorType; Playwright: button stayed disabled until the tile was mouse-clicked; screenshot shots/vsignup-2.png.
- **Root cause (if known):** Non-semantic clickable div; ui.tsx:35 already ships a helper for keyboard-operable regions but it is not used here.
- **Why this severity:** WCAG 2.1.1 (Keyboard) / 4.1.2 failure that blocks an entire onboarding journey (vendor acquisition).
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** Required vendor-type choice built from `<div onClick>` tiles (no role, tabindex or key handler); `formComplete` requires it, so keyboard/SR users could never enable submit.
- **Fix:** Native radio group: `<fieldset>`/`<legend>What are you?</legend>` with a real `<input type=radio name=vendor-type>` inside each `<label class=choice-tile>` (visually hidden via `.visually-hidden-input`, never `display:none`); focus ring on the tile via `:has(:focus-visible)`; tile background uses the surface token instead of `#fff`. No tabindex hacks. (`client/src/pages/VendorSignup.tsx`, `client/src/index.css`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-052` desktop + mobile (Tab/Shift+Tab/Space/Enter only, end-to-end account creation) — FAIL before ("vendor type choice reachable by Tab") → PASS after. Note: the first red run hit a test-selector bug ("Continue with Google" matched /^Continue/); corrected, then fail-before was re-established against the pre-fix component. `HC-QA-052-SEMANTICS`: radio group named "What are you?", 2 radios, arrow keys move selection, all step-2 fields labelled. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Terms/marketing checkboxes and all step-2 fields already labelled (verified).
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
