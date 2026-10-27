# HelloCircle — Detail Page UX/UI & Functional Audit (2026-10-22)

**Audit only.** No application code, database, Stripe setting, pricing, booking rule or permission was changed. Nothing was committed, pushed or deployed. The browser runs used the dev database through a read-only view: every write request was blocked, so no booking, join, save, report, interest record or email happened. The production-designated API (:3001) was not used.

| Report | Contents |
|---|---|
| [01 — Product and listing-type inventory](01-product-and-listing-type-inventory.md) | Routes, components, data models, booking models, implemented vs partial vs unsupported |
| [02 — Detail page UX/UI audit](02-detail-page-ux-ui-audit.md) | Header to footer, section by section |
| [03 — Functional and interaction audit](03-functional-and-interaction-audit.md) | Every control, what it does, states |
| [04 — Booking and conversion audit](04-booking-and-conversion-audit.md) | 12 journeys, pricing transparency, conversion fixes |
| [05 — Responsive and accessibility audit](05-responsive-and-accessibility-audit.md) | 9 widths, measured results, WCAG 2.2 AA |
| [06 — Redesign opportunities and priorities](06-redesign-opportunities-and-priorities.md) | Ranked recommendations, heuristic benchmark |
| [07 — Proposed detail page architecture](07-proposed-detail-page-architecture.md) | Shared page system, section order, state machine (proposal only) |

Evidence: `screenshots/` (57 images: 390 and 1440 of every state, full-page captures, interaction walks `J*.png`), `dpaudit.json` (162 renders), `journeys.json` (16 interaction walks).

## Executive summary

### 1. Overall assessment

- **The foundation is sound.** The three dated types (activity, adventure/experience, programme) already share one layout: cover, title, main column and a sticky booking card. They also share one photo cover and dialogs that are labelled, trap focus and close on Esc.
- **Measured basics are clean:**
  - zero horizontal overflow in 162 renders;
  - one H1 on every page;
  - no unlabelled fields or unnamed buttons;
  - layout shift 0.000;
  - the booking action reachable on the first screen for every bookable state.
- **The problems are content and state, not structure:**
  - pages repeat the same facts 3–5 times;
  - phones show the booking card twice and put cancellation terms after recommendations;
  - two non-bookable states (past activity, no dates) mislead or dead-end.
- **Venue and club pages** use an older layout and feel more like an information page than a marketplace listing.

### 2. Scope

- **Routes:** 11 detail routes audited. Activity, adventure, experience, programme, venue, club, Circle, host profile and provider profile, plus the venue booking (`/book`) and club registration (`/register`) entry steps.
- **Listing types:** 7 audited (activity, adventure, experience, programme, venue, club, Circle). Volunteer, an experience kind, has no dev data and is untested.
- **Page states:** 18, each captured at 9 widths.

### 3. Verified issues by severity

| | Verified | Code-reviewed | Hypothesis |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 4 | 0 | 0 |
| P2 | 14 | 6 | 0 |
| P3 | 11 | 0 | 1 |

### 4. Top 15 usability problems

1. **DP-01 (P1):** Past activities still show spots and "Sign in to join"; the join fails only after sign-in.
2. **DP-02 (P1):** "No dates yet" panels have no action; the only action sits 3,000px down.
3. **DP-04 (P1):** The same facts repeat (difficulty 4×, capacity 5×, summary twice).
4. **DP-03 (P1):** On phones the booking card appears twice, and cancellation terms come after recommendations.
5. **DP-37:** Experience booking is a long form inside a dialog on phones, with the total hidden while loading.
6. **DP-05:** Activities and Circles need sign-in first; other types accept guests.
7. **DP-38:** The activity price shown excludes VAT and the fee (€5.00 vs €6.40 paid).
8. **DP-07:** Venue cancellation and "instant" promises are hard-coded, not read from settings.
9. **DP-06:** Programmes have no Save or Report; host and provider profiles have no Report.
10. **DP-14:** Activity pages show no reviews or host rating.
11. **DP-13:** Venue and club owners are plain text, with no provider link.
12. **DP-34:** Cancelled activities offer no alternative in the panel.
13. **DP-11:** Tap targets under 24px (photo dots, back links, venue icon buttons).
14. **DP-25:** Venue hire price is ~1,400px down on phones.
15. **DP-22 / DP-23:** Unrelated demo photos (data) and upscaled covers on large screens.

### 5. Top 10 booking and conversion improvements

