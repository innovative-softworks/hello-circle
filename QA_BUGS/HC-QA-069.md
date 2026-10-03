# HC-QA-069 — Join confirmation dialog does not move or trap focus

Severity: P2. Category: ACCESSIBILITY. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found in Phase 10 (complete product quality QA, 2026-10-02/03). Environment: Isolated local exploration stack (throwaway tmpfs MySQL :13307, local Mailpit SMTP sink, backend :4411 with outbound blocked except DB/SMTP, Vite :4478), Chromium (Playwright 1.63, headless) unless stated. Regression gates ran separately against the guarded QA environment.

- **Screen:** /games/:id → Join / I'm in → confirmation dialog
- **Actor:** Keyboard / screen-reader users
- **Viewport / browser:** 1280; Chromium

**Steps**

1. Tab to 'Join · €8.00' (or 'I'm in') and press Enter.
2. Press Tab repeatedly.

- **Expected:** Focus moves into the dialog, stays inside while open, and returns to the trigger on close.
- **Actual:** Focus remains on the trigger; Tab moves to page controls behind the dialog (Share, Invite, Add to calendar, interest form). Escape does close it.
- **Evidence:** kbd.mjs: 'focus after opening dialog: BUTTON Join · €8.00 inDialog=false'; 'tabbing within dialog stays inside: false'.
- **Root cause (if known):** Dialog lacks initial-focus and focus-trap handling (contrast: Modal used by ShareSheet).
- **Regression status:** New in Phase 10. No existing gate covers it; HC-QA-001..051 gates re-ran green (see QA_REPORT.md). Screenshot/script evidence was kept in the session scratchpad (not committed; no credentials).

## Phase 10A remediation (2026-10-03)

- **Root cause:** Shared `ConfirmDialog` (join, leave, cancel, Circle join…) only handled Escape: no initial focus, no trap, no restore, no accessible name.
- **Fix:** New `useDialogFocus` hook (focus in — first field else least-destructive action — Tab/Shift+Tab trapped, focus restored to the trigger); ConfirmDialog gains `aria-labelledby`/`aria-describedby`; `Modal` defers Tab to a stacked ConfirmDialog; the custom `JoinAuthModal` gets `role=dialog`, `aria-modal`, the hook and Escape. (`components/ui.tsx`, `pages/Games.tsx`)
- **Regression (original kept, FAIL before → PASS after):** `HC-QA-069` desktop + mobile FAIL before (focus not in dialog) → PASS: focus moves in, 8×Tab and 8×Shift+Tab stay inside, aria-modal + named, Escape closes, focus returns to the trigger. `-ADJACENT`: host Cancel confirmation traps focus the same way. Suite: `npm run qa:product` (tests/integration/specs/product-*.spec.ts).
- **Adjacent checks:** All ConfirmDialog users inherit the behaviour.
- **Status:** FIXED LOCALLY — NOT DEPLOYED. Existing HC-QA-001..051 gates re-run green after the change (QA_REPORT.md, Phase 10A).
