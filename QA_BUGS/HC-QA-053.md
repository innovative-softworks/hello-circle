# HC-QA-053 — Share sheet spins forever when share data fails to load (e.g. Share on a draft activity)

Severity: P2. Category: FUNCTIONAL. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /manage?tab=activities → Share (and every ShareSheet use)
- **Actor:** Host
- **Viewport / browser:** 1280; Chromium

**Steps**

1. As a host, create an activity with 'Save as draft'.
2. In Manage → Activities, click Share on the draft row.

- **Expected:** Either Share is not offered for drafts, or the sheet shows an understandable error with a way out.
- **Actual:** GET /api/share/game/:id returns 404 (correct for a draft) and the modal shows a spinner indefinitely; no error, no retry.
- **Evidence:** components/ShareSheet.tsx:174-181 (.catch(() => setData(null))) and :219-221 (!data → PageSpinner); screenshot shots/host-share-draft.png; network 404 GET /api/share/game/195ec952-….
- **Root cause (if known):** Error and loading states share the same null value; Share is rendered for draft rows.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** ShareSheet used `data === null` for both loading and failure, so the deliberate 404 for a draft's share data rendered an endless spinner; Manage offered Share on draft rows even though the create-confirmation already hid it for drafts.
- **Fix:** Product rule kept: drafts are private and not shareable. Manage hides Share on draft rows (same rule as HostGamePage). ShareSheet now has a distinct failed state: announced error, Close and Try again. (`HostActivitiesTab.tsx`, `ShareSheet.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-053` FAIL before (draft row had Share) → PASS. `HC-QA-053-ERROR-STATE`: forced share-data 500 shows alert + Try again, recovery shows Copy link. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Other ShareButton surfaces use the same sheet, so they inherit the error state.
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
