# HC-QA-060 — Sitemap and server meta advertise venue pages that the client redirects to /coming-soon

Severity: P2. Category: SEO. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /sitemap.xml, /centres/:id, /clubs/:id, /browse/centres, /browse/clubs
- **Actor:** Search engines
- **Viewport / browser:** Server HTML (production build served single-origin)

**Steps**

1. Fetch /sitemap.xml with VITE_LAUNCH_MODE=public.
2. Fetch a listed /centres/:id HTML.

- **Expected:** Pages that users cannot see are not in the sitemap and are not marked indexable.
- **Actual:** Sitemap lists /browse/centres, /browse/clubs and all 35 approved centres/clubs; server returns 200 with robots 'index, follow' and LocalBusiness JSON-LD for /centres/:id, while the SPA immediately redirects to /coming-soon.
- **Evidence:** server/src/ogMeta.ts generateSitemapUrls (~569-570 centres/clubs approved); SEO run: /centres/db3ae9db-… 200 robots=index, follow jsonld=LocalBusiness; sitemap counts centres 17, clubs 18, browse 2.
- **Root cause (if known):** Server SEO layer is unaware of the client-side venue gate.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
