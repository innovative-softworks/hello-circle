# HC-QA-078 — Host Manage: raw ISO dates, misleading 'Almost full', hidden publish, missing 'View'

Severity: P3. Category: UX. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /manage?tab=activities, host create confirmation
- **Actor:** Host
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Create activities in each state and open Manage → Activities.

- **Expected:** Human dates; status badges that match capacity; obvious Publish/Open bookings for drafts and coming-soon; a link to the public page after creating.
- **Actual:** Rows show '2026-10-03 · 18:30'; 'Almost full' (red bar) at 1 of 3 joined; Draft/Coming soon rows offer Share/Check-in/Post update but publishing is only inside Edit → STATUS; seven equal-weight buttons per row; post-create confirmation has Share/Add another date/Manage but no 'View activity'. Manage Circle plan rows show '—' for a plan that has a location.
- **Evidence:** screenshots manage-activities.png, host-created-*.png; circle7.mjs output.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
