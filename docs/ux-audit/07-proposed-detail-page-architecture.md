# 07 — Proposed Detail Page Architecture (proposal only)

**Nothing here is built.** This is a starting point for the design discussion. It keeps every existing business rule (pricing, lifecycle, capacity, refunds, permissions) and only reorganises what the page shows.

Out of scope unless the owner says otherwise:
- The **Circle** page layout (owner decision, Batch 2).
- **Home**.

Venue and club pages are included because they are the furthest from the shared layout, but they remain behind the launch gate.

## 1. One shared page, configured per type

A single `DetailPage` shell composed of shared sections. Each listing type supplies a **config**, which decides which sections appear, their labels, and the booking model. There are no type-specific layouts.

```
DetailPage
├── DetailTopBar        back (history-aware) · Share · Save · Report        [all]
├── DetailCover         PhotoGallery (exists) · short typographic cover when no photo
├── DetailTitleBlock    type link · H1 · area · KeyFacts row · price (all-in)
├── StateBanner         ended | cancelled | full | needs players | no dates | not taking bookings
├── BookingPanel        desktop: sticky card · phone: sticky bar
│   ├── DateChooser     single date | session list | series dates | rooms → step page
│   ├── Availability    one count only ("4 of 10 spots left")
│   ├── PriceSummary    all-in or "+ VAT & fee" (per decision), deposit if any
│   ├── PrimaryAction   Join | Book | Enrol | Check availability | Register | Notify me
│   └── PolicyLine      "Free cancellation until Thu 20 Oct, 11:00" (from org policy)
├── Sections (ordered by config, each optional):
│   About · Is this right for you? · What's included / bring · Itinerary · Schedule
│   · Who's going · Hosted by / Run by · Where & meeting point · Reviews · Cancellation & refunds
├── Alternatives        other dates → more like this (ranked by same activity, then area)
└── InterestBand        only when nothing is bookable (no dates / ended / full / cancelled)
```

### Reuse what already exists (no new components where one exists)

| Proposed part | Existing component to reuse |
|---|---|
| DetailCover | `components/PhotoGallery.tsx` (Batch 2) |
| Cards in Alternatives | `components/ListingCard.tsx` and adapters |
| Booking confirmation states | `bookingDetailModel.ts` and the booking kit (`ConfirmationPanel`, `PolicySummary`) |
| Dialogs | `Modal`, `ConfirmDialog` in `ui.tsx` (centred; no side drawers) |
| Step pages | `BookingFlow.tsx` / `RegistrationFlow.tsx` step pattern (for experiences too) |
| Forms | `components/form.tsx` (`FieldLabel`, `useFormErrors`, `FieldError`, `FormErrorSummary`) |
| Share / Save / Report | `ShareButton`, `SaveButton`, `ReportContentButton` |
| Map | `SinglePinMap` (click-to-load) |
| Reviews | `components/Reviews.tsx` |
| Interest | the existing intents API and the "Can't make this one?" band |

### Type configs

| Section | Activity | Adventure / Experience | Volunteer | Programme | Venue | Club |
|---|---|---|---|---|---|---|
| KeyFacts | date · duration · group size · level · indoor/outdoor | duration · difficulty · group size · min age | date · time commitment · cause | sessions · ages · length | capacity · rooms · from price | sports · ages · fee |
| DateChooser | single date + series dates | departure list | shift list | schedule (enrol once) | room → step page | term / pass → step page |
| Availability | spots left / needs N more | spots per departure | volunteers needed | spots left | per slot (in flow) | waitlist |
| PrimaryAction | Join / Request to join | Book | Volunteer | Enrol | Check availability | Register |
| Is this right for you? | level, experience, accessibility | difficulty, fitness, safety, weather, accessibility | skills, eligibility | ages, what to bring | facilities, accessibility | ages, what's included |
| Who's going | yes (names per privacy rules) | no | aggregate count only | no | no | no |
| Reviews | host's summary | listing reviews | organiser's summary | listing reviews | listing reviews | listing reviews |
| Run by | host (Verified Host badge only from `host_status`) | provider | organisation | parent venue/club | provider (needs org → provider link) | provider |

## 2. Section order

### Desktop (≥1024px), 2 columns, booking card sticky on the right

