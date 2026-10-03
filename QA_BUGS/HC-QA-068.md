# HC-QA-068 — Form controls without accessible names on search, host, Circle and vendor forms

Severity: P2. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /games, /programs, /experiences, /adventures, /volunteer, /circles, /home search bars; detail-page 'Anything to add?'; /suggest-place; /games/host; /circles/start; /vendor/programs/new; Manage search; program session date/time
- **Actor:** Screen-reader users
- **Viewport / browser:** All; Chromium

**Steps**

1. Inspect controls with the accessibility tree / screen reader.

- **Expected:** Each input/select has a programmatic label (WCAG 1.3.1 / 4.1.2).
- **Actual:** Visible text labels are not associated (no htmlFor/id or aria-label); many controls fall back to placeholder or nothing. Counts at 1280: /vendor/programs/new 12, /games/host 8, /circles/start 6, /suggest-place 6, browse pages 4 each (search + 3 filter selects). Signup/login and the experience wizard ARE correctly labelled.
- **Evidence:** Sweep 'unlabeled' field (results.ndjson); program form dump (#program-title has id but no associated label); session add form date/time unlabeled.
- **Root cause (if known):** Inconsistent form-field component usage.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** Visible labels not associated (`<label>` without `htmlFor`) and search/filter controls with placeholder only.
- **Fix:** Explicit `htmlFor`/`id` pairs on the host activity form (19 fields), Circle start (9) and programme form (13); `aria-label` only where no visible label exists (search inputs, area/when/sort selects, date filter, Manage search, post-update input, programme session row controls). (`HostGamePage.tsx`, `StartCirclePage.tsx`, `VendorPrograms.tsx`, `Games.tsx`, `BrowseLayout.tsx`, `Circles.tsx`, `Home.tsx`, `HostActivitiesTab.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-068` FAIL before → PASS: zero unlabelled visible controls on /games, /home, /circles, /programs, /experiences, /games/host steps 1–2, /circles/start (incl. more detail), Manage activities; programme new form and session form zero (product-vendor). Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Remaining unlabelled controls on /suggest-place and detail-page interest inputs not in the confirmed scope (left for follow-up).
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
