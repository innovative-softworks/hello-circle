# HC-QA-083 — Headings, skip link, live regions, touch targets

Severity: P3. Category: ACCESSIBILITY. Status: OPEN — not fixed (Phase 10 findings inventory only).
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
