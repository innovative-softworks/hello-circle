# HC-QA-074 — Pages download entire activity/Circle lists; duplicate and unnecessary requests

Severity: P2. Category: PERFORMANCE. Status: OPEN — not fixed (Phase 10 findings inventory only).
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
