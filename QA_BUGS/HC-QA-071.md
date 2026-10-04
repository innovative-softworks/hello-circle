# HC-QA-071 — Form field borders fail non-text contrast in both themes

Severity: P2. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03). Originally recorded in Phase 10.
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

## Phase 12 remediation

- **Fix:** the shared token `--color-input-border` only, so every input, select and textarea inherits it:

| Theme | Before | After |
|---|---|---|
| Light | `#d8d4cb` (1.42:1 on bg, 1.48:1 on surface) | `#8a857a` (3.52 on bg, 3.67 on surface, 3.17 on panel) |
| Dark | `#3b423d` (1.73 / 1.56) | `#6b736d` (3.65 / 3.30) |

  The mobile token copy (`packages/design-tokens`) was updated to match. Focus rings (green outline) were already ≥ 3:1. Error borders use `danger` (7.0:1 light, 5.9:1 dark). Disabled controls are exempt.
- **Regression:** `product-a11y-e.spec.ts` measures the rendered input border against what's behind it, plus the tokens, in both themes. Rendered dark border: 3.35:1. It fails before and passes after.
