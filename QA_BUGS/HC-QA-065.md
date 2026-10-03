# HC-QA-065 — Page title never changes during in-app navigation

Severity: P2. Category: ACCESSIBILITY. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** All routes (SPA)
- **Actor:** All users, screen-reader users, browser history/tabs
- **Viewport / browser:** All; Chromium

**Steps**

1. Open any page, then navigate within the app (e.g. Home → Games → activity).

- **Expected:** Each route sets a descriptive document.title (WCAG 2.4.2).
- **Actual:** Every in-app route keeps 'Hello Circle — community centres & sports clubs in Ireland' (1 distinct title across 274 sweep rows). The server injects per-route titles only on a hard load.
- **Evidence:** grep document.title in client/src: 0 hits; sweep results: titles distinct = 1; server ogMeta.ts injectOgTags sets titles on full page load only.
- **Root cause (if known):** No client-side title management.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
