# HC-QA-074 — Pages download entire activity/Circle lists; duplicate and unnecessary requests

Severity: P2. Category: PERFORMANCE. Status: FIXED LOCALLY / BOUNDED — NOT DEPLOYED (Phase 13, 2026-10-04). Originally recorded in Phase 10.
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /home, /games/:id, /circles/:id, every anonymous page
- **Actor:** All
- **Viewport / browser:** 390 mobile production build (4x CPU, 150 ms latency)

**Steps**

1. Open /home and an activity detail on the production build with the seeded volume.

- **Expected:** Rails and 'More like this' fetch a small, server-filtered set.
- **Actual:** /home and /games/:id each download the full /api/games (1.96 MB); /circles/:id downloads all county Circles (191 KB). Duplicate calls: /api/games/:id/participants ×2, /api/centres ×2 on Home. Anonymous visitors fire 5 authenticated calls that 401 on every page (/api/games/mine, /api/circles/mine, /api/residents/me/routine-suggestions, /api/favourites, /api/follows). googleSignIn chunk (154 KB) loads on Home for anonymous visitors even with Firebase unconfigured. Result: /home 2.9 MB transfer, mobile LCP ~5.7 s on / and /home.
- **Evidence:** netlist.mjs and vitals.mjs output; sweep api>=400 counters.
- **Root cause (if known):** Client-side filtering of full lists; eager auth-only queries.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 13 remediation

- **Whole-list downloads:** bounded by HC-QA-073 (Phase 12: 1.96 MB → 49 KB for the activities list at 2,000 rows).
  - The remaining whole-list callers now ask the server for small, filtered sets (HC-QA-101): "More like this" (12 + 12 instead of the full list), related Circles (4/8), and the centre page (`centreId`).
  - Home rails still use the first page (soonest 50). That's bounded, and it's what a discovery rail shows.
- **Duplicates:** measured with `perf-p13.spec.ts` (production build, throttled, cold load per route). Before → after:

| Route | Duplicate before | After |
|---|---|---|
| activity detail | `/api/games/:id/participants` ×2 (join card + participant list) | none |
| /home | `/api/centres` ×2 (county list + featured, both on mount) | none |
| /my-life | `/api/residents/me` ×3, `/residents/me/participation` ×2 | `/residents/me` ×2 |
| /profile | `/api/residents/me` ×3 | ×2 |

  Requests per route: activity detail 10 → 9, Home 12 → 11, My Life 23 → 21, Profile 10 → 9.
- **Fix (systemic, small):** `client/src/api/core.ts` `request()` coalesces identical **concurrent** GETs (no body, headers or signal) into one network request. Each caller gets its own copy, and nothing is cached once the response settles, so data is never stale.
  - `client/src/api/core.test.ts` covers this. Two cases fail on the old wrapper; the "never caches" and "never coalesces writes / custom headers / abortable" invariants pass either way.
- **Left alone on purpose:** the remaining `/residents/me` ×2 are sequential (the session context, then the page's own full-profile load), not accidental duplicates.
- **Anonymous 401s:** none observed any more (0 on every measured route).
