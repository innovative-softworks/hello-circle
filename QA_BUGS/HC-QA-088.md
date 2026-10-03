# HC-QA-088 — Shared Modal focus trap lets focus escape in Safari/WebKit

Severity: P2. Category: ACCESSIBILITY / BROWSER (WebKit). Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found during Phase 10A cross-browser verification of HC-QA-069 (adjacent same-pattern review).

- **Screen:** Every popup built on the shared `Modal` (Share sheet, booking/registration dialogs, drawers using Modal) and the new `useDialogFocus` trap used by ConfirmDialog.
- **Actor:** Keyboard users in Safari / WebKit.
- **Viewport / browser:** WebKit 26.6 (Playwright), desktop 1440×900. Chromium and Firefox unaffected.

**Steps**

1. In WebKit, open Manage → Activities → Share on a live activity (a Modal).
2. Press Tab.

- **Expected:** Focus cycles within the popup (Tab and Shift+Tab).
- **Actual:** The trap only intercepted Tab on the first/last element and left other presses to the browser. Safari's default Tab skips buttons/links, so the very first Tab moved focus out of the popup.
- **Evidence:** `HC-QA-088` (product-a11y-b) FAIL before in WebKit ("Tab 1 stays in the popup", against the pre-fix Modal) → PASS after in WebKit, Firefox and Chromium. The same flaw in the new `useDialogFocus` made `HC-QA-069` fail in WebKit before this fix.
- **Root cause:** Edge-only focus trapping relies on browser default Tab order, which differs in Safari.
- **Fix:** A shared `cycleFocus` helper moves focus itself on every Tab/Shift+Tab (wrapping), used by `Modal` and `useDialogFocus` (`client/src/components/ui.tsx`). Modal still defers Tab to a stacked ConfirmDialog.
- **Regression status:** New regression `HC-QA-088` in `npm run qa:product` / `qa:browsers`; HC-QA-069 now green in all three engines.
