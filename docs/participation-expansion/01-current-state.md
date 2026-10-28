# 01 · Current state: architecture, lifecycles, capability matrix, gaps

All references are to `server/src` unless the path says otherwise. Every finding comes from reading the code on
2026-10-28. None of it is assumed from older docs.

## 1. Architecture and data flow (as built)

```
Client (React/Vite)                    Server (Express, one origin)                         MySQL
───────────────────                    ────────────────────────────                         ─────
Detail page booking box  ──quote──▶  /api/<type>/…/quote  ──▶ pricing.ts computePricing()     coupons
 (ExperienceDetail,                  (experiences: commerce/engine priceWithRules()
  BookingFlow, GameDetail…)            when commerce.engine_v2(_experience) is on)
                          ─checkout▶ /api/<type>/…/checkout
                                     1. tx: SELECT parent FOR UPDATE (PARENT_LOCK)            rooms / clubs / programs /
                                     2. assertSellable() (D-01 org status)                    experience_sessions / games
                                     3. capacity: occupiesCapacitySql / gameSeatSql
                                     4. INSERT pending row (+ seat names, acknowledgements)   <five participation tables>
                                     5. consumeCoupon()                                        order_acknowledgements
                                     6. shadowLegacy()/createOrder() (commerce)                commerce_orders
                                   ─▶ checkoutService.createCheckoutSession()
                                        recordCheckoutAgreement(session, type, ref, amount)   checkout_agreements
                                        metadata { type, ref }
Stripe Checkout ──webhook──▶ /api/stripe/webhook (raw body, before express.json)
                                     webhook_events (store once) → checkCheckoutAgreement()
                                     → settleOrder() → confirm<Type>(ref)                    payment_status='paid'
                                        orderState: orderStart / listingEligible / orderFits
                                     mismatch / late / ineligible → payment_reviews (D-10)    payment_reviews
                                     recordPaymentConfirmed() → ledger                        ledger_*
                                     notifications.ts (+ email)                               notifications
Cash / free path: steps 1–5, then the row is inserted as payment_status='paid' directly (no money has moved).
```

The shared pieces, and where they live:

| Concern | Shared implementation | Notes |
|---|---|---|
| Checkout session | `checkoutService.ts:122` `createCheckoutSession()` | Paid checkout is refused unless `PAID_CHECKOUT=open`; the agreement is recorded for every session |
| Pricing (legacy) | `pricing.ts:21` `computePricing(subtotal, deposit, discount, coupon)` | 23% VAT on the taxable amount plus a 5% fee on top. **One subtotal; it has no idea of lines** |
| Pricing (engine) | `commerce/engine.ts` `priceWithRules()`, `engineLineItems()`; `commerce/calc.ts` `calculate({ lines[] })` | Live for experiences only (`engineEnabledFor`, `engine.ts:64`); shadow mode for the rest. `calc.ts` **already accepts several lines** |
| Coupons | `pricing.ts:128` `evaluateCoupon()`, `bookingIntegrity.ts` `consumeCoupon()` | Server-side, scoped to a listing |
| Capacity holds | `bookingIntegrity.ts:21` `occupiesCapacitySql()`, `:29` `gameSeatSql()`; `PENDING_HOLD_MINUTES = 30` | Read-time expiry; D-10 `review_hold_until` extends a hold |
| Settlement | `routes/stripeWebhook.ts:215–448` `confirm*()`; `payments/orderState.ts` (`ORDER_TABLE`, `PARENT_LOCK`, `orderFits`) | Re-checks organisation, cancellation, eligibility and capacity |
| Payment review | `payments/paymentReview.ts`, `payments/checkoutAgreement.ts:83` `paymentUnderReview()` | One `payment_reviews` row per session; 5-minute sweep |
| Refunds | `checkoutService.ts:263` `refundPaidOnce()`, `providerCancelRefund.ts`, `commerce/payments.ts` `refundInApp()` | Refunds once per row; partial amounts supported at the provider |
| Attendance | `attendance (kind, ref UNIQUE, status, source)` | One row **per order**; written by `vendorOperations.ts:1030`, `games.ts:958/1030`, `vendorExperiences.ts:634`, `vendorPrograms.ts:292` |
| Acknowledgements | `order_acknowledgements (source_type, source_ref, kind)` | Terms version and safety text fingerprint, per order |
| Seat names | `experience_booking_participants (booking_ref, seat, name)` | Experiences only |
| Listing attributes | `listing_attributes (listing_type, listing_id, attr)` (`listingAttributes.ts`) | Shared tag vocabulary for game, program, experience and club |
| Org sellability | `orgStatus.ts` `offeringSellable()`/`assertSellable()`, `orgSql.ts` `orgActiveSql()` | Required on every new sale path and public read |
| Partner RBAC | `auth.ts:369` `hasPlatformRole()`, `:375` `requirePlatformRole()`; role sets in `routes/vendorHelpers.ts:14–19` | Roles: centre_manager, facility_manager, finance, communications, read_only_analyst |
| Admin RBAC | `adminPermissions.ts` (deny-by-default table) | `finance.operate`, `orders.cancel`, `privacy.requests`, … |
| Audit | `audit.ts` `writeAudit()` (best-effort, never throws) | |
| Consent | `consent_records` (append-only, per subject and purpose) | Marketing and cookies; not consent tied to a booking |
| Privacy requests | `privacyRequests.ts` | **Deletes nothing yet** (`privacyRequests.ts:8–11, 88`, waits on D-07/DEC-14) |
| Waitlist | `waitlist.ts` | `listingType: "club" | "game"` only; offers to the next *person* |
| Feature switches | `circleFeatures.ts` (`app_settings`), `commerce/switches.ts` | Pattern for gating every new feature |

