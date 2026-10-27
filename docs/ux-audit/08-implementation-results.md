# 08 — Detail Page Redesign: Implementation Results (2026-10-22)

Built from the master detail-page brief and the owner's answers during the session. Nothing is committed, pushed or deployed. No database schema, VAT, fee, deposit, Stripe, refund, booking-rule, permission, legal text or launch flag was changed.

## Owner decisions applied

| Topic | Decision |
|---|---|
| Layout | Follow the brief: shared 70/30 detail layout, key facts once, booking column after the title on phones |
| Tokens | Keep the current ones: 1,560px width, existing corner radii, green primary buttons (not the brief's 1,280px / 2px / orange) |
| Price | List price plus "+ VAT & booking fee at checkout"; totals only ever from the server quote |
| Right column | Booking, cancellation, **Hosted by** and **Where** live in the right column; it stays pinned and scrolls on its own when taller than the window |
| Reviews | Full width of the 70% column |
| Booking form | **Centred pop-up** (owner's choice), for adventures/experiences and programme enrolment; venue booking and club registration keep their existing step pages |
| Circle page | Not redesigned |
| Venue/club | Redesigned, still hidden behind the launch flag |

No design screenshot was attached to the brief; the layout follows its written structure.

## A. What changed

- **P1 fixes:**
  - **DP-01:** past activities show "This has ended" and never a Join button.
  - **DP-02:** listings with no dates show "Tell me when dates are added".
  - **DP-03:** on phones the booking column follows the title, so price, date, action and cancellation come before the rest; the fixed bar is only a shortcut.
  - **DP-04:** facts appear once, in the key-facts grid; the repeated "What to expect", "… details" and "Good to know" blocks were removed.
- **Shared layout** on activity, adventure/experience/volunteer, programme, venue and club:
  - action row: history-aware Back, Share, Save, Report;
  - cover;
  - title block: category, title, location · Hosted by;
  - key-facts grid;
  - body sections;
  - right column: booking card, cancellation, Hosted by, Where.
- **Sections** (owner feedback): Schedule, Hosted by, Where and Reviews have one style, a heading over a thin rule with plain rows and no stacked boxes.
  - The host has a monogram or photo, a real "Verified" badge only when the data says so, and a profile link.
  - The location block has Get directions and Show map in one place; the map loads only on request.
- **Compact states:**
  - a short band instead of a tall empty cover when there's no photo;
  - "No reviews yet" as one line;
  - the review-eligibility note as plain text.
- **Booking panel:**
  - one availability count;
  - the price with the "+ VAT & booking fee at checkout" note;
  - the date in the phone bar;
  - activity buttons read "Join activity" / "Request to join" (list cards keep the short "Join").
- **Earlier today** (kept):
  - Report on programme, host and provider pages;
  - programme Save;
  - visitor saves merged at sign-in;
  - standard form errors;
  - booking-step focus;
  - 24px tap targets;
  - cancellation hours read from settings;
  - "Other dates" for repeating activities;
  - sharper Unsplash images;
  - topic-matched demo photos (on reseed);
  - looked-up guest bookings open the booking page.

## B. Component inventory

| New (`client/src/components/detail/`) | Purpose |
|---|---|
| `DetailTopBar` | Back (history-aware) · extras · Share · Save · Report |
| `DetailUnavailable` | Not-found page with search |
| `KeyFacts`, `Requirements`, `PAID_PRICE_NOTE` | Facts grid, "Is this right for you?", price note |
| `DetailSection`, `HostRow`, `LocationBlock`, `ScheduleList` | Shared sections |
| `scrollToInterest` | "Tell me when dates are added" → interest form |

**Reused:**
- `PhotoGallery`
- `SinglePinMap` (new `startOpen` option)
- `Reviews` (restyled)
- `GameJoinCard`
- `Modal`
- `form.tsx` error helpers
- `ShareButton`, `SaveButton` (`useSavedState`), `ReportContentButton`
- `CtaBand`, `ListingCard`

**Removed:**
- per-page Save/Share/Report code (venue, club, experience, activity);
- the per-page "Good to know" (experience) and "… details" grids.

**CSS:** `.detail-grid` (70/30 desktop; head → booking → body on phones), `.fact-grid`, `.requirement-row`, `.tap-target`.

## C. Page coverage

| Type | Layout | Key facts | Right column (booking · cancel · host · where) | Booking model | Status |
|---|---|---|---|---|---|
| Activity | Yes | Yes | Yes | Join / request, unchanged | Done |
| Adventure / experience | Yes | Yes | Yes | Pop-up booking, unchanged logic | Done |
| Volunteer | Yes (same page) | Yes (volunteers needed, cause) | Yes | Pop-up | Done, but no volunteer data to test |
| Programme | Yes | Yes | Yes | Pop-up enrolment | Done |
| Venue | Yes | Yes | Hire card + Location | Step page `/book/:id` | Done (hidden) |
| Club | Yes | Yes | Membership card + Location | Step page `/register/:id` | Done (hidden) |
| Circle | Unchanged | — | — | — | Out of scope |

## D. Screenshots

`docs/ux-audit/implemented/`: 1,440px and full-page 390px captures of each type and state (open, ended, cancelled, no dates, venue, club), plus the right-column views (`as-*.png`).

## E. Interaction verification (writes blocked; real flows via the QA suites)

**Checks across 6 widths (320, 390, 768, 1024, 1440, 1920), 108 renders:**
- horizontal overflow: 0;
- pages without exactly one H1: 0;
- fixed bar overlapping the tab bar: 0;
- unlabelled fields, unnamed buttons, images without alt: 0.

**Booking button position on a 390px phone (page px):**

| Page | Before | After |
|---|---|---|
| Adventure | 3,117 | 1,091 |
| Programme | 2,327 | 899 |
| Activity | 1,808 | 824 |
| Venue | 1,639 | 914 |

Page length on a 390px phone: adventure 6.3 → 5.0 screens; activity 4.9 → 4.5.

**Not exercised here:** real payments, emails, the Mapbox map itself, volunteer listings, full or sold-out listings, recurring series data, screen readers, 200% zoom.

## F. Regression (final code, isolated QA containers, Stripe test mode, no real email)

| Command | Result |
|---|---|
| `npm run test --workspace client` | 302 passed |
| `npm run test --workspace server` | 1,029 passed, 23 skipped (119 files) |
| `npm run build --workspace client` | succeeds |
| `npm run qa:check` | 97 passed |
| `npm run qa:booking` | 38 passed, 2 skipped by design |
| `npm run qa:lifecycle` | 52 passed (19 groups) |
| `npm run qa:authorization` | 83 passed |
| `QA_PRODUCT_CONTINUE=1 npm run qa:product` | 80 passed, 1 skipped by design (performance) |

Test updates (wording only): "Join" → "Join activity" on the detail page; "Ask to join" → "Request to join"; "This plan…" → "This activity…"; "Enroll" → "Enrol".

## G. Outstanding decisions

1. Legal policy publication: still waiting for company details.
2. Venue and club public launch.
3. Paid-hosting and late-enrolment wording.
4. Map consent: Mapbox records each map load; the page now says so before loading. Should the cookie notice cover it?
5. Whether consumer pages should ever move to the brief's 1,280px / 2px / orange tokens (kept current for now).
6. Reseeding demo data (`npm run reset-demo --workspace server`, dev database only) to get the topic-matched photos.
