# 09 · UI/UX and accessibility

**Target:** WCAG 2.2 AA. **Design system:** unchanged; the existing workspace (`adm-*`, `RecordView` 70/30) and consumer kits are used throughout. No redesign was made.
**Commit:** web `d22f4a6` + the DEF-07 fix (`VendorReports.tsx`).

## 1. Automated checks (recorded separately from manual review)

### 1a. New batch `booking-final-a11y`: FINAL-A11Y **PASSED** (after DEF-07)
**Coverage:** 13 participation pages × 4 widths (375, 768, 1024, 1440) = **52 page views**, signed in as the real role for each page. Raw data: `.qa-data/final-a11y.json`.

| Page | Role | H1 |
|---|---|---|
| Reports (Phase L) | partner owner | "Reports" |
| Messages (Phase K) | partner owner | "Messages" |
| Form builder, club Questions tab (G/H) | partner owner | listing name |
| Registration record (J) | partner owner | person's name |
| Door check-in home (2) | partner owner | "Check-in" |
| `/register/:clubId` | resident | *pre-launch page in the QA build* (see note) |
| Registration detail / confirmation (I) | resident | "You're booked" |
| My Life | resident | greeting |
| Host activity record (N) | host | activity name |
| Governance (L) | admin | "Governance" |
| Categories (E) | admin | "Categories" |
| Organisations, capabilities (B–D) | admin | "Organisations" |
| Settings, switches | admin | "Settings" |

