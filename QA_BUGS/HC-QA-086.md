# HC-QA-086 — Soft 404s, duplicate meta descriptions, title casing, missing structured data

Severity: P3. Category: SEO. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Unknown routes, all public pages, /:county/:activity, experiences, programs
- **Actor:** Search engines
- **Viewport / browser:** Server HTML

**Steps**

1. Fetch HTML for public routes on the production build.

- **Expected:** 404 status for unknown routes; per-page meta descriptions; consistent titles.
- **Actual:** Unknown routes return 200 (noindex is set). <meta name=description> is the same generic sentence everywhere (og:description varies). Local landing title 'badminton in Dublin — HelloCircle'. No JSON-LD on experiences/programs. Positive: per-page titles/canonical (slug)/OG image on detail pages, Event JSON-LD on activities, private/approval Circles and drafts noindex/404, robots.txt disallows private surfaces.
- **Evidence:** seo.py output.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
