# HC-QA-067 — Image upload controls cannot be reached by keyboard

Severity: P2. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Activity cover, program cover, experience photos, Circle cover, avatar
- **Actor:** Keyboard users (host, vendor)
- **Viewport / browser:** All; Chromium

**Steps**

1. Tab through a page with 'Add photo'.

- **Expected:** The upload control is focusable and operable with Enter/Space; upload errors are announced.
- **Actual:** 'Add photo'/'Replace' are <label> elements wrapping an <input type=file style=display:none>; display:none removes the input from the tab order, so keyboard users cannot upload or replace photos. Upload error text is a plain <p> (not role=alert).
- **Evidence:** components/SingleImageUpload.tsx:81, 85-107; components/VendorImageUpload.tsx:186.
- **Root cause (if known):** Visually-hidden pattern uses display:none instead of a focusable hidden input or a button.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** Upload controls were `<label>`s wrapping a `display:none` file input — removed from the tab order.
- **Fix:** Real `<button>`s ("Add photo" / "Replace …") open a hidden file input; input reset after selection; upload errors are `role=alert`. Applied to SingleImageUpload (activity/programme/Circle covers), MultiImageUpload (experience/centre/club galleries) and the adjacent org-logo uploader. (`SingleImageUpload.tsx`, `VendorImageUpload.tsx`, `VendorOrg.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-067` FAIL before → PASS: Add photo reachable by Tab with visible focus, Enter and Space both open the file chooser, invalid upload error announced. `-VENDOR`: gallery Add photo is a native tabbable button and opens the chooser. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Profile avatar already used a button (unchanged).
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).

## Phase 13 — test synchronisation after the HC-QA-075 layout change (2026-10-04)

- **Observed:** after `main` became `min-height: 100vh` (HC-QA-075), this regression became intermittent on the Chromium production build.
  - Bisect: with only that change reverted, 6/6 passed; with it, 4 failures in 14 runs. Committed code: 5/5. Coalescing reverted alone: still 2/6 failures.
- **Diagnosed** with a temporary diagnostic spec (removed afterwards), 44 attempts:
  - Focus was **on the button** every time.
  - Fonts were already loaded (font-swap hypothesis rejected).
  - Tab-focusing the button, which sits within the 16 px `scroll-padding-bottom` of the viewport edge, starts Chromium's animated focus scroll of about 7 px.
  - Both observed failures were an Enter pressed **while that animation was still running**; Space, a moment later, always worked.
  - Why the taller `main` makes this window reachable when the old layout never hit it isn't fully explained.
- **Change (test only):** after tabbing to the control, the test waits until the focused control is at rest (position unchanged for 150 ms), then presses keys. The assertion is unchanged: Enter **and** Space must each open the file chooser, and the upload error must be announced.
- **Result:** 8/8 Chromium, plus Firefox and WebKit pass on the production build.
- **User impact assessment:** a person can't press Enter within the ~100 ms focus-scroll animation after a Tab; keyboard operation of the control is unchanged.
