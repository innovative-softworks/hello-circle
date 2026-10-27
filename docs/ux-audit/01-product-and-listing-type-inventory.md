# 01 — Product and Listing-Type Inventory

Audit date: 2026-10-22 · Branch `feature/workspace-detail-pages` (uncommitted Batch 1 + Batch 2 work included) · Audit only — no code, data or settings changed.

## How this was checked

- **Safe environment:** a read-only browser view on `:5573`, proxied to the dev API `:3301` (`hello_circle_dev`). Every non-GET request was aborted and logged, so no booking, join, save, report, share event or email reached the server. API `:3001` (production-designated `hello_circle`) was not used.
- **Captures:** 18 page states × 9 widths (320–1920) = 162 renders, plus 16 interaction walks. Raw data is in `dpaudit.json` / `journeys.json`; screenshots are in `screenshots/`.
- **Sources read:** `CLAUDE.md`, `docs/admin-and-vendor-reference.md`, the earlier public, booking and global UX audits in `docs/`, `client/src/App.tsx`, every detail page, `packages/types`, and the server routes for games, bookings, experiences, programmes and registrations.
- **Confidence labels used in every report:**
  - **Verified:** seen in the browser or measured.
  - **Code-reviewed:** read in code, not exercised.
  - **Hypothesis:** inferred, needs checking.

## Detail routes

