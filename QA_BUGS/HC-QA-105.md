# HC-QA-105 — Safari logs "TypeError: Load failed" when Home's in-flight requests are cancelled by navigating away

Severity: P3 (console noise / unhandled promise rejection; no visible effect). Category: ROBUSTNESS.
Status: OPEN — found in the Phase 13A staging smoke (2026-10-04), WebKit only.

- **Steps:** open `/home` and navigate away (e.g. to `/login`) before its data requests finish.
- **Observed (WebKit):** `/api/centres` and `/api/discover` are cancelled, and a page error `TypeError: Load failed` is raised. Chromium and Firefox stay silent.
- **Root cause:** some Home effects call fetch wrappers with `.then(…)` and no `.catch` (e.g. `fetchCentres().then(…)` for the county list in `client/src/pages/Home.tsx`). WebKit rejects an aborted fetch, and nothing handles the rejection.
- **Suggested fix (not applied):** add `.catch(() => {})` or a fallback state to Home's fire-and-forget fetches, then sweep other pages for the same pattern.
