# HC-QA-063 — Activity list shows a false 'no results' state when the API fails

Severity: P2. Category: UX. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /games
- **Actor:** Any visitor
- **Viewport / browser:** 390 mobile and desktop; Chromium

**Steps**

1. Simulate GET /api/games returning 500 or timing out.
2. Open /games.

- **Expected:** An error message with a retry, distinct from 'no sessions found'.
- **Actual:** Renders '0 games & sessions nearby' with filters — indistinguishable from a genuinely empty area. No retry.
- **Evidence:** errors.mjs run: [500] and [abort] /games → main text '… 0 games & sessions nearby …'; screenshots err-500-games.png, err-abort-games.png. Detail pages handle the same failure correctly ('We couldn't load this plan. Try again').
- **Root cause (if known):** List fetch error is swallowed into an empty array.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** List fetches had no error branch (`.then(set).finally()`, or `.catch(() => setItems([]))`), so failures rendered as legitimate empty results.
- **Fix:** Distinct LOADING / ERROR / EMPTY / SUCCESS: new shared `LoadErrorState` (role=alert, Try again re-runs the loader) on `/games`, `/circles` and the shared `BrowseLayout` (programmes, experiences, adventures, volunteer); counts/empty copy hidden on error. (`components/ui.tsx`, `pages/Games.tsx`, `pages/Circles.tsx`, `components/BrowseLayout.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-063` on /games (mobile + desktop), /circles, /programs FAIL before → PASS: alert shown, no false-empty copy, no leaked server text, Try again recovers. `-TIMEOUT`: network timeout is an error, not empty. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Same abstraction on all three list surfaces fixed; detail pages already correct.
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
