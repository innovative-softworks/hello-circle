# HC-QA-075 — Cumulative Layout Shift ~0.22 on almost every route (footer jumps as route content loads)

Severity: P2. Category: PERFORMANCE. Status: OPEN — not fixed (Phase 10 findings inventory only).
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