## 2. Listing-by-listing lifecycle

### 2.1 Games and hosted sessions (`games`, `game_participants`)
- **Create:** resident host, `POST /api/games` (`games.ts:1804`), using the two-step `client/src/pages/HostGamePage.tsx`
  (step 1 is the quick "post a pickup game" fields, step 2 is the details). Price is `price_cents` per player, frozen
  once another player joins (`games.ts:410`). `mayHostPaid()` gates paid hosting.
- **Join:** `POST /:id/join` (`games.ts:1914`). Join approval comes from `join_mode` and `/join-requests`. There's
  one seat per resident (`UNIQUE uniq_participant (game_id, resident_id)`). A paid join creates `pending_payment`,
  then the Stripe session, then `confirmGameJoin()` (`stripeWebhook.ts:302`).
- **Attendance:** host check-in per participant (`games.ts:958`), self check-in (`:1030`), and confirm attendance
  (`:1043`).
- **Cancel:** host cancels the game (`:1136`, refunds every participant), removes a participant (`:863`), or refunds
  one participant (`:899`). There's also move (`:1211`) and lifecycle (`:1414`).
- **Reporting:** host earnings appear in My Life / Manage; there's no export.

### 2.2 Experiences and adventures (`experiences` kind adventure|experience, `experience_sessions`, `experience_bookings`)
- **Create:** partner, `POST /vendor/experiences` (`vendorExperiences.ts:174`, roles centre_manager and
  facility_manager), then sessions (`:377`), then publish (`:341`) for moderation.
- **Book:** `POST /api/experiences/:id/sessions/:sessionId/quote|checkout` (`experiences.ts:331/356`). There's one
  `price_cents` × `party_size`. Seat names go to `experience_booking_participants`, and `meetsMinAge`,
  `acceptedTerms` and `acceptedSafety` go to `order_acknowledgements`. Quotes can be priced by the engine. Cash or
  free orders confirm immediately (`:425`).
- **Capacity:** `SUM(party_size)` against session or experience capacity (`orderState.ts` `orderFits`).
- **Attendance:** one row per booking (`vendorExperiences.ts:634`).
- **Cancel:** resident self-cancel (`experiences.ts:613`, rules in `selfCancel.ts`); provider cancel (`:568`) with
  `refundOnProviderCancel()`; cancelling a session cancels all its bookings (`:490`, HC-QA-040); move booking (`:459`).

### 2.3 Volunteering (`experiences` kind `volunteer`)
- Same tables and routes as 2.2. Discovery treats it as its own family (`taxonomy.ts:698–702`). It has
  `skills_required` and `cause`. It's normally free. There are no duties, no hours and no guardian rule.

### 2.4 Programmes (`programs`, `program_sessions`, `program_enrollments`)
- **Create:** partner, `POST /vendor/programs` (`vendorPrograms.ts:61`), with sessions (`:184`). Fields include
  `guardian_rules`, `safeguarding_info`, `instructor_name` and `circle_id`.
- **Enrol:** `POST /api/programs/:id/enroll` (`programs.ts:235`). There's one participant name and DOB and one
  `price_cents`. A free enrolment goes straight to paid (`programs.ts:306`). There's no cash path. Settlement goes
  through `confirmProgramEnrollment()` (`stripeWebhook.ts:417`).
- **Attendance:** per session per enrolment (`vendorPrograms.ts:292`, list at `:390`).
- **Cancel:** resident (`programs.ts:423`); provider cancel or refund (`vendorPrograms.ts:327/339`).

### 2.5 Clubs (`clubs`, `club_sessions`, `registrations`, `passes`)
- **Create:** partner, `POST /vendor/clubs` (`vendorListings.ts`, facility_manager), plus sessions in `clubSessions.ts`.
  There's one `price` + `unit`, a `trial` flag, `payment_method`, and `capacity`.
