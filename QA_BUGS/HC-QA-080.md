# HC-QA-080 — Circle page polish: stale member copy, empty section, grammar, Manage overview misses requests

Severity: P3. Category: UX. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /circles/:id, /manage/circles/:id
- **Actor:** Member, organiser
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Join a Circle; view as member. As organiser open Manage Circle with a pending request.

- **Expected:** Copy reflects membership; no empty sections; pending requests visible on overview.
- **Actual:** Members still see 'Join the Circle and we'll let you know…'; 'Moments from this Circle' heading with an empty body; '1 people joining'; Manage Circle Overview does not surface pending join requests (only Members tab); approval-only Circle labelled 'PUBLIC CIRCLE'.
- **Evidence:** circle4/circle5/circle7 outputs; circle-poll-form.png.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
