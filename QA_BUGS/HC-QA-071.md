# HC-QA-071 — Form field borders fail non-text contrast in both themes

Severity: P2. Category: ACCESSIBILITY. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** All inputs/selects/textareas
- **Actor:** Low-vision users
- **Viewport / browser:** Light + dark tokens

**Steps**

1. Compute contrast of --color-input-border against page/surface backgrounds.

- **Expected:** >= 3:1 for the visual boundary of form fields (WCAG 1.4.11).
- **Actual:** Light #d8d4cb on #fbfaf7 = 1.42:1, on #ffffff = 1.48:1. Dark #3b423d on #15181a = 1.73:1, on #1d2220 = 1.56:1.
- **Evidence:** client/src/index.css :root and :root[data-theme=dark] tokens; computed with WCAG relative-luminance formula (scratch contrast.py).
- **Root cause (if known):** Border tokens tuned for aesthetics.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
