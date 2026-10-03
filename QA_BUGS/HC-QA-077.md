# HC-QA-077 — Client uses the UTC date as 'today' in 27 places (not Ireland time)

Severity: P3. Category: DATA. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Activity status ('Completed'), Home 'today' rails, host Manage past/upcoming, vendor schedules, My Life stats
- **Actor:** All
- **Viewport / browser:** Code + clock-emulated Chromium

**Steps**

1. Review client date logic; emulate Europe/Dublin at 00:30 IST (23:30 UTC previous day).

- **Expected:** Day-boundary logic uses Europe/Dublin, matching server irelandTime.ts.
- **Actual:** 27 call sites use new Date().toISOString().slice(0,10) (UTC). Between 00:00 and 01:00 Irish summer time, these treat 'today' as the previous day (e.g. activityStatus.ts marks Completed by UTC date). The Games list itself handled the boundary correctly in the emulation ('Today · 6:30 PM' at 00:30 IST).
- **Evidence:** client/src/activityStatus.ts:30; pages/Home.tsx:437,458,474,952; components/HostActivitiesTab.tsx:345,448; components/MyLifeThisMonth.tsx:28; tz.mjs output.
- **Root cause (if known):** Inconsistent date helpers; only 10 files use Europe/Dublin.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
