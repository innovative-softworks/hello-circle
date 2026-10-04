# HC-QA-072 — Dark-mode text contrast failures and theme-bypassing hard-coded colors

Severity: P2. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03). Originally recorded in Phase 10.
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Dark theme across app; restricted Circle page; footer; vendor signup tiles
- **Actor:** Dark-mode users
- **Viewport / browser:** Dark color scheme 390/1280; Chromium

**Steps**

1. Enable dark mode (OS or toggle) and view Circle (restricted), links, danger buttons, footer.

- **Expected:** Text >= 4.5:1, large text/UI >= 3:1 in both themes.
- **Actual:** Dark: --color-green #1e7a4c used for text/links on bg = 3.35:1; --color-orange text 3.44-3.80:1; white on --color-danger #e37272 = 3.04:1. Light: orange on bg 4.49:1. 156 hard-coded hex colors in 66 TSX files bypass theming, e.g. restricted Circle description #3B423C ≈ 1.72:1 in dark (nearly invisible, screenshot), footer tagline #8A928B on #f6f4ef = 2.91:1 (light), HelloCircle wordmark low contrast on dark header, vendor tiles #fff.
- **Evidence:** contrast.py output; screenshots dark-390-circles_78d9…png; pages/CircleDetail.tsx:568; components/Footer.tsx:71.
- **Root cause (if known):** Dark tokens reuse light brand colors for text; inline literals.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 12 remediation

- **Fix (tokens first, no blanket brightening):**

| Change | Before | After |
|---|---|---|
| Green text (26 usages) → existing `greenText` token | dark 3.35 | dark 9.99, light 7.35 |
| Orange text (14 usages) → `orangeDark` | dark 3.44–3.80, light 4.49 | dark 8.04, light 5.60 |
| New `dangerSolid` for filled danger buttons | white on `#e37272` 3.04 | white on `#b3261e` 6.54 |
| 24 hard-coded `#3B423C` / `#8A928B` → `textSoft` / `faint` | restricted Circle description 1.72 in dark, footer tagline 2.91 | follow the theme |
| Wordmark in dark theme → `BrandLogo` picks `Logo-dark.svg` | 1.11 | 14.9 |

  Brand colours as backgrounds are unchanged.
- **Regression:** `product-a11y-e.spec.ts` checks the `greenText`, `orangeDark`, `textSoft`, `faint`, `mutedLight` and `danger` tokens against the background, white on `dangerSolid`, and the themed logo. It fails before and passes after.
