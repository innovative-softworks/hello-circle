# HC-QA-058 — Vendors are never told their account was received or approved

Severity: P2. Category: FUNCTIONAL. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /vendor/signup → admin approval
- **Actor:** Vendor, Admin
- **Viewport / browser:** API + Mailpit sandbox

**Steps**

1. Sign up as a vendor.
2. Admin approves the vendor account and the listing.
3. Inspect the local SMTP sink.

- **Expected:** Vendor receives an acknowledgement on signup and an 'approved — you can now log in' email; admins are told a vendor is waiting.
- **Actual:** No email was sent at signup, on vendor approval, or on listing approval (only resident 'Confirm your email' messages exist). The signup success page says 'Once approved, log in' — the vendor has no way to know when that happens.
- **Evidence:** Mailpit inbox after signup+approval: 3 messages, all resident verification; server/src/routes/admin.ts:84 PUT /vendors/:id/status has no sendMail.
- **Root cause (if known):** Missing transactional emails in the vendor onboarding path.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** No transactional email existed for vendor application or approval.
- **Fix:** Acknowledgement email on both vendor signup paths (password + Google) via the existing `sendMail`; approval email only on a real transition into `approved` (`UPDATE … WHERE status <> ?`, so retries/concurrent approvals send at most once; same-status calls stay 200; audit behaviour unchanged). No secret-bearing links (login URL only). QA-only mail observer (`setQaMailObserver`, active only under NODE_ENV=test + QA_E2E_ENABLED) lets the guarded harness assert attempted mail without SMTP. (`routes/auth.ts`, `routes/admin.ts`, `email.ts`, `tests/integration/backend.ts`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-058` signup acknowledgement FAIL before (0 mails) → PASS (1, correct recipient/subject, link origin = CLIENT_URL, no token). Approval: 4 approve calls (3 concurrent) → exactly 1 approval email; suspend sends none; unknown vendor 404. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Also re-verified against the local Mailpit sink in the exploration stack (see QA_INTEGRATIONS.md).
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
