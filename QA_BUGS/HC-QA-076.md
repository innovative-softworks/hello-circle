# HC-QA-076 — Backend saturates at ~20 requests/second under mixed browse load

Severity: P2. Category: PERFORMANCE. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** API (browse/search/detail mix)
- **Actor:** All
- **Viewport / browser:** Local load test, isolated exploration DB with bulk volume

**Steps**

1. Run 10, 25, 50 concurrent virtual users for 20 s each on a browse/search/detail mix (no logins, no payments).

- **Expected:** Latency stays acceptable at small concurrency; no saturation at 50 users.
- **Actual:** Throughput plateaus ~17-23 rps at ~90% of one CPU core; p95 1.26 s @10, 4.16 s @25, 5.77 s @50; search p95 6.5 s @50; 0 errors/5xx; MySQL connections stable at pool limit 10; process RSS grew 411 MB → 1.09 GB and stayed after load. Caveats: dev server (tsx, uncompiled) and concurrent browser sweep traffic — re-measure on a compiled build before concluding.
- **Evidence:** load.mjs output; load-res.txt (ps + Threads_connected samples).
- **Root cause (if known):** CPU-bound per-row serialization (HC-QA-073) and full-list endpoints (HC-QA-074); search scans.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
