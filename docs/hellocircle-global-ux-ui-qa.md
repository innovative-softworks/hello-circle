# HelloCircle — global workspace UX/UI QA

_2026-10-20. Evidence for `hellocircle-global-ux-ui-tracker.md`. All runs used isolated environments:
- **Real-stack suites:** a disposable QA MySQL container, Stripe TEST mode only.
- **Screenshots:** a local dev stack on `:3301`/`:5473` using `hello_circle_dev`.

The API on `:3001`, which is connected to the local `hello_circle` database, was never used or changed. Nothing is committed, pushed or deployed._

## Automated checks

| Check | Result |
|---|---|
| Client type check (`tsc --noEmit`) | passes |
| Client unit tests | 281 / 281 |
| Production build (`npm run build`) | passes |
| Server suite (isolated MySQL; last run of this branch, no server change since) | 1,027 passed, 23 skipped |
| Real-stack suite: validation (fresh QA DB) | 49 / 49 |
| Real-stack suite: product | 68 / 68 |
| Real-stack suite: lifecycle | 52 / 52 |
| Real-stack suite: authorization | 83 / 83 |
| Real-stack suite: booking | 38 / 38 |

### About the earlier failed run
One run started while the machine was overloaded (load average 22): 720 images were being compressed and the app was being built, while Adobe Creative Cloud used more than one CPU core in the background. Tests in unrelated, API-only flows timed out. The suites were rerun once the load dropped (a script waits for load average below 8 before each suite). Lifecycle, authorization and booking passed in that run. Validation and product were run again at load 3–5, and both passed in full; the one test that failed under load (COMPLETE-HOST) also passed on its own. The table shows these final runs.

## Responsive and accessibility audit (120 page views × 10 widths)

Script: `audit.mjs` (session scratchpad). It loads every page view (91 tab and sub-section views and 29 record pages) at 320, 375, 390, 428, 768, 900, 1024, 1280, 1440 and 1920 pixels. At each width it records:
- sideways page scroll;
- visible controls cut off at the screen edge (outside their own scroll area);
- page errors and console errors;
- buttons with no accessible name;
- images without `alt`;
- tap targets smaller than 24×24px at phone widths (≤428px).

The same script ran against the previous build (commit 806a17f, same data) for comparison.

| Measure (sum over 1,200 page-width checks) | Before | After |
|---|---|---|
| Page views covered | 120 | 120 |
| Sideways page scroll | 0 | 0 (one 10px case at 320px on a payment-event record was found and fixed: long titles now wrap) |
| Controls cut off at the screen edge | 0 | 0 |
| Page errors or console errors | 0 | 0 |
| Pages that failed to load | 0 | 0 |
| Controls under 24px at phone widths | 779 | 216 |

The remaining controls under 24px are text links inside sentences and tables (record names, the decision-history "Hub renamed" links). WCAG 2.2's target-size rule (2.5.8) exempts inline targets. The controls that weren't inline were fixed: breadcrumb buttons, record-title links in tables, and the field-help "i", which is now 18px to look at and 26px to tap. The two buttons flagged as unlabelled on partner Listings are decorative photo covers with `aria-hidden` and `tabindex=-1`, the same as before, and they aren't announced.

Accessibility work in this pass:
- Record tabs follow the WAI-ARIA pattern: arrow keys, Home and End, `aria-selected`.
- Every new checkbox has a label naming its row; select-all checkboxes show a partly-selected state.
- The bulk bar is a labelled region, and its count is announced.
- Row ⋯ menus are labelled "More actions for …".
- Primary buttons are near-black with white text (16:1 contrast); in dark mode they invert.
- Section titles that repeat the page title are hidden visually but stay as the section's accessible name.

## Visual review

Screenshots at 390, 1024 and 1440px for every page view are in the before/after comparison page (link in the final report). I reviewed these pages by eye at 1440px, plus 390px where noted:
- **Admin:** Overview, People, Support, Finance overview, Commercial rules (switches, Pro pricing), Coupons, Insights, Claims, listing (live and pending, 390px too), vendor, organisation (900 and 390px too), order (390px too), activity, report, settlement, payment review, privacy.
- **Partner:** Overview, Bookings (390px too), Listings, Earnings, Messages, Organisation settings, venue editor, programme, experience editor, staff, customer.
- **Host:** Overview, Activities, activity record (390px too), Circle.

## Functional QA done by hand

- **Every action still present:** the buttons, links and menu items on the 29 record pages were compared before and after with a script; nothing was lost. Moved actions are now in ⋯ menus or the header.
- **Bulk actions:** each one uses the existing request for a single row, with the same permission check, and every one except Mark read asks for confirmation. They were reviewed in code and their screens checked. They haven't been run against live dev data, because that would change the sample records.

## Not covered

- **Real devices:** no testing on physical phones or tablets; the widths were emulated in Chromium.
- **Screen readers:** no NVDA or VoiceOver pass; the checks above are structural.
- **Visual regression:** no pixel-diff tool in CI; the comparison was by eye using the before/after page.
