# HC-QA-062 — Without R2 configured, resident hosts cannot upload any image

Severity: P2. Category: INTEGRATION. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Activity cover / Circle cover / avatar upload (SingleImageUpload)
- **Actor:** Host (resident)
- **Viewport / browser:** API + UI; local media mode

**Steps**

1. Run with MEDIA_PROVIDER=local (no R2), as in the QA profile.
2. As a resident host, add a cover photo to an activity.

- **Expected:** Upload works in every supported configuration, or the UI explains uploads are unavailable.
- **Actual:** /api/media/upload → 503 'Cloud media storage is not configured'; /api/media/authorize → 503; client then falls back to POST /api/uploads, which requires a vendor/admin session → 401 'Login required'. Vendors can upload (local disk); residents cannot.
- **Evidence:** client/src/api/media.ts:97-101 (fallback chain); server/src/routes/uploads.ts:43 requireVendorOrAdmin; curl as host: 503, 503, 401; as vendor: 201.
- **Root cause (if known):** Local fallback path predates resident-owned media. Production with R2 is unaffected, but any staging environment without R2 will have broken host uploads.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** In local media mode `/api/media/upload` returned 503 and the client fell back to the vendor/admin-only legacy uploader → 401 for residents.
- **Fix:** When R2 isn't configured, `/api/media/upload` (after its existing per-entity permission check) stores a validated original locally (`server/src/localUploads.ts`: magic-byte sniffing, declared type must match, random name, exclusive create). Restricted media (Circle covers) goes to non-static `private-uploads/` and is streamed only via the membership-checked cover endpoint. Legacy `/api/uploads` stays vendor/admin-only (existing gate unchanged) and now also verifies magic bytes. Cloud media remains a separate staging integration.
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-062` FAIL before (503) → PASS (201, served image/png, saved and returned on the activity). `-BOUNDARIES`: fake image 400 (no paths leaked), foreign resident/guest denied, restricted cover 200 for organiser / 403 for guest and non-member / not under /uploads (404), missing cover 404. stage-b-media authorization gate unchanged and green. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Adjacent: legacy uploader magic-byte check.
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
