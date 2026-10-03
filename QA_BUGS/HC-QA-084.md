# HC-QA-084 — Images: no responsive variants in local mode, third-party hero hot-links, upload validation

Severity: P3. Category: PERFORMANCE. Status: OPEN — not fixed (Phase 10 findings inventory only).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Heroes (/, /home, /for-venues, auth pages), cards, /api/uploads
- **Actor:** All
- **Viewport / browser:** 390/1280; Chromium

**Steps**

1. Inspect hero/card image sources and sizes; upload large/invalid files via the local fallback.

- **Expected:** Viewport-appropriate image sizes; first-party assets; content-validated uploads.
- **Actual:** Heroes hot-link images.unsplash.com at w=1600-1920 for every viewport (no srcset/sizes), loaded before consent; /become-a-host hero AVIF is 2000px wide in a 390px slot. Photo component renders a single src per variant (no srcset). Local /api/uploads stores originals unresized (4000×3000 2.3 MB PNG) and trusts the client MIME type (13-byte text file named .jpg accepted). UI says 'up to 10MB' while /api/media/upload limit is 8 MB. (R2/AVIF variant pipeline itself BLOCKED — not configured in isolation.)
- **Evidence:** Sweep imgs/broken fields; components/Photo.tsx:74-80; routes/uploads.ts:37-38; routes/media.ts:330.
- **Root cause (if known):** —
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).
