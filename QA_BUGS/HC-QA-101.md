# HC-QA-101 — After HC-QA-073 pagination, some pages filtered only the first page of activities/Circles

Severity: P2 (silent truncation; a regression introduced by Phase 12, never deployed). Category: FUNCTIONAL / PERFORMANCE.
Status: FIXED LOCALLY — NOT DEPLOYED (Phase 13, 2026-10-04). Found in Phase 13 while re-testing HC-QA-074.

- **Cause:** Phase 12 bounded `GET /api/games` and `GET /api/circles` to one page (50 by default). A few callers still used the old whole-list wrappers and filtered client-side, so they now saw only the soonest 50 activities / first 50 Circles. Phase 12's tests didn't cover them because none of those surfaces had more than 50 rows.
- **Impact:**
  - **Centre page "Join a game":** loaded all activities and filtered by `centreId`, so a venue's activities outside the global first 50 vanished. Venue pages are gated today, so this wasn't live-visible.
  - **"More like this"** (activity detail) and **related Circles** (Circle detail) ranked a truncated sample. They also over-fetched: 50 rows downloaded to show 4, or 3 (the HC-QA-074 waste).
- **Checked and unaffected:**
  - Explore's category preview shows 10 items from a name-sorted list, the same as before.
  - Home rails use soonest-first samples, which is what a discovery rail shows anyway (documented in HC-QA-074).
- **Fix:**
  - New server filter `GET /api/games?centreId=` inside the same paginated, visibility-filtered query.
  - CentreDetail asks the server for the venue's activities (`limit=100`).
  - "More like this" asks for two small server-filtered sets (same activity, then same county; 12 each).
  - Related Circles ask for 4, or 8 as a fallback.
- **Regression:** `server/src/routes/pagination.test.ts` HC-QA-101 places a venue's 3 activities behind 2,000 earlier ones plus a draft at the same venue. It **fails before** (the first 50 global rows come back) and **passes after**: exactly the 3, never the draft.
