# HC-QA-070 — Header menus do not expose expanded state; active nav item not exposed

Severity: P2. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03). Originally recorded in Phase 10.
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Global header (Explore ▾, Start ▾, Menu), account menu
- **Actor:** Screen-reader users
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Open the Explore dropdown and inspect the trigger.

- **Expected:** Disclosure triggers expose aria-expanded (and aria-controls); current page indicated with aria-current.
- **Actual:** 0 elements with aria-expanded and 0 with aria-current on the page; no aria-haspopup/role=menu. Escape closes the menu (works).
- **Evidence:** paid.mjs/kbd.mjs output: Explore menu attrs {aria-expanded: null, aria-haspopup: null, aria-controls: null}; aria-current: none.
- **Root cause (if known):** Custom dropdowns without ARIA state.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 12 remediation

- **Fix:**
  - **Header:** the Explore, Start, notifications, account and mobile-menu triggers expose `aria-expanded` and `aria-controls` (panel ids `hc-*`). Navigation items expose `aria-current="page"` (23 targets). "My Life" is current on `/my-life` too.
  - **Mobile tab bar:** navigating tabs expose `aria-current`; the Explore and Start sheet triggers expose `aria-expanded` and `aria-haspopup="dialog"`.
  - **Dashboard sidebar:** the current section exposes `aria-current="page"`.
  - Escape now closes header disclosures and returns focus to the trigger (HC-QA-098).
- **Regression:** `product-a11y-c.spec.ts` HC-QA-070 checks desktop and mobile, including dynamic state changes on navigation. `product-a11y-d.spec.ts` checks the vendor sidebar. Both fail before and pass after.
