# HelloCircle — Responsive QA (Phase 10)

**Method**
- Playwright Chromium at **320, 360, 390, 430, 768, 820, 1024, 1280 and 1440 px**. Widths under 768 use mobile emulation (`isMobile`, touch).
- 274 route × width × persona rows:
  - **All 9 widths** for 16 core routes: `/`, `/home`, `/explore`, `/games`, activity detail, `/circles`, Circle detail, adventure detail, `/signin/create`, `/vendor/signup`, `/my-life`, `/games/host`, Manage activities, `/vendor`, `/admin`, `/chats`.
  - **390 and 1280** for every other route in the inventory (~60 routes across anonymous, resident, host, vendor and admin).
- Each page was checked programmatically for:
  - document horizontal overflow and the elements causing it;
  - truncated/offscreen elements;
  - consent banner versus tab bar;
  - small touch targets;
  - CLS.
- Screenshots at 390 and 1280. Dark-mode screenshots at 390 and 1280 for 9 key screens.

## Results

| Check | Mobile (320–430) | Tablet (768–820) | Desktop (1024–1440) |
|---|---|---|---|
| Horizontal overflow (document) | **PASS — 0 pages** | PASS — 0 | PASS — 0 |
| Cards / grids | PASS. One layout gap: My Life stat cards sit in the right half at 390 (085) | PASS | PASS. "Coming soon" badge clipped by the heart icon on `/games` cards at 1280 (079) |
| Forms | PASS (single column) | PASS | PASS. The cookie banner overlays the vendor-signup checkboxes at 1280 (082) |
| Tables / lists (vendor, admin) | PASS (no overflow) | PASS | PASS |
| Modals / dialogs / drawers | PASS (join, confirm, share, setup popup fit at 390) | PASS | PASS |
| Fixed CTAs / bottom tab bar | PASS. The 5-tab bar is visible on participant routes and hidden on `/vendor`, `/admin`, `/manage` | PASS | n/a |
| Cookie consent with tab bar | PASS (lifecycle-ui-bottom-chrome gate green; screenshots show the banner above the tab bar) | PASS | PASS |
| Toasts / dropdowns | PASS (no overflow observed) | PASS | PASS |
| Date/time pickers | Native inputs. Rendered correctly in Chromium; Safari/Firefox pickers BLOCKED (engines not installed) | — | — |
| Maps | Not rendered (Mapbox disabled in isolation); list UI used. NOT CONFIGURED | — | — |
| Touch targets | Several text links under 24 px (083) | — | — |
| Layout stability | CLS ~0.22 on most routes (075) | Same | Same |

The sweep's automatic "consent overlaps tab bar" signal was a false positive: the selector matched `main.mobile-tab-bar-space`. It was discarded in favour of the HC-QA-001 regression gate (PASS) and visual checks.

## HC-QA-001 status

**Still GREEN.** `npm run qa:lifecycle` includes the HC-QA-001 layout batch (3 tests) and passed (52/52). In the Phase 10 screenshots at 320–430 px, the consent banner sits above the tab bar without covering the primary CTA.

## Dark mode

Layouts hold in dark mode. Contrast defects are recorded in QA_ACCESSIBILITY.md (072): the near-invisible restricted Circle description and the low-contrast wordmark.
