# HC-QA-093 — Staging/test builds would send analytics to the production GTM container

Severity: P2. Category: STAGING / ANALYTICS / PRIVACY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 11A, 2026-10-03).
Found during the Phase 11A staging configuration review (Part 6/7).

- **Screen:** Every page, after cookie consent ("Accept").
- **Actor:** Anyone using a non-production build (staging, local production build).
- **Steps:**
  1. Build the client for staging.
  2. Accept cookies.
  3. Watch the network.
- **Expected:** A staging build loads no analytics, or a staging container, so production analytics data stays clean (the brief requires "separate staging configuration or explicit exclusion").
- **Actual:** The GTM container ID was hard-coded in `client/src/analytics.ts`, with no configuration. Every build, staging included, loaded the **production** container after consent.
- **Evidence:** Code review. The Phase 11 production-build consent check showed `www.googletagmanager.com` requested after "Accept" on the isolated local build.
- **Fix:** `VITE_GTM_CONTAINER_ID`, resolved by `resolveGtmContainerId()`:
  - unset → the production default (production behaviour unchanged);
  - `off` → GTM is never loaded;
  - `GTM-…` → that container;
  - malformed → disabled.

  The staging client template sets `off`.
- **Regression:** `client/src/analytics.gtm.test.ts` (4 tests) PASS. The consent gating itself is unchanged.
