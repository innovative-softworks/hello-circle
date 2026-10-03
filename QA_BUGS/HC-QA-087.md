# HC-QA-087 — Email copy inconsistencies and concurrent valid sign-in links

Severity: P3. Category: CONTENT. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Transactional emails (local SMTP sandbox)
- **Actor:** Resident, vendor
- **Viewport / browser:** Mailpit

**Steps**

1. Request two magic links, a resident reset and a vendor reset.

- **Expected:** Consistent brand name; requesting a new link invalidates older ones (hardening).
- **Actual:** Subjects alternate 'Hello Circle' and 'HelloCircle'. Two magic links requested back-to-back were both valid (each single-use, 15-min expiry). Unknown-email reset correctly sends nothing and returns 200. No token-bearing content in server logs.
- **Evidence:** Mailpit messages; /api/guest/verify on both tokens → 200/200; backend output scan 0 token-like strings.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