- **Register:** `POST /api/registrations/quote|checkout` (`registrations.ts:252/275`). There's one person per row:
  `registrant_type` child|adult, child and guardian names, DOB, address, emergency contact, medical,
  `consent`, `waiver_version`, `session_id`, `pass_id`. Cash goes straight to paid (`registrations.ts:378/394`).
  Settlement goes through `confirmRegistration()` (`stripeWebhook.ts:249`).
- **Passes:** `POST /api/passes/checkout` (`passes.ts:89`), **club-only** (`passes.ts:103`), with credits per resident.
- **Waitlist:** clubs and games, with timed offers (`waitlist.ts:59–157`).
- **Attendance and check-in:** `POST /vendor/checkin/registration/:ref` (`vendorOperations.ts:1030`, facility_manager,
  **paid orders only** at `:1045`).

### 2.6 Venues and rooms (`centres`, `rooms`, `room_blocks`, `centre_hours`, `bookings`)
- **Create:** partner, centre plus rooms (`vendorListings.ts`, centre_manager). Each room has `rate`, `cap`,
  `payment_method` and `active`; the centre's `capacity`/`from_price` is a rollup.
- **Book:** `POST /api/bookings/quote|checkout` (`bookings.ts:384/410`, `createBookingInternal()`). The price is
  `hireCost(rate, duration)` with a deposit on online orders. The booking stores `guests`, a free-text `event_type`
  and `notes`. Cash goes straight to paid (`bookings.ts:328`). Open Booking (`open_spots`, `min_participants`) turns a
  booking into a joinable game. Make It Happen reuses `createBookingInternal()`.
- **Attendance:** booking check-in (`vendorOperations.ts:1030`, centre_manager, paid only).
- **Cancel and reschedule:** `bookings.ts:637/688`, `hallBookingCancel.ts`.
- **Reporting:** **the only CSV export in the product**, `GET /vendor/reports/bookings.csv`
  (`vendorInsights.ts:112`). Contact columns are for finance only, and formula cells are neutralised.

### 2.7 Circles (`circles`, `circle_members`, …)
- **Create and join:** `POST /api/circles` (`circles.ts:1404`) and `/join` (`:1449`), with join requests, restrictions
  and organiser roles (promote, demote, mute). Unpaid. Games, experiences, programmes and clubs link to a Circle
  through `circle_id`.
- **Circle 2.0–4.0 features:** plans, pulse, memories and the visitor page, each behind a `circles.*` switch.

### 2.8 Shared reporting today
`vendorInsights.ts`: `/participants`, `/customers`, `/payments` (finance), `/earnings`, `/demand`, `bookings.csv`.
`vendorOperations.ts:106` gives monthly statements. Admin finance is in `adminFinance.ts`. **There's no export for
one occurrence** (one session, departure or game).

## 3. Capability matrix (verified)

✅ works · ½ partly · ✕ missing · – not relevant to this type

| Requirement | Game | Experience | Volunteer | Programme | Club | Venue | Circle | Pass |
|---|---|---|---|---|---|---|---|---|
| **R1** several options or prices | ✕ one `price_cents` | ✕ one price × party | – (free) | ✕ one price | ½ price + unit + trial | ½ a rate per room, no packages | – | ½ one credit pack |
| **R2** payer and attendees separate, adult/child | ✕ one seat per resident | ½ party_size + seat names; no age band or role | ½ one person | ½ one participant + DOB | ½ registrant_type, guardian + child, one per row | ½ `guests` count | – | – |
| **R3** custom questions | – | ½ fixed fields (min age, safety ack) | ✕ | ½ fixed (guardian rules are free text) | ½ fixed (medical, emergency, consent) | ½ `event_type`/`notes` free text | ½ join questions | – |
| **R4** donations | – | ✕ (`cause` exists, no money line) | – | – | ✕ | – | – | – |
| **R5** external payment, verified | ✕ (cash = paid) | ✕ (cash = paid) | – | ✕ | ✕ (cash = paid) | ✕ (cash = paid) | – | ✕ |
| **R6** group check-in per attendee | ½ one row per seat | ½ one row per booking | ½ | ½ per session per enrolment | ½ per registration | ½ per booking | – | – |
| **R7** volunteers or duties per occurrence | ✕ no co-host | ✕ | ✕ | ½ `instructor_name` | ✕ | – | ½ organiser roles | – |
| **R8** privacy (role scoping, retention) | ½ | ½ PII by role (Option A) | ½ | ½ | ½ | ½ | ½ | ½ |
| **R9** per-occurrence reporting | ✕ | ✕ | ✕ | ½ attendance list | ✕ | ½ bookings.csv (all dates) | – | – |

