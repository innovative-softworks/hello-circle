# HC-QA-054 — Double-clicking 'Create poll' creates duplicate Circle polls

Severity: P2. Category: FUNCTIONAL. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /circles/:id → Polls → Propose a time
- **Actor:** Circle member
- **Viewport / browser:** 1280; Chromium

**Steps**

1. As a member of a Circle, open Propose a time.
2. Enter a question and two dates.
3. Double-click 'Create poll'.

- **Expected:** Exactly one poll is created; the button is disabled while the request is in flight.
- **Actual:** Two identical polls were created (2 rows in circle_polls, same question, same second) and both render in the Polls list.
- **Evidence:** pages/CircleDetail.tsx:315-325 handleCreatePoll (no busy flag, no try/catch) and :867 button only disabled on empty question; DB: 2 rows 'November book pick discussion'; screenshot shots/circle-chat-sent.png (both polls visible).
- **Root cause (if known):** No in-flight guard client-side and no idempotency server-side. Errors from createCirclePoll are unhandled (no user feedback). The plan-idea handler (:326) uses the same pattern (not separately verified).
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** `handleCreatePoll` had no in-flight guard or error handling and the server inserted unconditionally.
- **Fix:** Server: poll creation serialised per Circle (`SELECT … FOR UPDATE` on the Circle row) and an identical OPEN poll by the same member (same question, plan link, option set) is returned (200, `duplicate: true`) instead of inserted. Client: ref-based in-flight guard, busy label, announced error. Same guard added to the adjacent plan-idea form. (`routes/circles.ts`, `pages/CircleDetail.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-054` FAIL before (evidence `pollsAfterDoubleClick: 2`) → PASS (1). `-BACKEND`: 4 concurrent + 3 repeated identical requests → one poll, options not duplicated; different question/options/member still create polls. `-UI-DELAY`: triple click with 1.5 s POST latency → one poll. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** Plan-idea creation shares the pattern — guarded the same way.
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
