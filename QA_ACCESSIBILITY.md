# HelloCircle — Accessibility (practical WCAG 2.2 AA)

## Phase 12 — 2026-10-03 (current)

Fixed locally, not deployed. These are **WCAG-oriented automated and keyboard checks**, not a full WCAG 2.2 AA conformance claim. No manual screen-reader pass was done.

| ID | Fix | Regression (fails before, passes after) |
|---|---|---|
| 065 Page titles | `RouteTitleManager` gives every route a title in a layout effect; `usePageTitle()` gives loaded entities their real name; format "Name \| HelloCircle"; 404 "Page not found"; private names never used | `product-a11y-c` HC-QA-065: direct load, client nav, Back/Forward, loading → loaded, 404, private activity |
| 070 Nav semantics | `aria-expanded` + `aria-controls` on every header disclosure; `aria-current="page"` across header, mobile tab bar (plus sheet triggers) and dashboard sidebar; Escape closes header menus and returns focus (HC-QA-098) | `product-a11y-c` HC-QA-070 (desktop + mobile), `product-a11y-d` sidebar |
| 071 Form control borders | `--color-input-border`: light `#8a857a` (3.52:1 on bg), dark `#6b736d` (3.65:1) | `product-a11y-e` measures the rendered border, light + dark |
| 072 Dark-theme text | `greenText` / `orangeDark` for text (dark 9.99 / 8.04), new `dangerSolid` (white 6.54:1 dark), hard-coded hexes → tokens, theme-aware logo | `product-a11y-e` LIGHT + DARK |
| 083 Headings + skip link | Skip link as first Tab stop → `<main id="main-content">`; one H1 and no level skips across 28 audited routes | `product-a11y-c` PUBLIC/RESIDENT/SKIP, `product-a11y-d` BUSINESS |
| 099 Inbox rows | Profile notification rows are buttons in a labelled list | `product-p12-b` HC-QA-073-NOTIFICATIONS |

Still open (P3, unchanged): live-region announcement of every inline form error; 24 px targets on some small inline text links; no manual NVDA/VoiceOver pass. WebKit's Tab key only moves between form controls by default (BRW-2), so its skip-link test uses Alt+Tab, Safari's "every element" shortcut.

## Phase 11 recheck — 2026-10-03

On the **production build**, the Phase 10A accessibility regressions (052, 066, 067, 068, 069, 088) pass in Chromium, Firefox and WebKit. The Firefox TABLET timeout passed on rerun. WebKit's one failure is the known BRW-2 Safari Tab convention in the older consent test. On the map, provider failure is announced as text and the list alternative stays usable.

Still open, unchanged: 065, 070, 071, 072, 083. There is still **no full WCAG AA claim**.

## Phase 10A update — 2026-10-03

Fixed locally (not deployed), with failing-before → passing-after regressions in `npm run qa:product`, re-run in Chromium, Firefox and WebKit:
- **052:** vendor signup is completable keyboard-only, with a native radio group.
- **066:** My Life and vendor booking rows are links/buttons.
- **067:** upload controls are buttons, and errors are announced.
- **068:** labels on search, host, Circle and programme forms.
- **069:** ConfirmDialog/JoinAuthModal move focus in, trap it and restore it, and are named.
- **088:** the Modal/dialog trap is WebKit-safe.
- **089:** multi-step forms move focus to the new step heading.

| Area | Status now |
|---|---|
| Vendor signup (keyboard) | **PASS** on desktop and mobile, in all three engines (WebKit uses Option+Tab per Safari convention) |
| Forms | **PASS** for the scoped forms; still open: /suggest-place and detail-page interest inputs (HC-QA-068 follow-up, not in confirmed scope) |
| Interactive rows | **PASS** for My Life and vendor bookings; other `div onClick` instances (footer logo, photo gallery, admin, provider profile) remain |
| Upload | **PASS** |
| Dialog focus | **PASS:** ConfirmDialog, Modal and JoinAuthModal, in all three engines |
| Still open | 065 (page titles), 070 (aria-expanded/aria-current), 071/072 (contrast), 083 (headings, skip link, live regions, targets). **No full WCAG AA claim** |

## Phase 10 baseline (historical)

**Method**
- Keyboard-only runs in Chromium (Playwright): Tab, Enter and Escape with no mouse.
- A DOM audit on every swept route (274 route × width × persona rows): landmarks, H1 and heading levels, unlabelled controls, unnamed buttons, missing alt text, positive tabindex, small targets.
- A static scan for mouse-only handlers.
- Contrast computed from the real CSS tokens in `client/src/index.css` (light and dark), plus dark-mode screenshots.
- No automated axe engine was available (not installed; no downloads made). No real screen reader (VoiceOver/NVDA) session was run. Semantics were inspected programmatically.

## Summary

