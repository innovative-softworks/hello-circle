# HC-QA-089 — Multi-step forms leave focus on the bottom button after "Continue"

Severity: P2. Category: ACCESSIBILITY / BROWSER (most visible in WebKit). Status: FIXED LOCALLY — NOT DEPLOYED (Phase 10A, 2026-10-03).
Found during Phase 10A cross-browser verification of HC-QA-052.

- **Screen:** Every `GuidedFlow` step form — vendor signup, host activity creation, centre/club/experience creation wizards.
- **Actor:** Keyboard and screen-reader users.
- **Viewport / browser:** All engines; blocking in WebKit (desktop and mobile).

**Steps**

1. Complete step 1 of vendor signup with the keyboard and press Enter on "Continue →".
2. Press Tab (Option+Tab in Safari) to reach the first step-2 field.

- **Expected:** Focus moves to the start of the new step (its heading), and the next Tab reaches its first field.
- **Actual:** Focus stayed on the re-used submit button at the bottom (now "Create vendor account"). In WebKit, Tab from the last element leaves the page, so focus went to the browser chrome (recorded sequence: `BUTTON Create vendor account → BODY → BODY …`). Chromium only appeared fine because it wraps focus to the top of the page. Screen readers got no announcement of the new step.
- **Evidence:** WebKit run of `HC-QA-052` failed at "vendor type choice reachable by Tab" with the recorded focus sequence above; after the fix `HC-QA-052` (desktop + mobile) passes in Chromium, Firefox and WebKit and now also asserts the new step heading is focused.
- **Root cause:** `GuidedFlow` re-renders the next step without managing focus (WCAG 2.4.3 Focus Order).
- **Fix:** On a step change (not first render) `GuidedFlow` focuses the step's `<h2 tabIndex=-1>` (`client/src/components/GuidedFlow.tsx`).
- **Regression status:** Covered by `HC-QA-052` (heading-focus assertion) in `qa:product` and `qa:browsers`.
