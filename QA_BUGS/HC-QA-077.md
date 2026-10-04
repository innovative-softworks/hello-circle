# HC-QA-077 — Client uses the UTC date as 'today' in 27 places (not Ireland time)

Severity: P3. Category: DATA. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 13, 2026-10-04). Originally recorded in Phase 10.
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

## Phase 13 remediation

- **Re-tested:** reproducible. At 00:30 Irish summer time (23:30 UTC the evening before), yesterday's activity read "Open", not "Completed". All 27 UTC call sites were still present.
- **Fix (one abstraction, not scattered offsets):** new `client/src/irelandDate.ts`, matching the server's `irelandTime.ts`:
  - `irelandToday()`, `irelandDaysFromToday()`, `irelandMonthStart()` and `irelandDateKey()` (Europe/Dublin via `Intl`);
  - `addDays`, `addMonths`, `daysBetween` and `weekdayOf` (pure calendar arithmetic);
  - `occurrenceDates`.
- **What changed:**
  - All 27 UTC `toISOString().slice(0, 10)` sites now use it: activity status, Home rails, host Manage, vendor schedules and bookings, My Life, Explore/Free-time/Ask/local "today" badges, and the My Bookings today/tomorrow split.
  - So do the device-local "today" helpers: the Games/Circles server date filters (Phase 12), programme detail, the booking calendar start, and the Games/browse "when" filters.
- **Found along the way:** **HC-QA-100 (P1)**, the same root cause in the schedule builders, fixed with `occurrenceDates`.
- **Not changed (by design):** display formatters and "in N days" labels that build local midnight and read it back with *local* getters. They're self-consistent and correct on any device in Ireland; they can't produce the shift.
- **Regression:**
  - `client/src/irelandDate.test.ts` covers GMT, IST, the midnight boundary either side, both DST changeovers, and month/year/leap arithmetic.
  - The `activityStatus.test.ts` Ireland-boundary cases **fail before** and pass after.
  - `client/src/irelandDate.guard.test.ts` fails on the pre-fix sources (27 lines) and passes now.
  - All pass under 5 device timezones (Europe/Dublin, UTC, Asia/Kolkata, America/Los_Angeles, Pacific/Kiritimati).