| Area | Result | Findings |
|---|---|---|
| Keyboard | **FAIL (one blocking journey)** | 052 (P1 vendor signup), 066, 067 |
| Focus | Partial: visible focus outlines PASS; dialog focus FAIL | 069 |
| Forms | Partial: auth and experience forms PASS; search, host, Circle and programme forms FAIL | 068 |
| Semantics | Partial | 065, 070, 083 |
| Contrast | FAIL (borders both themes; several dark-mode text pairs) | 071, 072 |
| Screen-reader readiness | Not ready for an AA claim | Above |

## Keyboard-only journeys

| Journey | Result |
|---|---|
| Sign in | **PASS.** Tab to email, type, Tab, password, Enter → signed in, lands on My Life |
| Discover | PASS. Header nav, search, chips and mood tiles are real buttons; activity cards are reachable (`button`) |
| Activity join | Reach "I'm in / Join · €8.00" PASS. **Dialog focus FAIL**: focus stays on the trigger and Tab escapes behind the dialog (069). Escape closes it (PASS) |
| Circle join | Join button reachable; the confirmation dialog uses the same pattern (not separately keyboard-verified) |
| My Life → open an activity | **FAIL.** Activity rows are `<div onClick>` (066) |
| Vendor signup | **FAIL (P1).** The required type tiles aren't focusable (052) |
| Vendor booking details | **FAIL.** Rows are `<div onClick>` (066) |
| Photo upload anywhere | **FAIL.** `display:none` file input (067) |
| Cookie consent | Reachable, but last in the tab order on long pages (083) |
| Skip / bypass | No skip link; a `main` landmark exists on every page (083) |

## Semantics

- **Landmarks:** `main` is present on every swept page; header and footer are present.
- **H1:**
  - Missing on 12 screens (083): My Life, Profile, Host create, Manage, vendor editors, vendor signup.
  - Heading-level skips on 6 screens.
  - The Home H1's accessible name runs words together ("happennear").
- **Titles:** the document title never changes on in-app navigation (065).
- **Buttons vs links:** mostly correct. Exceptions are 40 `div` click targets (066), and one unnamed icon button on the vendor programme page.
- **`aria-expanded` / `aria-current`:** none in the header menus or nav (070).
- **`aria-live`:** auth errors use `role=alert` (good). The inline join/payment error is not announced, and upload errors are plain text (083, 067).
- **Dialogs:** use `role=dialog`; focus management is inconsistent (069).
- **Images:** all `<img>` have `alt` (0 missing across the sweep).
- **Labels:** signup, login and the experience wizard are correctly associated. Many other forms aren't (068).
- **Map alternative:** maps are disabled in this configuration and list views remain fully usable. With maps enabled, a list alternative exists (Explore list); not verified with Mapbox live.
- **Charts, carousels, accordions:** none critical observed. The PhotoGallery main image is mouse-only (066).

## Contrast (computed, WCAG relative luminance)

| Pair | Light | Dark | Needed |
|---|---|---|---|
| Body text on bg | 15.15 | 15.36 | 4.5 ✔ |
| Muted / faint text on bg | 5.1–5.95 | 5.6–9.2 | 4.5 ✔ |
| Green (links, accents) on bg | 5.10 ✔ | **3.35 ✘** | 4.5 |
| Orange text on bg / surface | **4.49 ✘** / 4.69 | **3.80 / 3.44 ✘** | 4.5 |
| Danger text | 7.02 | 5.87 | ✔ |
| White on green / orange / dark buttons | 5.33 / 4.69 / 15.8 | same / same / 8.8 | ✔ |
| White on danger button | 7.33 | **3.04 ✘** | 4.5 |
| Input border on bg / surface | **1.42 / 1.48 ✘** | **1.73 / 1.56 ✘** | 3.0 |
| Gold accent (non-text) on bg | 2.07 | 8.26 | 3.0 (light ✘ if informational) |
| Hard-coded: footer tagline `#8A928B` on `#f6f4ef` | **2.91 ✘** | — | 4.5 |
| Hard-coded: restricted Circle description `#3B423C` on dark bg | — | **1.72 ✘** | 4.5 |
| statTile gold `#B8860B` on `#FCF3D9` | **2.94 ✘** | — | 4.5 |

Text over photos uses dark overlays and gradients (Circle hero, activity hero). These are visually legible in screenshots; not measured pixel by pixel. Focus indicators use the browser default outline, which is visible (PASS).

## Prioritised accessibility work

1. **052 (P1):** make the vendor type choice a native radio group.
2. **069, 067, 066:** dialog focus management; focusable upload controls; replace `div` click targets with links or buttons.
3. **068, 065, 070:** label every control; per-route titles; `aria-expanded` and `aria-current`.
4. **071, 072:** border and dark-mode tokens; remove hard-coded text colors.
5. **083:** H1s and heading order, skip link, live regions, target sizes.
