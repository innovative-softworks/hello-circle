# HC-QA-083 — Headings, skip link, live regions, touch targets

Severity: P3. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03). Originally recorded in Phase 10.
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Multiple
- **Actor:** Assistive-technology users
- **Viewport / browser:** All; Chromium

**Steps**

1. Inspect headings/landmarks; keyboard from page top; trigger an inline error; measure targets on mobile.

- **Expected:** One H1 per page, no level skips, bypass mechanism, announced errors, targets >= 24px.
- **Actual:** No H1 on 12 screens (/my-life, /profile, /games/host, /manage all tabs, /manage/circles/:id, /vendor/signup, vendor program/experience editors, /host/:id not-found). Heading skips on /admin, /vendor, /my-life, /manage, /circles/:id, /landing. Home H1 accessible name 'Make things happennear you.' (missing space; same on /). No skip link (8 header controls first); consent buttons last in tab order. Inline payment/join errors not in a live region. Text links under 24px on mobile ('Get directions', 'Back', 'Forgot password?', category chips). Positive: main landmark on every page, all <img> have alt, visible focus outlines, keyboard sign-in works.
- **Evidence:** Sweep h1/headingSkips/smallTargets fields; kbd.mjs output.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 12 remediation

- **Skip link:** "Skip to main content" is the first Tab stop on every page. It's visually hidden until focused and moves focus to `<main id="main-content" tabindex="-1">`. It works after SPA route changes and doesn't interfere with dialogs.
- **Headings, fixed systemically:**
  - `ManageShell`'s title is the `H1` when no banner supplies one, which fixes Profile, Manage Circle and all non-overview dashboard tabs.
  - `GuidedFlow` takes `headingLevel={1}` for vendor signup and host activity creation.
  - Editor page titles are now `H1`, and the shared `SettingsSection` heading is `H2`.
  - The decorative auth photo caption is no longer a heading.
  - Dashboard card headings `h4` → `h3`; Manage Circle cards `h4` → `h2`; Profile sections re-levelled; My Life "Your rhythm" `h3` → `h2`.
  - The host not-found page has an `H1`.
  - The Home `H1` accessible name now reads "happen near", not "happennear".
- **Not changed:** inline-error live regions beyond the Phase 10A/11B fixes, and 24 px touch targets on small text links. Both remain tracked (P3).
- **Regression:** `product-a11y-c.spec.ts` and `product-a11y-d.spec.ts` check one `H1`, no level skips and one `<main>` across 16 public, 8 resident and 4 vendor/admin routes, plus the skip link. All fail before and pass after.
