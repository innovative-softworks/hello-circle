# HC-QA-064 — My Life tells a signed-in user to 'Sign in' when the profile request fails

Severity: P2. Category: UX. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /my-life
- **Actor:** Signed-in resident
- **Viewport / browser:** 390 mobile; Chromium

**Steps**

1. Sign in as a resident.
2. Simulate GET /api/residents/me returning 500 or timing out.
3. Open /my-life.

- **Expected:** An error state with retry; signed-in data and signed-out prompts never shown together.
- **Actual:** Shows 'Sign in to see your life … Sign in' while also listing the user's Circles and next plan.
- **Evidence:** errors.mjs run: [500]/[abort] /my-life main text; screenshot err-500-my-life.png.
- **Root cause (if known):** Profile fetch failure is treated as 'signed out' while other resident queries succeed.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** `GuestContext.refresh` treated ANY failure of `/guest/me` or `/residents/me` (incl. 500/timeout) as signed-out.
- **Fix:** `ApiError` carries `status`; only 401/403 sign the person out. Other failures keep the known session, set `loadError`, and My Life shows a retryable error ("You're still signed in") instead of the Sign in prompt. (`api/core.ts`, `GuestContext.tsx`, `pages/MyBookings.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-064` FAIL before → PASS (no Sign in, retry recovers greeting, session still valid). `-STATES`: session-check failure is an error; a real signed-out visitor still sees Sign in. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** —
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
