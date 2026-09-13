# Document 06 — User Journeys

Major journeys as they actually run today. Steps marked *(missing)* are explicitly absent, not assumed present.

## Visitor → Registered member

1. **Discover** — Lands on Home or a local-SEO page (`/:county/:activity`)
2. **Explore** — Uses Explore's Discovery/Results modes or Browse
3. **View detail** — Opens a centre/club/game/circle/experience detail page
4. **Register** — Magic-link email or password sign-up (two separate resident-auth paths, same identity outcome)
5. **Onboarding** — Interests + home county captured — feeds the personalization scorer immediately
6. **Personalization** — Explore/Home re-rank using interest-keyword and county-match bonuses from that first session on
7. **First meaningful action** — Book, register, join a Game, or join a Circle — whichever surface they arrived through

## Discover → Participate

1. **Home** — Personalized (if signed in) or generic feed
2. **Discovery** — Explore/Browse
3. **Search/filter** — Category, county, weekend-date, sort (recommended/soonest/needs-people/price)
4. **Detail** — Full listing/activity page
5. **Join/book/register** — Branches by entity — see [Document 07](07-user-flows.md) for the exact branching logic
6. **Confirmation** — Stripe redirect (PaymentSuccess) or instant confirmation for free/cash paths
7. **Reminder** *(unconfirmed)* — No scheduled reminder job was found in this audit for bookings/registrations generically — only in-the-moment notifications on state changes. A cron/scheduled-job layer wasn't part of this pass's scope, so this is flagged as unconfirmed rather than assumed absent.
8. **Participation** — Attendance is self-reported for Games only (`attended` tri-state); no attendance tracking found for bookings/registrations/programs
9. **Post-experience** — Review eligibility unlocks (participation-gated, enforced server-side)

## Circle journey

1. **Discover Circle** — `/circles` browse or suggestions
2. **View Circle** — Detail page: members, upcoming plans, recent activity, moments
3. **Join** — Branches on `join_mode` — open/approval/invite (see [Doc 07](07-user-flows.md))
4. **Approval if applicable** — Organiser responds to the join request; requester notified either way
5. **Participate** — Appears in the member's MyLife → Circles section
6. **Receive updates** — In-app + push on circle activity (6 distinct trigger points in `circles.ts`)
7. **Attend activities** — Games linked to the circle via `games.circle_id`, or scheduling polls to decide the next one
8. **Interact** — Scoped chat (persistent, no time window — unlike Game chat)

## Booking journey

1. **Discover → Detail** — Centre page
2. **Availability** — Room selection, real-time slot grid against overlap+blocks+hours
3. **Select date/time, participants** — Guest count, event type
4. **Price** — Server-computed: subtotal, 23% VAT, 5% platform fee, optional deposit, coupon discount
5. **Payment** — Stripe Checkout (or instant for cash-payment rooms)
6. **Confirmation** — Webhook flips `payment_status`, notification fan-out
7. **Reminder** *(unconfirmed — see note above)*
8. **Attend** — No check-in/attendance tracking found for bookings specifically (unlike Games)
9. **Review** — Eligible immediately once `client_id` has a matching paid booking — no "past date" requirement for centre/club reviews

## Host journey (resident, not vendor)

1. **Become host** — No approval step — any resident can hit "Host a Game" or "Start a Circle" immediately
2. **Setup** — Activity, location, date/time, capacity, price, min-participants (games); name, activity label, join mode (circles)
3. **Publish** — Immediately visible (subject to `visibility`, though unenforced — see [Doc 20](20-gap-analysis.md))
4. **Receive participants** — Join notifications, waitlist promotions
5. **Manage** — Edit (capacity floor = current joined; price frozen once anyone but host has joined), remove a participant, cancel
6. **Communicate** — Post updates (fan-out notified), scoped chat
7. **Complete** *(no explicit status)* — No "completed" status is ever written for a Game — a past-dated game is simply excluded from "upcoming" queries
8. **Review/analytics** — Host review eligibility unlocks for participants of past games; no host-facing analytics dashboard found (that exists for Vendors, not resident hosts)

## Vendor journey

1. **Registration** — `/vendor/signup` — one form creates the account, org, and a draft listing together
2. **Verification** — Admin approval (`PUT /vendors/:id/status`) — no self-serve path
3. **Profile** — Org profile, policies (booking window, cancellation hours, feature flags)
4. **Listings** — Centres/clubs/programs/experiences CRUD + publish
5. **Availability** — Rooms, hours, blocks (centre); sessions (programs/experiences)
6. **Bookings/leads** — Operations tab — bookings/registrations/schedule/today/waitlist queues
7. **Customer communication** — Vendor-side messages (`communications` role-gated to send)
8. **Fulfilment** — Check-in routes for booking/registration refs
9. **Reviews** — Public, visible on provider profile
10. **Performance** — Insights tab: demand, payments, CSV export (finance/analyst role-gated)

## Circle creator journey

Identical to the Host journey above through "Setup" and "Publish," then diverges: a Circle has no capacity/waitlist/cancellation-with-refund concerns since it's unpaid and persistent. Growth is via `/:id/invite` (organiser-initiated) or organic discovery through `/circles` and Home's Circle suggestions. Moderation = remove-member (organiser can't remove another organiser or themselves). Activities are created as linked Games, not as a native Circle "event" type.

## MyLife journey

Confirmed aggregation surface (`MyBookings.tsx`, 9 parallel fetches): upcoming/ongoing/past bookings, registrations, program enrollments, game participation, circle membership, experience bookings, participation intents, and follows — all sectioned by a shared `MyLifeNextUp`/`MyLifeThisMonth`/`MyLifeRecentActivity` component family, plus a `MyLifeRepeatOpportunities` section suggesting a next booking based on rhythm. This is a UI-layer unification only: the five underlying tables remain separate at the data layer (see [Document 11](11-data-domain-model.md)) — a deliberate, acknowledged architecture tradeoff, not an oversight.

---
[← IA & Screen Inventory](05-ia-screen-inventory.md) · [Next: Detailed User Flows →](07-user-flows.md)