R8 is partial for every type in the same way: staff PII is masked by role (Option A, `vendorPiiRoles.test.ts`), but
no retention or erasure runs anywhere (`privacyRequests.ts:8–11`).

## 4. Existing functionality that must be preserved

1. **The `{ type, ref }` checkout metadata literals** (`booking | registration | game | program | pass | experience`)
   and their routing in `stripeWebhook.ts`. One Stripe session pays for exactly one ref.
2. **Checkout agreement:** the webhook confirms only the amount agreed at session creation. New lines must add up to
   that amount. `engineLineItems()` already throws if they don't (`engine.ts:132`).
3. **D-10/D-11 payment reviews:** `review_hold_until` semantics, the 5-minute sweep, no automatic refund on expiry,
   and "Recheck with Stripe" being read-only.
4. **Capacity predicates:** `occupiesCapacitySql`, `gameSeatSql`, the 30-minute holds, and `PARENT_LOCK` order.
   Experiences count `SUM(party_size)`; nothing may start counting rows there.
5. **Cash behaviour of existing listings:** cash rooms, clubs and experiences confirm immediately. Changing that is a
   commercial and operational decision (PD-5). New external-payment modes must be opt-in and separate.
6. **D-01 sellability** on every sale path and public read; **D-02** deny-by-default admin permissions (every new
   admin route declares one; `adminPermissions.test.ts` fails otherwise); **partner RBAC** with Option A PII
   masking.
7. **The casual game flow:** two steps, one price per player, quick join. Nothing proposed may add required fields.
8. **Additive schema only** (`ensureColumn`, `CREATE TABLE IF NOT EXISTS`); no FKs; no down-migrations.
9. **Shadow pricing and engine switches:** `commerce.engine_v2*` stay the route to new pricing; legacy orders are
   never re-priced.
10. **The five participation tables stay separate** (CLAUDE.md "Known gaps").
11. **Design rules:** no drawers (`Drawer` renders `Modal`), 70/30 `RecordView` record pages, `ConfirmDialog`,
    `components/form.tsx` conventions, workspace 4px and consumer 12px controls, no page animations.

## 5. Confirmed gaps, with code references

| # | Gap | Evidence | Affects |
|---|---|---|---|
| G1 | One price per listing; no options, tiers, bundles or add-ons | `experiences.price_cents`; `programs.price_cents`; `games.price_cents`; `clubs.price`; quote functions multiply one price (`experiences.ts:245–256`) | R1 |
| G2 | Pricing takes one subtotal | `pricing.ts:21`; every route builds `subtotalCents` itself | R1, R4 |
| G3 | Every money line carries VAT + fee | `computePricing()` applies `VAT_RATE` and `PLATFORM_FEE_RATE` to the whole taxable amount | R4 |
| G4 | Cash = paid at creation | `bookings.ts:328`, `registrations.ts:394`, `experiences.ts:425/481` | R5 |
| G5 | No external-payment record or verification | No table or route; `payment_reviews` is Stripe-session-only | R5 |
| G6 | Seats have names only (no age band, role, household link, per-seat answers) | `experience_booking_participants` (3 columns) | R2, R3 |
| G7 | Household members unused by any booking flow | `household_members` read only by `household.ts`, `residents.ts`, `admin.ts` | R2 |
| G8 | One seat per resident in games | `uniq_participant (game_id, resident_id)` | R2 (+1s) |
| G9 | Clubs and programmes are one person per row, with one Stripe session per ref | `registrations` fields; `metadata { type, ref }` | R2 (siblings) |
| G10 | No custom questions or answers | No table; fixed columns only | R3 |
| G11 | Attendance is per order, not per attendee | `attendance.ref UNIQUE` | R6 |
| G12 | Vendor check-in refuses anything but paid; covers bookings and registrations only | `vendorOperations.ts:1032, 1045` | R5, R6 |
| G13 | No roles scoped to one occurrence (door, volunteer, co-host) | Partner roles are org-wide (`vendorHelpers.ts`); games have no co-host | R7, R8 |
| G14 | No retention or erasure execution | `privacyRequests.ts:8–11, 88` | R8 |
| G15 | Waitlist offers go to the next person regardless of group size; clubs and games only | `waitlist.ts:59–76` | R2 |
| G16 | No export for one occurrence; the only CSV is venue bookings | `vendorInsights.ts:112` | R9 |
| G17 | No "community event" kind; experience editors show adventure fields | `experiences.ts:40` kinds `adventure | experience | volunteer` | All |
| G18 | Passes are club-only and can't be mixed with a paid seat | `passes.ts:103` | R1, R2 |
| G19 | No option limited to Circle members | No eligibility on price | E-member pricing |
| G20 | `commerce.engine_v2` live for experiences only | `engine.ts:64` | Multi-line pricing elsewhere |
