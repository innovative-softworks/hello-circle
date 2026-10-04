# HC-QA-098 — Header menus (Explore, Start, notifications, account, mobile menu) did not close on Escape

Severity: P3. Category: ACCESSIBILITY (keyboard). Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03).
Found while writing the HC-QA-070 regression. The Phase 10 note that "Escape closes the menu" did not hold for the header disclosures.

- **Steps:**
  1. Open the Explore menu (or Start, the notifications panel, the account menu, or the mobile menu).
  2. Press Escape.
- **Expected:** The menu closes and focus returns to its trigger (WCAG 2.1.1 / 2.4.3 practice for disclosures).
- **Actual:** Nothing happened; only an outside click closed them.
- **Fix:** `client/src/components/Header.tsx`. While any header disclosure is open, Escape closes it and focuses its trigger (found via its `aria-controls`). It stays out of the way when a modal dialog is open, since dialogs handle their own Escape.
- **Regression:** `product-a11y-c.spec.ts` HC-QA-070 asserts that Escape sets `aria-expanded="false"` and returns focus to "Explore".