| Listing type | Route | Page component | Booking / participation model | Who can book |
|---|---|---|---|---|
| Activity ("game", "plan", "session") | `/games/:id` | `pages/GameDetail.tsx` (443 lines) | Join a dated spot. Free or paid; `join_mode` open / approval; minimum players with a confirmation deadline (`pending_participants`). | Signed-in resident only (redirects to `/signin` with context) |
| Adventure | `/adventures/:id` | `pages/ExperienceDetail.tsx` (1037) | Book a departure (`experience_sessions`) with party size, names per person, min-age / safety / terms acknowledgements, coupon, credits; quote then Stripe | Guest (name + email) or resident |
| Experience | `/experiences/:id` | same component | same | same |
| Volunteer (kind of experience) | `/experiences/:id`; list at `/volunteer` | same component (`isVolunteer` branch) | Sign up as a volunteer; aggregate counts only | same — **no volunteer listings in dev data, so untested** |
| Programme | `/programs/:id` | `pages/ProgramDetail.tsx` (758) | Enrol once for every session; parent is a centre or club | Guest or resident (enrol dialog) |
| Venue / community centre | `/centres/:id` → `/book/:centreId` | `pages/CentreDetail.tsx` (408) → `pages/BookingFlow.tsx` (4 steps) | Hire a room by date and slot; online (deposit €100 + VAT + fee) or cash on arrival | Guest (X-Client-Id) or resident |
| Sports club | `/clubs/:id` → `/register/:clubId` | `pages/ClubDetail.tsx` (392) → `pages/RegistrationFlow.tsx` (3 steps) | Register a child or adult; waitlist when full; 10-session pass | Guest or resident |
| Circle | `/circles/:id` (id or slug) | `pages/CircleDetail.tsx` (1103) | Ongoing membership, unpaid; join open / approval / invite; plans, polls, moments | Signed-in resident only |
| Host profile | `/host/:id` | `pages/HostProfile.tsx` (144) | None (links to sessions and Circles) | — |
| Provider profile | `/provider/:id` | `pages/ProviderProfile.tsx` (507) | None (lists the provider's listings) | — |
| Booking details | `/bookings/:kind/:ref` | `pages/BookingDetailPage.tsx` (Batch 2) | Post-booking view for all six kinds | Owner only |

Venue and club pages are behind `VITE_VENUE_PAGES_PUBLIC` (off in the public build; turned on for this audit view only).

## Listing data models (main fields)

- **Activity (`games`):**
  - Basics: `activity_label`, `date`, `time`, `duration_minutes`, `capacity`, `min_participants`, `confirmation_deadline`, `price_cents`.
  - Details: `skill_level`, `experience_required`, `min_age`, `surface_type`, `indoor_outdoor`, `equipment_needed`, `meeting_instructions`, `cancellation_policy` (free text), `accessibility_info`, `image_url` (one photo).
  - Links and state: `centre_id` or `location_text`, `circle_id`, `series_id` (recurring), `join_mode`, `visibility`, `status`, `lifecycle`, `publish_at`, `booking_open_at`, `booking_close_at`.
- **Experience / adventure / volunteer (`experiences` + `experience_sessions`):**
  - Basics: `kind`, `title`, `blurb`, `description`, `area`, `county`, `lat`, `lng`, `meeting_point`, `duration_minutes`, `price_cents`, `capacity`, `payment_method`.
  - Adventure details: `difficulty`, `fitness_requirements`, `distance_km`, `elevation_gain_m`, `terrain_type`.
  - Content sections: `itinerary`, `equipment_provided`, `equipment_required`, `transport_info`, `safety_info`, `weather_policy`, `eligibility`, `cancellation_terms`, `accessibility_info`, `skills_required`, `cause`, `min_age`.
  - Photos: `image_url` plus gallery images.
- **Programme (`programs` + `program_sessions`):** parent `listingType` / `listingId`, title, age range, price for the whole programme, sessions, "what to expect" and "what to bring".
- **Venue (`centres` + `rooms` + `room_blocks` + `centre_hours`):** rooms each with capacity, rate and payment method. `capacity` / `from_price` are rollups. Also facilities, accessibility list and gallery.
- **Club (`clubs`):** sports, ages, fees, what's included, participation attributes, official Circle, waitlist, passes.
- **Circle (`circles`):** activity label, area, join mode, members, plans (games), polls, moments.

## Categories actually supported

- Activities use free-text `activity_label` values (football, walking, chess, book club, cycling, swimming and so on). Explore groups them as Sports & games, Experiences & adventures, Clubs & programmes, Events, Circles, Volunteering.
- **"Fitness and wellness", "Classes and workshops", "Arts and culture", "Events":** no separate detail type exists. Yoga is a programme; pottery is an experience; events are activities or experiences. There is no "event" listing type with tickets.

## Implementation status by capability

| Capability | Activity | Adventure / Experience | Programme | Venue | Club | Circle |
|---|---|---|---|---|---|---|
| Photo cover (shared carousel) | Verified, 1 photo | Verified, gallery | Verified, 1 photo | Verified | Verified | Own title-over-photo hero |
| Date / session choice on page | Single date | Departure list in code (one departure each in dev) | Schedule list | In booking flow | In registration flow | Upcoming plans |
| Party size | No (one per person) | Yes, names per person | Not checked | Guests count in flow | Child / adult | No |
| Price shown before booking | Yes | Yes + quote in dialog | Yes | "From €18/hour" + deposit | Fee in flow | Free |
| Fees / VAT breakdown | Paid: Stripe step | In dialog quote | Code-reviewed | `CheckoutBreakdown` in flow | In flow | — |
| Waitlist | Code-reviewed (approval joins) | Not seen | Not seen | — | Verified in code (`joinWaitlist`) | Approval requests |
| Sold out / full state | "Full" headline (code) | "Full" (code) | "Full" (code) | Slot unavailable in flow | Waitlist | — |
| Ended / past state | **Not handled on the page** (DP-01) | Departures filtered | "Show past sessions" | — | — | Recently together |
| Cancelled state | Verified banner + panel | Not observed | Not observed | Closed: "Not currently taking bookings" | — | Close circle (organiser) |
| Recurring series | Schema only (`series_id`), nothing shown | — | The programme itself | — | Club sessions | Plans |
| Reviews visible to visitors | **No** | Section (empty in dev) | Section | Yes (3 in dev) | Yes | No |
| Save | Yes | Yes | **No** | Yes | Yes | Yes |
| Share | Yes | Yes | Yes | Yes | Yes | Yes |
| Report | Yes | Yes | **No** | Yes | Yes | Yes |
| Host / provider link | Hosted by | Hosted by + provider | Hosted by | Plain text "Managed by …" | Plain text | Organiser |
| Map | Click to load | Click to load | Click to load | Click to load (approximate area) | Click to load | None |
| Sticky phone booking bar | Yes | Yes | Yes | Yes | Yes | Yes |
| Booking details page afterwards | Yes (Batch 2) | Yes | Yes | Yes | Yes | n/a |

Status key:
- **Implemented:** everything marked Yes.
- **Partial:** recurring series (data only); visitor reviews on activities; Save and Report on programmes; host attribution on venue and club.
- **Planned / decision-gated:** venue / club public launch (`VITE_VENUE_PAGES_PUBLIC`), paid-host wording, late enrolment (Batch 1 prepared decisions).
- **Unsupported:**
  - ticketed events with ticket tiers;
  - online or virtual activities (no `online` flag on any listing);
  - messaging a host before booking: no such control was found on any detail page audited (Hypothesis that none exists elsewhere; not traced through chat code).
