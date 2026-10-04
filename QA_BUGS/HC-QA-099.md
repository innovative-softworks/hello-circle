# HC-QA-099 — Profile notification inbox rows were mouse-only (div with onClick)

Severity: P3. Category: ACCESSIBILITY (keyboard). Status: FIXED LOCALLY — NOT DEPLOYED (Phase 12, 2026-10-03).
Found while adding HC-QA-073 pagination to the inbox. It's the same class as HC-QA-066, on a surface that fix didn't cover.

- **Steps:** Open Profile → Notifications and use Tab.
- **Expected:** Each actionable notification is reachable and operable from the keyboard.
- **Actual:** Rows were `<div onClick>`, with no focus and no keyboard activation.
- **Fix:** `client/src/pages/Profile.tsx`:
  - the inbox is a labelled list;
  - actionable rows (a link target, or still unread) are real buttons;
  - non-actionable rows, such as "Invitation withdrawn" once read, are plain text.
- **Regression:** `product-p12-b.spec.ts` HC-QA-073-NOTIFICATIONS asserts the rows are buttons.
