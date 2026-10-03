# HC-QA-057 — 'Message Circle' does not open the Circle chat

Severity: P2. Category: UX. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /circles/:id right rail (member view)
- **Actor:** Circle member
- **Viewport / browser:** 1280; Chromium

**Steps**

1. As a member, open the Circle page.
2. Click 'Message Circle'.

- **Expected:** The Circle chat opens.
- **Actual:** The page scrolls to the Planning section. The chat is only reachable via the small 'Chat' link at the top. In the restricted (non-member) layout the same card wires onMessage/onCreatePlan/onRequestClose to no-ops (not reachable by members in practice).
- **Evidence:** pages/CircleDetail.tsx:914 onMessage={scrollToPlanning}; :576-580 () => {} handlers; components/CircleJoinCard.tsx:131,144.
- **Root cause (if known):** Label/handler mismatch from the Circles V2 change.
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** "Message Circle" was wired to `scrollToPlanning` (and to no-ops in the restricted layout).
- **Fix:** Opens the Circle's own group chat (`ChatModal` scope `circle`, id = Circle id) in both layouts; server membership checks unchanged. (`pages/CircleDetail.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-057` desktop + mobile: Enter on Message Circle opens the chat for that Circle, message lands in `scope_type=circle/scope_id=<circle>`, Escape closes, no history entry added (Back behaves), reopening shows the same single conversation — FAIL before → PASS. `-AUTHZ`: non-member not offered the control and cannot post (403/404). Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** —
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