1. Top bar (back · Share · Save · Report)
2. Cover (16:9, max 460px tall; shorter typographic cover without a photo)
3. Title block: type link, H1, area, **KeyFacts** row, all-in price
4. State banner (only when not bookable)
5. About (one summary — no repeat)
6. Is this right for you?
7. Type sections (itinerary / schedule / what's included / who's going)
8. Hosted by / Run by (with review summary)
9. Where & meeting point (address, directions, "Show map")
10. Reviews (one line when empty)
11. Cancellation & refunds (full text)
12. Alternatives (other dates first, then more like this)
13. Interest band (only when nothing is bookable)

Right column: BookingPanel, then "Good to know" facts not already in KeyFacts. Nothing is repeated between the two columns.

### Phone (<768px), 1 column, sticky bar

1. Top bar (icons, 24px+ targets)
2. Cover
3. Title block + KeyFacts + price
4. State banner
5. **Booking summary inline:** date chooser, availability, policy line. The full card shows here once; the sticky bar carries date · price · button
6. About
7. Is this right for you?
8. Type sections
9. Hosted by
10. Where
11. Reviews
12. Cancellation & refunds
13. Alternatives
14. Interest band (only when nothing is bookable)

Target: date, price, meeting area and cancellation all inside the first **two** phone screens (today: 4–6 screens to reach cancellation).

### Tablet (768–1023px)

Phone order with a wider measure (max ~70 characters per line) and a two-column KeyFacts grid. Consider using the desktop layout from 900px.

## 3. Conditional components (state machine for the panel)

| State | Source of truth | Panel | Sticky bar | Alternatives |
|---|---|---|---|---|
| Open | lifecycle `active`, spots > 0 | count + action | date · price · action | below |
| Few left | spots ≤ 3 | same, count in orange | same | below |
| Full | spots = 0 | "Full" + Join waitlist (where the type has one) | "Full · Join waitlist" | in the panel |
| Needs players | `pending_participants` before the deadline | "Needs N more by …" + Join | same | below |
| Ended | lifecycle `completed` / date passed | "This took place on …" | "Ended · See other dates" | in the panel |
| Cancelled | status `cancelled` | "Cancelled" + reason if any | "Cancelled · Find another" | in the panel |
| No dates | no upcoming sessions | "No dates yet" + Notify me | "Notify me" | below |
| Not taking bookings | venue closed / org suspended | "Not taking bookings" | hidden | in the panel |
| Joined / booked | the caller's own booking | "You're going" + View booking (`/bookings/:kind/:ref`) | "You're going · View" | — |

All states come from fields the API already returns. Org suspension is enforced server-side (D-01); the page only needs to show it.

## 4. Design-system recommendations

- **Tokens:** keep the existing ones: cream `#F7F4EC` background, near-black `#172019`, orange-red `#FF4B24` accent, Bricolage Grotesque display. The brief's 0–2px corners match the workspace radius; consumer pages use 10 / 16 / pill today (`radius-and-select-tokens` decision). Changing consumer radii is an **owner decision**, not part of the detail-page redesign by default.
- **Hierarchy:** one H1; H2 per section; no H3 without an H2 (fixes DP-12).
- **Cards:** fewer boxed cards in the main column. Use rules and spacing for sections; keep boxes for the booking panel and alternatives only.
- **Targets:** 24px minimum hit area everywhere, 44px for the primary action.
- **Price display:** one formatter for all types ("€6.40 total" or "€5.00 + VAT & fee", per decision).
- **Policy text:** never hard-coded; always rendered from the organisation's policy.
- **No side drawers.** Short tasks use centred dialogs (share, report, invite); substantial tasks use full step pages (booking, enrolment, registration, experience booking).
- **Motion:** none beyond the skeleton and spinner (owner decision, Batch 2).

## 5. Dependencies before build

| Need | Why | Owner |
|---|---|---|
| Headline price inc. or ex. VAT & fee | DP-38, PriceSummary | Product + legal |
| Sign-in rule per participation model | DP-05 | Product |
| Public terminology (activity / session / plan / game) | DP-21 | Product |
| Map consent / telemetry | DP-18 | Legal |
| API: series siblings for activities | DP-15 | Engineering |
| API: cancellation hours on centre detail | DP-07 | Engineering |
| API: whole-programme favourite; visitor save merge | DP-06, DP-32 | Engineering |
| Data: provider profile per organisation | DP-13 | Engineering + ops |
| Media: responsive cover sizes; corrected demo photos | DP-22, DP-23 | Engineering |
| Venue/club launch gate | venue and club in the shared shell | Owner |