1. Ended state with "See other dates".
2. "Notify me" in every no-dates panel.
3. A KeyFacts row replacing the repeats.
4. On phones, booking facts and cancellation before recommendations.
5. Experience booking as a step page with a running total.
6. One sign-in rule per model.
7. All-in price wording.
8. Policy text from settings.
9. Other dates for recurring activities and in cancelled panels.
10. A host review summary on activity pages.

### 6. Missing functionality by listing type

- **Activity:**
  - ended state;
  - series dates;
  - public reviews or host rating in the page;
  - all-in price.
- **Adventure / experience:** booking as a step page; a "right for you?" block.
- **Volunteer:** no dev data, untested.
- **Programme:**
  - Save (needs API);
  - Report;
  - an action in the no-dates panel.
- **Venue:**
  - provider link;
  - policy from settings;
  - hire price in the title block;
  - focus handling in the booking steps.
- **Club:** provider link; focus handling in the registration steps; shared form errors.
- **Circle:** out of scope (no layout change, owner decision).
- **Host / provider profiles:** Report.

### 7. Reusable vs type-specific

**Reusable:**
- top bar;
- cover (`PhotoGallery`);
- title block with KeyFacts;
- state banner;
- booking panel and sticky bar;
- "Is this right for you?";
- Hosted by;
- Where;
- reviews;
- cancellation;
- alternatives (`ListingCard`);
- interest band;
- dialogs;
- step pages;
- form pattern.

**Type-specific (as config, not layouts):**
- KeyFacts fields;
- date chooser mode (single, departures, schedule, rooms, terms);
- availability wording;
- primary action label;
- "Who's going" (activity only);
- itinerary (adventure);
- schedule (programme);
- facilities (venue).

### 8. Recommended page information architecture

1. Top bar
2. Cover
3. Title + KeyFacts + price
4. State banner
5. About
6. Is this right for you?
7. Type sections
8. Hosted by
9. Where
10. Reviews
11. Cancellation
12. Alternatives
13. Interest band (only when nothing is bookable)

Booking panel on the right on desktop; inline once plus a sticky bar on phones. Details are in report 07.

### 9. Mobile-first priorities

1. Date, price, meeting area and cancellation within two screens.
2. A single booking summary, plus a sticky bar showing date · price · action.
3. 24px+ targets.
4. Step pages instead of long dialogs.
5. Shorter covers when there's no photo.

### 10. Decisions needed before design

1. Headline price including or excluding VAT and the fee (DP-38).
2. Sign-in rule per participation model (DP-05).
3. Public terminology: activity / session / plan / game (DP-21, also Batch 2 D-B2-5).
4. Map telemetry and consent (DP-18).
5. Whether venue and club pages move onto the shared layout now or after the venue launch decision.
6. Consumer corner radius: keep today's 10 / 16 / pill, or move to the brief's 0–2px.
7. Whether the Circle page stays out of the shared system.

### 11. Suggested implementation phases

- **Phase 1, low effort, UI only:** DP-01, 02, 06 (Report part), 11, 12, 20, 33, 34, 35, 42.
- **Phase 2, the content model:** KeyFacts row, de-duplication, phone order, sticky-bar date (DP-03, 04, 24, 25, 27, 29, 30, 39).
- **Phase 3, booking:** experience step page and shared form errors (DP-37, 41); price wording after the decision (DP-38); policy from settings (DP-07).
- **Phase 4, API and data:**
  - series dates (DP-15);
  - programme favourites and visitor save merge (DP-06, 32);
  - provider links (DP-13);
  - responsive images and demo photos (DP-22, 23);
  - request sharing (DP-36);
  - recommendation ranking (DP-31).
- **Phase 5:** venue and club on the shared shell, after the launch decision.

### 12. Risks and untested areas

**Not exercised** (all were blocked as writes):
- real payments;
- Stripe checkout pages;
- confirmation emails;
- booking/joining from a signed-in session in this audit.

These were covered earlier today by the isolated QA suites, not re-run here.

**No data to test:**
- full / sold-out listings;
- volunteer listings;
- recurring series;
- activities with join approval.

**Not done:**
- real screen readers;
- zoom at 200% and 400%;
- contrast per photo;
- throttled-network timings on these pages (Batch 2 measured lists, not detail pages);
- live competitor research (the benchmark is heuristic).

**Not checked:**
- **Production data** (photos, policies): every observation comes from `hello_circle_dev`.
- **Risk:** DP-07 is accurate today only because every organisation still uses the default 48 hours.
