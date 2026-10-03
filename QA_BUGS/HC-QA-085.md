# HC-QA-085 — My Life 'Your month' counts a Circle membership as a plan attended; mobile layout gap

Severity: P3. Category: DATA. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /my-life
- **Actor:** Resident
- **Viewport / browser:** 390 mobile; Chromium

**Steps**

1. Join a Circle (no activities attended) and open My Life.

- **Expected:** Attendance stats reflect attended plans only.
- **Actual:** Shows '1 Plan attended · 1 Different activity' and 'Your rhythm: 1 active week' from a Circle join. At 390 the two stat cards sit in the right half with an empty left column.
- **Evidence:** components/MyLifeThisMonth.tsx:31-35; participation API returns one 'circle' entry; dark-390-my-life.png.
- **Root cause (if known):** Counts every non-cancelled participation entry dated <= today.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
