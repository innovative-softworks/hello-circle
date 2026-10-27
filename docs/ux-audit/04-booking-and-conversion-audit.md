# 04 — Booking and Conversion Audit

**Safety:** no payment, booking, cancellation, email or data change was made. Journeys were walked up to the first write, which the audit browser blocked. Post-booking steps (confirmation, booking details, cancellation) are covered by the isolated QA suites run earlier today (booking 38 passed, lifecycle 52, product 80 including B2-BOOKING), not re-run here.

## Journeys

| # | Journey | Steps today | Friction / dead ends | Confidence |
|---|---|---|---|---|
| 1 | Visitor discovers an activity and reads it | List → card → detail | Back link doesn't return to where you came from (DP-20); repeated facts make the page long (DP-04) | Verified |
| 2 | Visitor signs in when required | "Sign in to join" → `/signin` with a "You're joining…" card → return to the page | Good context card. But it also appears for ended activities (DP-01). Adventures don't need sign-in, while activities and Circles do (DP-05) | Verified |
| 3 | Resident books a paid activity or adventure | Activity: join → Stripe. Adventure: dialog (8+ fields, 3 ticks) → quote → Stripe | Adventure total reads "Calculating total…" while the form is filled; long form in a dialog (DP-37) | Verified up to quote |
| 4 | Resident joins a free activity | Sign in → join → in place | One tap after sign-in | Verified (QA suite) |
| 5 | Joins a game with limited spots | Same as 4. "4 spots left" badge turns orange at ≤3 | Spots repeated 5 ways (DP-04). Full state not seen in dev data | Verified / Code-reviewed |
| 6 | Picks a recurring class session | Programme: enrol once for all sessions. Activities with a `series_id`: no other dates shown | No way to see "the same activity next week" from an activity page (DP-15) | Code-reviewed (no series in dev data) |
| 7 | Books a venue | Check availability → 4 steps (room, date & slot, details, review & pay) | Hire price on phones is far down the page (DP-25). Flow itself audited in Batch 1 | Verified to step 1 |
| 8 | Hits sold-out or unavailable | Cancelled: clear but no action in the panel (DP-34). Past: looks open (DP-01). No dates: panel says "No dates yet" with no action; the only action is ~3,000px down (DP-02) | Two dead ends | Verified |
| 9 | Saves and revisits | Visitor: saved only on this device, silently (DP-32). Resident: saved to account, found under Profile › Saved | Visitors lose saves | Code-reviewed |
| 10 | Cancels a booking | Booking details page → confirm dialog → in-place Cancelled (Batch 2) | Covered by tests; the cancellation window wording on the venue panel isn't tied to settings (DP-07) | Verified (QA) |
| 11 | Views confirmation and details | Payment success → `/bookings/:kind/:ref` | Works for all six kinds; guest bookings found by reference + email don't open it (Batch 2 open item) | Verified (QA) |
| 12 | Submits a review | Only after attending; activity: form on the past page; venue: after a booking | Eligibility note shown; the activity page shows no public reviews (DP-14) | Code-reviewed |

## Pricing transparency

| Type | Price on the page | What's added later | Assessment |
|---|---|---|---|
| Activity | "Free" / "€5.00 each" chip and in the card | VAT 23% + 5% platform fee added; the total appears at the join confirmation step before Stripe | Headline price is not the price paid (DP-38) |
| Adventure / experience | "€35.00" per person | Dialog quote shows the total with fees, coupon, credits | Total appears only after the form loads its quote |
| Programme | "€60.00 whole program" | Enrol dialog | Clear unit ("whole program") |
| Venue | "Hire from €18/hour + €100 refundable deposit" | VAT, fee, deposit in `CheckoutBreakdown` | Deposit disclosed up front (good); fee and VAT appear only in the flow |
| Club | Fee per term in the flow; "10 sessions for €X (incl. VAT & fee)" for passes | — | Pass wording is the clearest model on the site |

`pricing.ts` is the single source of the VAT/fee/deposit maths. No client-side total was found that bypasses it.

## Findings

