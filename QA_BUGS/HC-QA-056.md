# HC-QA-056 — Circle members are not notified when the organiser creates a new plan

Severity: P2. Category: FUNCTIONAL. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** Circle plan creation (/games/host?circleId=…) → member notifications
- **Actor:** Circle organiser / member
- **Viewport / browser:** API + UI; Chromium

**Steps**

1. Member joins an approval Circle and is approved (member receives 'Approved' notification).
2. Organiser creates a plan for the Circle.
3. Check the member's notifications.

- **Expected:** Members get an in-app notification about the new plan — the join dialog says members 'get updates when something's planned' and the Circle card says 'you'll hear about every plan'.
- **Actual:** No notification is created for members (only host followers and centre followers are notified on creation).
- **Evidence:** server/src/routes/games.ts ~1185-1212 (notifyHostFollowers / notifyCentreFollowers only; no circle_members fan-out); /api/residents/me/notifications for the member lists only 'Approved: Northside Book Club'.
- **Root cause (if known):** Feature promise in copy is not implemented in the plan-creation side effects. Could be treated as a product decision, but the UI explicitly promises it.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** Plan creation fired search-alert/intent/follower side effects but never notified Circle members, although the join dialog/card promise it.
- **Fix:** Decision: the UI promise is intentional (plan ideas already notify members). `notifyCircleMembersOfPlan` notifies each CURRENT member except the organiser, once per member per plan (existence check), when a Circle plan becomes bookable — created active, or Coming soon → active. Drafts/still-coming-soon plans and removed members are not notified. (`routes/games.ts`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-056` FAIL before → PASS. `-ELIGIBILITY`: removed member and organiser not notified, draft/coming-soon not announced until opened, no duplicate on repeated open, standalone activity doesn't notify Circle members. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** —
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
