# HC-QA-065 — Page title never changes during in-app navigation

Severity: P2. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03). Originally recorded in Phase 10.
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** All routes (SPA)
- **Actor:** All users, screen-reader users, browser history/tabs
- **Viewport / browser:** All; Chromium

**Steps**

1. Open any page, then navigate within the app (e.g. Home → Games → activity).

- **Expected:** Each route sets a descriptive document.title (WCAG 2.4.2).
- **Actual:** Every in-app route keeps 'Hello Circle — community centres & sports clubs in Ireland' (1 distinct title across 274 sweep rows). The server injects per-route titles only on a hard load.
- **Evidence:** grep document.title in client/src: 0 hits; sweep results: titles distinct = 1; server ogMeta.ts injectOgTags sets titles on full page load only.
- **Root cause (if known):** No client-side title management.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 12 remediation

- **Fix:** `client/src/pageTitle.ts`.
  - `RouteTitleManager`, mounted in `App`, sets a route-level title in a **layout** effect on every path change: a static page name, or a neutral placeholder for entity routes ("Activity | HelloCircle").
  - Pages call `usePageTitle(name)` once their data has loaded. That's a passive effect, so it always runs after the layout effect.
  - Covered: activity, Circle, experience, programme, centre, club, host, provider, Manage Circle, local landing pages and 404.
- **Privacy:** pages pass only data the server returned to that viewer. A private invite-only activity never puts its name in the title.
- **Regression:** `product-a11y-c.spec.ts` HC-QA-065 checks direct load, client navigation, Back, Forward, the entity loading → loaded transition, no stale entity title, 404, and the private activity name. It fails on the pre-Phase-12 code and passes now in Chromium, Firefox and WebKit.
