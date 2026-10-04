# HC-QA-073 — Unbounded list endpoints with per-row queries (N+1)

Severity: P2. Category: PERFORMANCE. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03). Originally recorded in Phase 10.
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

## Phase 12 remediation

- **Model (one, documented):** keyset/cursor pagination, in `server/src/pagination.ts`.
  - `limit` defaults to 50, maximum 100; larger values are clamped, non-integers or values < 1 return 400.
  - `cursor` is opaque; a malformed one returns 400.
  - The body stays a JSON array (backward compatible); the next cursor is in `X-Next-Cursor`, absent on the last page.
  - Each query has a total order with an id tie-breaker.
- **Activities** (`GET /api/games`): visibility, lifecycle and `publish_at` stay inside the paginated SQL query, so nothing is fetched and then filtered. Server-side filters: `q`, county, category, date window, `timeFrom`, weekend, price range, skill.
- **Circles** (`GET /api/circles`): server-side `q`, county and activity; the per-row full-vs-teaser privacy rule is unchanged.
- **Notifications** (`GET /api/residents/me/notifications`): always scoped to the authenticated resident; `X-Unread-Count` gives the true unread total for the header badge.
- **Client:**
  - Games, Circles and the Profile inbox use "Load more", with loading, end-of-list and error-with-retry states.
  - A failed next page never replaces loaded results.
  - An empty filtered page never claims "no results" while more exist.
  - Filter options come from everything seen so far.
  - Limitation: the availability filter and the non-date sorts (recommended, needs, price) apply over loaded results.
- **Measured** (same machine and dataset: 2,000 activities, 300 Circles, 2,000 notifications; `server/src/routes/paginationPerf.test.ts`; query count = `db.prepare()` calls):

| Endpoint | Before | After |
|---|---|---|
| Activities | 2,000 records, 1.96 MB, 329 ms, 4,001 queries | 50, 49 KB, 18 ms, 101 |
| Circles | 300, 147 KB, 244 ms, 2,101 | 50, 25 KB, 42 ms, 351 |
| Notifications | 2,000, 320 KB, 4 ms, 1 | 50, 8 KB, 2 ms, 2 |

  Per-row serialisation lookups remain but are now bounded by the page size. HC-QA-074/075/076 are tracked separately.
- **Regression:**
  - `server/src/routes/pagination.test.ts`: no duplicates, no missing records, stable order, end condition, filters and search, visibility (private, Circle-only, draft, scheduled, cancelled and past never leak), per-user isolation including forged cursors, invalid parameters, and an insert between pages.
  - `product-p12-a.spec.ts` HC-QA-073-UI: Games Load more, a failed next page keeps 50 loaded results, retry, end reached at 75.
  - `product-p12-b.spec.ts` HC-QA-073-NOTIFICATIONS.

  All fail before and pass after.
