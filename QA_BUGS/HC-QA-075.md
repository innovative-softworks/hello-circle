# HC-QA-075 — Cumulative Layout Shift ~0.22 on almost every route (footer jumps as route content loads)

Severity: P2. Category: PERFORMANCE. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 13, 2026-10-04). Originally recorded in Phase 10.
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** All routes
- **Actor:** All
- **Viewport / browser:** Production build, 390 and 1440; Chromium

**Steps**

1. Load any route cold and observe layout-shift entries.

- **Expected:** CLS < 0.1.
- **Actual:** CLS 0.20-0.28 on most routes (0.43 on /explore mobile); LCP element is frequently the footer tagline, i.e. the footer paints first and is pushed down when the lazily loaded page renders.
- **Evidence:** vitals.mjs (prod build): e.g. home mobile CLS 0.281, games 0.278, circle 0.224, my life 0.231, vendor 0.225; LCPel='P: not affiliated with any council…'. App.tsx renders <Footer/> outside the route <Suspense> with main minHeight 70vh.
- **Root cause (if known):** Footer outside the Suspense boundary + spinner fallback of different height.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 13 remediation

**Measured** with `tests/integration/specs/perf-p13.spec.ts` (measurement only): production build, Chromium, Phase 10 throttling (4× CPU, 150 ms latency), each route loaded cold. Before = the committed code (`bfc1fcd`); after = Phase 13. This is the local production build, not staging (staging isn't provisioned).

| Route | Mobile 390 before → after | Desktop 1440 before → after |
|---|---|---|
| /home | 0.218 → **0** | 0.225 → **0.002** |
| /explore | 0.218 → **0** | 0.074 → **0.002** |
| /games | 0.218 → **0** | 0.176 → **0.002** |
| activity detail | 0.218 → **0** | 0.150 → **0.002** |
| /circles | 0 → 0 | 0.152 → **0.002** |
| /my-life | 0.112 → **0** | 0.003 → 0.003 |
| /profile | 0 → 0 | 0.054 → **0.003** |
| /login | 0 → 0 | 0.004 → 0.004 |

- **Largest contributor (before):** `footer` on every affected route. It's rendered outside the route's Suspense boundary under a 70vh `main`, so it painted first and was pushed down when the page arrived.
- **Fix:** `main` now fills at least the viewport (`min-height: 100vh`), so the footer starts below the fold and only ever moves off-screen. This is one line in `App.tsx`, with no change to page content.
- **Trade-off:** on very short pages the footer now sits one scroll down.
- **Remaining:** a header-nav sub-pixel shift (0.002) is far below the 0.1 "good" threshold.
