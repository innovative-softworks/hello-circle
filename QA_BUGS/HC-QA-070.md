# HC-QA-070 — Header menus do not expose expanded state; active nav item not exposed

Severity: P2. Category: ACCESSIBILITY. Status: OPEN — not fixed (Phase 10 findings inventory only).
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
