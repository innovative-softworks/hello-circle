# HC-QA-082 — Authentication surfaces: placeholder Apple option, silent disabled buttons, banner overlap, deep links

Severity: P3. Category: UX. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /signin, /signin/create, /vendor/signup, /login
- **Actor:** Resident, vendor
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Use the auth forms; open protected deep links while logged out.

- **Expected:** Only working sign-in options; disabled submit explains what's missing; deep link restored after login.
- **Actual:** 'Apple' button on every auth page only shows 'Sign-in with Apple is coming soon'. Submit stays disabled until terms are ticked with no hint. Desktop cookie banner covers the vendor-signup terms/marketing checkboxes. Vendor hero claims 'Join hundreds of venues and clubs already listed' (pre-launch). Logged-out /vendor/programs/:id → /login without returnTo → /vendor after login (deep link lost); /admin and /vendor produce nested returnTo '/login?returnTo=/login?returnTo=/admin' (still ends correctly). Unconfigured Google sign-in shows a clear message (good).
- **Evidence:** oauthmap.mjs, rt.mjs outputs; vsignup-2.png; components/AuthForms.tsx:35,185.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