**Enforced checks, all pass after the fix:**
- no horizontal scroll;
- exactly one visible H1;
- a `<main>` landmark;
- every visible form control has an accessible name (label, `aria-label`, `aria-labelledby` or wrapping label; a placeholder doesn't count);
- every visible button and link has a name.

**First run, before the fix:** `partner-reports@375 overflow: label right=461` → **DEF-07**, fixed. All 52 views pass afterwards.

**Measured, not enforced (needs a manual decision):**

| Measure | Result | Assessment |
|---|---|---|
| Heading skips | One: `/register/:clubId` pre-launch page, h2→h4 ("Book a hall or room") | Pre-launch marketing page, not participation UI. P3 |
| Targets under 24×24 px | 1–10 per page. Mostly text-style links and buttons 16–19 px tall (`adm-linkish`, `bd-link`, `hc-ws-link`, footer links) and the skip link (1×1 until focused, by design) | WCAG 2.5.8 allows undersized targets with enough spacing, or inline. Each needs a manual spacing check. The new participation controls (filters, composer, door buttons) weren't flagged. |
| Text contrast below 4.5:1 (3:1 large), heuristic: first opaque ancestor background | Avatar initials "Q" at 2.16–3.35 (workspace header, host participant list); pass reference `hc-pass-ref` at 1.25 and label at 3.90 on the confirmation pass; "Notify me" 3.34 and a "Coming soon" tag on the pre-launch page; My Life highlight count at 4.28 | The pass and pre-launch values sit over gradient or image backgrounds the heuristic can't see, so they're likely false positives. **Confirm by hand.** Avatar initials on the coloured circle are a genuine low-contrast case (P3, pre-existing). |

**Note on `/register/:clubId`:**
- In the QA client build, `VITE_LAUNCH_MODE` isn't public, so this route shows the pre-launch landing page, not the registration form.
- The resident registration form UI was checked instead by CFG-UNIVERSAL and CFG-OPERATIONS: labels, error summary, version-change prompt, and a phone layout without horizontal scroll.

### 1b. Existing accessibility and responsive suites in the regression

| Suite | Result |
|---|---|
| OG-23-RESPONSIVE: admin, partner and host workspaces at 320, 375, 390, 428, 768, 1024, 1280, 1440 and 1920 | **PASS** at all 9 widths after DEF-01 |
| HC-QA-083-SKIP (skip link), HC-QA-067 (cover control by keyboard), HC-QA-088 (Modal traps Tab and Shift+Tab, every engine), HC-QA-069-ADJACENT (ConfirmDialog focus trap), HC-QA-001-CONSENT/-NAV, PUB-15 (programmatic labels), B2-MOTION (no entrance animations), COMPLETE-FORMS (error summary focus), COMPLETE-MENUS (keyboard menus) | **PASS** |
| HC-QA-066, HC-QA-068, HC-QA-069, HC-GAP-UI-EXP/-PAID/-PROG, PUB-05/33, PUB-21/22/23, B2-LISTS, HC-QA-043, HC-QA-001-STACK | **Fail identically on `f22294f`** (test drift after the My Life and public redesigns; see [11](11-defects-and-remediation.md)). HC-QA-069 expects a confirm dialog that free, open activities no longer show (one-tap join). Its focus-trap intent is still covered for the dialog that *does* exist by HC-QA-069-ADJACENT and HC-QA-088. |

### 1c. Phone layouts in the participation journeys
These batches drive the phone viewport (390) and check for no horizontal scroll and no page errors:
- CFG-OPERATIONS: the resident answers a new question;
- CFG-HOST-QUESTIONS: the join dialog;
- P2-DOOR: door check-in;
- BK-EVENT-MOBILE;
- STRIPE-UI-MOBILE.

## 2. Manual verification
**Reviewed by reading the screenshots and code:**
- **CFG-HOST-QUESTIONS screenshots (50, 51):**
  - the question group is announced as "A few questions from the host";
  - required fields block "Confirm I'm in" until answered;
  - the radio and text fields have visible labels;
  - the host view shows answers as text, not colour only.
- **Code review of new UI:**
  - labelled controls (composer, filters, team notes, host questions, answer edit);
  - `role="status"` and `role="alert"` for send results and errors;
  - the weekly chart has `role="img"` with a text alternative and the same data in a table;
  - dialogs reuse `ConfirmDialog` and `Modal` (focus handled; no side drawers).

**Not done (needs a person):**
- a full screen-reader pass (VoiceOver or NVDA) of the participation pages;
- a manual contrast check of the flagged items above;
- a spacing check of the small targets;
- keyboard-only completion of the form builder (drag and reorder controls).

## Pilot remediation update (2026-10-30; see [14](14-pilot-remediation.md) §5)
**Automated, extended:**
- `booking-final-a11y` now covers 320 px (WCAG 1.4.10 reflow, equivalent to 1280 px at 400% zoom) plus 375, 768, 1024 and 1440: 13 pages × 5 widths = **65 page views**.
- It adds a **keyboard sweep** at 375 and 1440 px. Every Tab stop must be on screen, outside `aria-hidden`, and show a focus indicator (on the element or a `:focus-within` wrapper), and no element may keep focus beyond a native control's own parts.

**Found and fixed:**
- **DEF-09:** Reports date filters had no visible focus on their internal parts. Fixed in `admin.css`.

**Result:** **PASS** on the final working tree.

**Other fixes and repairs:**
- **DEF-10:** the cancel dialog's network-error message is now announced in plain words (`role="alert"`).
- **Keyboard and focus tests repaired:** HC-QA-066, HC-QA-068, HC-QA-069 (now on the approval join dialog that exists), HC-GAP-UI-EXP (keyboard-only cancel, with the dialog taking focus) and HC-QA-043. All pass.

**Screen reader: NOT TESTED.**
- **Why:** VoiceOver can't be operated from this session (macOS denies synthetic input, error −25204; no assistive-technology driver).
- **Not substituted:** automated scans and DOM inspection weren't used in its place.
- **What's left:** the exact remaining manual checklist (tool, browser, pages, scenarios) is in [14](14-pilot-remediation.md) §5.

## Gate 10 (accessibility)
**PASS for the automated structural checks**, with no open accessibility defect in the new participation UI after DEF-07.

**Not a full WCAG 2.2 AA conformance claim.** The manual screen-reader, contrast and target-spacing review is outstanding. It's recommended before a public launch; it doesn't block a supervised pilot.
