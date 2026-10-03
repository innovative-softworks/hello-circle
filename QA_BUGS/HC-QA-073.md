# HC-QA-073 — Unbounded list endpoints with per-row queries (N+1)

Severity: P2. Category: PERFORMANCE. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** GET /api/games, /api/circles, /api/residents/me/notifications
- **Actor:** All
- **Viewport / browser:** API

**Steps**

1. Seed ~2,000 activities, 300 Circles, 2,000 notifications in the isolated exploration DB.
2. Call the list endpoints.

- **Expected:** Paginated or bounded results; constant query count per request.
- **Actual:** /api/games returns all 2,003 rows (1.96 MB, p50 ~320 ms single-user); /api/circles 303 rows (190 KB, ~230 ms ≈ 0.75 ms/row); notifications returns all 2,001 rows (322 KB). At 5 Circles/3 games all were <5 ms, i.e. cost scales linearly with data.
- **Evidence:** routes/games.ts:202 Promise.all(rows.map(toGameJson)) (~4 awaits per row); routes/circles.ts:276-281 canViewCircleFull + toCircleJson per row; perf.mjs output before/after bulk seed.
- **Root cause (if known):** List serialization does per-row lookups; no LIMIT/cursor. Chat is correctly capped at 200.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