| ID | Route | Type | Current behaviour | Problem | Impact | Sev | Recommendation | Evidence | Confidence | Effort | Dependency |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DP-02 | `/programs/demo-program-1`, `/experiences/demo-experience-10` | programme, experience | Side panel and sticky area say "No dates yet" with no button; the only action ("I'm interested in …") is at 3,460px on a phone and 2,966px on desktop. No sticky bar | A visitor who wants it has nothing to do where they look | Lost demand signal; dead end | P1 | Put "Tell me when dates are added" in the panel and sticky bar (same interest API) | `J14-programme-no-upcoming.png`, `dpaudit.json` inFlowCtaTop | Verified | Low | none |
| DP-05 | `/games/:id`, `/circles/:id` vs `/adventures/:id`, `/book`, `/register`, programmes | all | Activities and Circles need an account before joining; experiences, venues, clubs and programmes accept guests | Inconsistent; an activity costs a sign-up before you can even see the next step | Drop-off on the most common action | P2 | Decide one rule per model, e.g. guest checkout for paid one-offs; account for ongoing memberships. Then make the button wording say it ("Join — sign in needed") | `J3`, `J1` walks | Verified | Medium | product decision |
| DP-07 | `/centres/:id` | venue | Panel always says "Instant online confirmation" and "Free cancellation up to 48h before" (hard-coded). The server uses each organisation's `org_policies.cancellation_hours` (all at the default 48 in dev today) | Accurate today, but goes wrong the moment an organisation changes its window. Same risk for "Instant", if approval-based hire is ever added | Customers promised terms that the system won't honour | P2 | Read the organisation's cancellation hours into the panel (the booking API already returns `cancellationHours`) | `CentreDetail.tsx:354-357`; `server/src/routes/bookings.ts:392,657` | Code-reviewed | Low | API field on centre detail |
| DP-15 | `/games/:id` | activity | `games.series_id` links repeats of an activity, but the page shows only its own date | Can't pick "next Thursday" when this one is full or past | Lost bookings | P2 | "Other dates" list in the panel, from the series | `GameDetail.tsx` (no `seriesId` use); schema | Code-reviewed | Medium | API (series siblings) |
| DP-38 | `/games/:id` (paid) | activity | The page and card show the listing price ("€5.00 each"). VAT (23%) and the 5% platform fee are added server-side; the total (≈€6.40 for €5.00) first appears in the join confirmation (`PlanRecap`: "Total today … incl. VAT + fee") before Stripe. Venues disclose the deposit up front; experiences show the total in the booking dialog | The headline price isn't the price paid. Showing consumer prices without VAT may also be a consumer-law question in Ireland | Surprise at confirmation; abandonment and complaints | P2 | Show the all-in price on the page (or "€5.00 + VAT & fee"), consistently across types | `client/src/components/GameJoinCard.tsx:124-148`; `server/src/routes/games.ts:1731-1745`; `pricing.ts` | Code-reviewed | Low | product + legal decision (headline price inc. or ex. VAT) |
| DP-39 | dated types, phone | activity, adventure, programme | Sticky bar shows availability ("10 spots left") and price but not the date | On a phone, the date (the main decision) scrolls away | Wrong-date bookings | P3 | Sticky bar: date · price · button | `adventure-with-departure-390.png` | Verified | Low | none |

## Top conversion improvements (ranked)

1. Ended / past state for activities (DP-01).
2. An action in the "No dates yet" panel (DP-02).
3. Remove repeated facts and the duplicated phone booking card, so the date, price, meeting point and cancellation all fit in the first two screens (DP-03, DP-04).
4. Experience booking as a full page with the total visible throughout (DP-37).
5. One sign-in rule per participation model (DP-05).
6. "Other dates" for recurring activities and in the cancelled panel (DP-15, DP-34).
7. Policy text from settings, not hard-coded (DP-07).
8. Host reviews summary on activity pages (DP-14).
9. Visitor saves kept or merged at sign-in (DP-32).
10. Date in the phone sticky bar; hire price in the venue title block (DP-39, DP-25).
