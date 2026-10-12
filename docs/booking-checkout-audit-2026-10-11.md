# HelloCircle — End-to-End Booking & Checkout Audit

Branch `feature/commerce-engine` @ `e2a74a6`, 2026-10-11. **Audit only:** no code, schema, config or data was changed.
No live payment calls, no pushes, no deploys.

**How this was verified**
- **Code reading.** Every finding cites `file:line`.
- **Tests run in this audit:**
  - Client Vitest: **18 files, 110 passed**.
  - Server Vitest: **73 files, 774 passed, 23 skipped** (live-provider tests). It ran in the isolated Docker profile (`server/src/scripts/testIsolated.ts`): a disposable `hello_circle_test_<runid>` database, never dev or prod.
- **Not run:** the Playwright/`qa:*` integration and Stripe TEST harness. Where this report cites those results, they come from earlier QA reports (`QA_INTEGRATIONS.md`, `QA_REPORT.md`) and are marked *historical*.
- Labels used: **[V]** verified in code or by a test run here, **[H]** historical report not re-run, **[A]** assumption or needs a business/legal decision.

---

## A. Executive summary

**Overall readiness: not launch-ready for paid bookings. It is close to ready for free participation** (free events,
Circles, free club/programme sign-ups).

The booking engine core is better than most at this stage:
- row-locked capacity checks
- 30-minute holds tied to Stripe session expiry
- idempotent webhooks with event de-duplication
- refund-once with idempotency keys
- server-side pricing everywhere
- dispute and refund records

All of that is real and tested. Do not rebuild it.

The launch blockers are concentrated in four places:

1. **A price-bypass exploit (P0).** Any paid club registration can be made free by sending `trial: true`. The server
   never checks that the club offers a trial, or that this person hasn't already used one (`server/src/routes/registrations.ts:291`).
2. **"Host books a venue and resells places" is financially broken (P0).** Open Booking's per-person price is the host's
   *total* split across the open spots. That total already includes 23% VAT, the 5% fee and the €100 deposit. Each joiner
   is then charged 23% VAT and 5% fee *again* on top. The host is never reimbursed. A €80 hall hire collects about
   €410 (worked example in §F).
   - Cancelling or rescheduling the venue booking does not touch the linked event. Paid joiners are left holding
     tickets to a slot that no longer exists, or that has moved.
3. **The commercial model is undecided in code (P0, business decision).** Two incompatible models coexist:
   - **Live default** (every `commerce.*` switch is off, `server/src/commerce/catalog.ts:386-398`): the customer pays
     list price + 23% VAT + 5% fee, HelloCircle is the sole merchant, there is no Connect, and vendor settlement is manual.
   - **Commerce engine "pe-2"** (`server/src/commerce/calc.ts:1-20`): the fee is deducted from the partner, VAT is
     charged on the fee only, and payouts go through Connect. It covers experiences only.

   The live model charges a flat 23% VAT on every vendor's price, with no VAT-status, exemption or rate-per-category
   handling. Irish VAT treatment of hall lettings, sports facilities and children's activities varies. **[A] Needs an
   Irish tax adviser before launch.**
4. **Refunds are manual promises.**
   - "Refundable €100 deposit, refunded within 5 days" is shown to customers, but nothing refunds it.
   - A customer self-cancel produces "refund pending" until a vendor finance user acts. There is no queue SLA and no reminder.
   - A vendor cancelling a paid booking does not refund it.

**Other P1s:**
- The public availability calendar shows cancelled bookings (and stale holds) as taken.
- Open Booking can overfill a room (only `guests` is checked against room capacity, not `guests + openSpots`).
- Hosts can attach an event to any venue without a reservation.
- `min_age` is stored but enforced nowhere.
- Booking refs are 6 random digits with no collision retry.
- Medical/child data has no retention or erasure policy.
- Checkout forms lack `autocomplete`, `type="tel"` and associated labels.

**What's working and should be kept:**
- the capacity invariants in `QA_BOOKING_MODEL.md`
- the `checkoutService` / `stripeWebhook` contract
- `refundPaidOnce`, payment records, refunds, disputes and webhook-event tables
- Ireland DST-aware time (`irelandTime.ts`)
- RBAC on vendor operations
- the household picker on club registration
- coupon reservation and release
- the commerce engine as a *future* basis

---

## B. Feature audit matrix

Status: **Impl** = implemented · **Partial** · **Missing** · **Defect** = defective · **NV** = not verified

| # | Scenario | Expected | Current implementation | Status | Evidence | Sev | Action |
|---|---|---|---|---|---|---|---|
| 1 | Customer books a venue | Pick room/slot → details → pay → confirm → manage | 4-step `BookingFlow`. Server pricing. Locked overlap check. Stripe or cash. Guest cancel and reschedule (org cutoff). | Impl (with defects below) | `client/src/pages/BookingFlow.tsx`, `server/src/routes/bookings.ts:144-342`, `:525-674` | — | Keep. Fix items 1a–1e. |
| 1a | Availability calendar accuracy | Cancelled or expired holds free the slot | The public availability query excludes only `payment_status='failed'`. **Cancelled bookings and stale pending holds still show as booked.** Checkout itself uses the correct predicate. | **Defect** | `server/src/routes/availability.ts:81` vs `occupiesCapacitySql()` at `server/src/routes/bookings.ts:226` | **P1** | Use `occupiesCapacitySql()` in availability. |
| 1b | Booking ref uniqueness | Collision-safe refs | `HB-` plus 6 random digits (900k space). `UNIQUE` column, no retry, so a collision is a 500 at checkout. Collision probability climbs into the percent range at tens of thousands of rows. | **Defect** | `server/src/util.ts:6-9`, `server/src/db/index.ts:222` | P2 | Longer ref plus retry-on-duplicate. |
| 1c | Cash bookings | Vendor collects; status reflects money not yet received | Marked `payment_status='paid'` at creation. VAT and the 5% platform fee are added to the "due in cash" total, and HelloCircle has no way to collect its fee. | **Defect** | `server/src/routes/bookings.ts:206,281-310` | P1 | Add a `pay_at_venue` status. Decide the fee model for cash (invoice the vendor, or no fee). |
| 1d | Reschedule notification | "Booking changed" message | Reuses `notifyNewBookingOrRegistration`, so it is labelled as a new booking. No suspended-vendor or `isOpen` re-check. | Partial | `server/src/routes/bookings.ts:657-669` | P3 | Dedicated template; re-check venue state. |
| 1e | Deposit return | Deposit refunded after the event, as promised | Promise in the UI ("refunded within 5 days"). It is only possible manually through the vendor partial-refund route. No job, reminder or queue. | **Missing** | `client/src/pages/BookingFlow.tsx:554`, `server/src/checkoutService.ts:67`, `server/src/routes/vendorOperations.ts:308-333` | **P1** | Deposit-release queue with a due date (or a pre-auth hold instead of a charge). Change the copy until then. |
| 2 | Sports facility / court | Short slots, per-court inventory | Same as venues: rooms work as courts. Whole-hour grid only (`TIME_SLOTS`). No 30/45-minute slots, no recurring court bookings, no per-room hours. | Partial | `server/src/routes/bookings.ts:158,164` | P2 | Add slot-length per room; per-room hours. |
| 3 | Adventure / experience | Session → party → pay → confirm | Session capacity under `FOR UPDATE`. Party size is validated. Engine pricing when switched on. Self-cancel with cutoff. Vendor cancel, refund and attendance. | Impl (gaps) | `server/src/routes/experiences.ts:326-470`, `server/src/selfCancel.ts` | — | Keep. |
| 3a | Age / safety / waiver | Enforce `min_age`; record safety acknowledgement | `min_age`, `safety_info`, `fitness_requirements` and `eligibility` are displayed only. None is enforced or acknowledged. No per-participant names for party > 1. No emergency contact. | **Missing** | `server/src/routes/experiences.ts:53,123` (read only); the insert at `:420` has no such fields | **P1** | Per-participant name and age band. Required acknowledgement checkbox, stored with a version. Emergency contact for adventure kinds. |
| 4 | Class / workshop (programme) | Enrol in a multi-session programme | Programme enrolment: locked capacity, coupon, self-cancel (no cutoff), vendor cancel and refund. | Impl | `server/src/routes/programs.ts:213-330,397`, `server/src/routes/vendorPrograms.ts:305,353` | P3 | Add a cancellation cutoff once the programme has started. |
| 4b | Club registration | Child or adult registration with guardian data | Child/adult flows, guardian, emergency contact, medical, consent + `waiver_version`, household picker, session and club capacity, waitlist. | Impl (exploit 4c) | `server/src/routes/registrations.ts:20-200`, `client/src/pages/RegistrationFlow.tsx:328` | — | Keep. |
| 4c | Free-trial bypass | Trial only if the club offers it, once per person | **`body.trial` is trusted.** `subtotal = body.trial ? 0 : price`. The registration is confirmed as `paid` and takes a capacity place. `clubs.trial` is never checked, and nothing limits it to one trial per person (dedupe is per client id + name + DOB). | **Defect (exploit)** | `server/src/routes/registrations.ts:291-317`; column `server/src/db/index.ts:202`; no test covers it | **P0** | Reject `trial` unless `club.trial = 1`. Limit to one trial per email/resident per club. Add a test. |
| 5 | Join a free event | One tap for a signed-in resident | Free game join: locked capacity, waitlist, min-participants threshold. | Impl | `server/src/routes/games.ts:1458-1610` | — | Keep. |
| 6 | Join a paid event | Pay → confirmed | Paid game join: `pending_payment` hold → Stripe → webhook confirm. Needs a verified host (switch on by default). | Impl | `server/src/routes/games.ts:1547-1640`; catalog switch at `:387` | — | Keep. Host payout is manual (§F). |
| 7 | Join a free Circle | Instant join | `join_mode='open'` inserts the member. | Impl | `server/src/routes/circles.ts:1047-1049` | — | — |
| 8 | Request a private Circle | Request (+ optional questions) → organiser approves | Approval mode creates a pending request and notifies organisers; respond accepts or declines. **No approval questions or message.** The respond update isn't conditional on `status='pending'` (a double click races). No member cap. | Partial | `server/src/routes/circles.ts:1006-1045,1101-1138` | P2 | Optional organiser questions plus a request note. Make the update conditional. |
| 9 | Purchase a membership | Recurring or term membership with renewal | **No customer membership product.** The closest are credit-pack passes (club only, one-off, price × credits, no expiry set at purchase, no in-app refund path because `passes` isn't in `VENDOR_REFUND_OWNER_SQL`). Club `price`/`unit` (e.g. "year") is charged once with no renewal. Pro subscriptions are for *partners*, not customers. | **Missing** | `server/src/routes/passes.ts:38-80`, `server/src/routes/vendorOperations.ts:312-317` | P1 (if memberships are in the launch scope) | Decide the scope. If needed: Stripe Billing customer subscriptions keyed to a club/Circle. |
| 10 | Host books a venue to organise an event | Host reserves the venue, then publishes the event linked to the reservation | Only through Open Booking (booking + `openSpots` → auto-created game with `booking_ref`). The link is one-directional and only made at creation. | Partial / Defect | `server/src/routes/bookings.ts:62-107` | **P0** | See 13. |
| 11 | Host creates a free event | Create, publish, manage | Game creation with lifecycle, visibility, Circle plan rules. **`centreId` is accepted with no existence or availability check and no reservation.** | Impl / Defect | `server/src/routes/games.ts:1320-1390,1211-1260` | **P1** | Require a confirmed booking ref (or venue approval) when a centre is named; otherwise free-text location only. |
| 12 | Host creates a paid event | Verified host, paid tickets, payout | Paid games are gated to verified hosts. Payment goes to the platform. Host "earnings" list `price_cents` gross. Payout is manual unless `commerce.connect_v1` is on (off). | Partial | `server/src/routes/games.ts:327-347`; catalog switch at `:393` | P1 | Turn on host settlement (engine + Connect) or document manual payout terms. |
| 13 | Host books a venue and resells places | Venue cost recovered, tickets priced once, capacity tied to the room, lifecycle linked | **(a)** Joiner price = `ceil(total_incl_VAT_fee_deposit / (spots+1))`, then VAT and fee are added again, so VAT and fee are charged twice and joiners pay a share of the host's refundable deposit. **(b)** The host is not credited. **(c)** No `guests + openSpots ≤ room.cap` check. **(d)** Venue booking cancel or reschedule doesn't cancel or move the game. **(e)** The venue vendor doesn't see joiners. | **Defect** | `server/src/routes/bookings.ts:62-107,165,527-579,583-674`; `server/src/pricing.ts:39-41`; `server/src/routes/games.ts:1627` | **P0** | Disable Open Booking resale (feature flag) until it's redesigned: price from the hire subtotal only, single VAT/fee, host credit or split (the engine has `venue_host_split_payout`), cascade cancel/reschedule with refunds, capacity check. |
| 14 | Vendor creates a listing, accepts bookings | Signup → approval → listing live → bookings | Signup creates a pending listing in a transaction. Admin approval. Rooms, blocks, hours. Vendor booking list, cancel, resend, refund (role-gated). | Impl | `server/src/routes/auth.ts` signup; `server/src/routes/vendorOperations.ts:31-333` | — | Keep. |
| 15 | Vendor runs and sells own activity | Programmes / experiences / club sessions | Programmes, experiences and club sessions are all vendor-run with payment. | Impl | `server/src/routes/vendorPrograms.ts`, `server/src/routes/vendorExperiences.ts`, `server/src/routes/clubSessions.ts` | — | — |
| 16 | Multiple participants | Party size + names where needed | Experiences: `partySize` with one name. Venues: `guests` count. Clubs/programmes: one participant per checkout (siblings = repeat checkout; household picker helps). Games: one resident per join. | Partial | as above | P2 | Multi-participant cart for clubs and programmes (sibling registration); names per seat for experiences. |
| 17 | Customer cancel / reschedule / refund | Self-serve within policy; refund automatic per policy | Self-cancel for bookings (cutoff), registrations (**no cutoff**), programmes (no cutoff), experiences (cutoff), games (leave). Reschedule only for venue bookings. **Refund is never automatic** ("Policy A": stays `paid` + `cancelled` until a vendor refunds). No "request a refund" without cancelling. | Partial | `server/src/selfCancel.ts:1-45`, `server/src/routes/bookings.ts:525` | **P1** | Auto-refund inside the policy window (Stripe, idempotent, already built in `refundPaidOnce`). Admin queue for out-of-policy refunds. |
| 18 | Vendor/host cancels or modifies | Customer refunded in full plus notified | Vendor cancel flips status and notifies. **No refund is issued**: refund is a separate finance-role step. Host game cancel notifies but doesn't refund paid joiners. Session cancel cascades to children (experiences) but leaves them `paid` + `cancelled`. | Partial | `server/src/routes/vendorOperations.ts:56-108`, `server/src/routes/games.ts:882-940` | **P1** | A provider-initiated cancel must auto-refund 100% (consumer expectation, Irish CCPC guidance **[A]**). |

---

## C. Booking data collection matrix

Legend: **R** required (server-enforced) · **R(UI)** required by the UI only · **O** optional · **—** not collected · **⚠** collected but questionable

| Field | Venue / court booking | Club registration | Programme | Experience | Paid / free event (game) | Circle |
|---|---|---|---|---|---|---|
| Identity | name O (only checked as a field) | guardian names R(UI), participant names R | participant name R | participant name R | resident account (magic link) | resident |
| Email | R + format | R + format | R | R | account | account |
| Phone | O (no `type="tel"`, no validation) | R(UI) | — | O | — | — |
| Date/time/duration | R, whole-hour grid, Ireland TZ | session optional | programme dates | session | game date/time | — |
| Participant count | `guests` R ≤ room cap | 1 per checkout | 1 | `partySize` ≤ capacity | 1 | — |
| Per-participant names | — | ✔ (1) | ✔ (1) | **— for party > 1** | — | — |
| Age / DOB | — | DOB R (child), plausibility only, **not checked vs club ages** | — | **`min_age` not enforced** | **`min_age` not enforced** | — |
| Guardian | — | R(UI) for child | — | — | — | — |
| Emergency contact | — | R(UI) child, O adult | — | **—** | — | — |
| Skill / experience | — | team (age group) | — | display only | `skill_level` display only | — |
| Accessibility / special requirements | `notes` free text | `medical` free text ⚠ | — | — | — | — |
| Safety acknowledgement | — | consent + `waiver_version` ✔ | — | **— (needed for adventure)** | — | — |
| Membership questions | — | — | — | — | — | **—** |
| Cancellation policy shown | detail-page copy; not in the checkout step | — | — | `cancellation_terms` shown | `cancellation_policy` shown | — |
| Terms accepted at checkout | **—** | waiver only | **—** | link only | — | — |
| Home address | — | **R(UI) ⚠** | — | — | — | — |
| Payment | Stripe Checkout (card data never touches HelloCircle) ✔ | same | same | same | same | — |

**Recommendations (GDPR data minimisation, Art. 5(1)(c)):**
- **Drop the mandatory home address** for club registration (`client/src/pages/RegistrationFlow.tsx:135-136`) unless a
  club has a documented need. Make it a per-club opt-in field.
- **`medical` is special-category data (Art. 9).**
  - Change it to a structured "anything the coach should know?" field with explicit purpose wording.
  - Restrict it to the owning org's `facility_manager` role.
  - Log access.
  - Set a retention rule. There is **no retention or erasure job** for registrations today.
- **Reuse account data:**
  - Prefill name, email and phone from the resident in `BookingFlow` and programme flows (`ExperienceDetail.tsx:160,179` already does email).
  - Extend the household picker (`client/src/pages/RegistrationFlow.tsx:328`) to programmes and experiences.
- **Record terms acceptance** (version + timestamp) on every paid order, not only club waivers.
- **Progressive disclosure:**
  - Ask emergency contact and age only when the listing requires them (`min_age`, kind = adventure, audience = children).
  - Ask phone only when the vendor needs it.

---

## D. UX improvement recommendations (screen by screen)

**Booking (`client/src/pages/BookingFlow.tsx`)**
1. Labels aren't programmatically associated: `<label>` has no `htmlFor` and the inputs have no `id` (`:472-492`).
   This is a WCAG 1.3.1/4.1.2 failure; screen readers announce unlabeled fields.
2. Add `autoComplete="name|email|tel"`, `type="tel"` and `inputMode="tel"` to phone, and `inputMode="numeric"` to guests.
   There are no `autoComplete` or `inputMode` attributes anywhere in the booking or registration flows.
3. Prefill from the signed-in resident (the `useGuest()` resident is already loaded at `:80`).
4. Show the **cancellation cutoff** (org `cancellationHours`) and the **deposit terms** on the review step, next to the total.
5. The price breakdown is computed client-side (`:163-166`) from the `VAT_RATE`/`PLATFORM_FEE_RATE` constants. It will
   drift as soon as rules change or the engine is switched on. Use a server `/quote` (as experiences and programmes already do).
6. Fees: "VAT (23%)" and "Platform fee (5%)" are listed as add-ons, so a €40 listing becomes €49.20 + €100 deposit at the
   last step. For consumer pricing in Ireland, show the **all-in price** from discovery onward **[A: Consumer Protection
   Act 2007 / CCPC price-display guidance — confirm with counsel]**.

**Registration (`client/src/pages/RegistrationFlow.tsx`)**
- Four steps for one child is heavy. Collapse guardian and contact into one step when a household member is picked.
- Remove the mandatory address.
- Add multi-child registration in one checkout.

**Experience / programme detail checkout**
- Add per-seat names when `partySize > 1`.
- Add a required safety/fitness acknowledgement for adventure kinds.
- Show the age requirement before the party selector.

**Confirmation (`client/src/pages/PaymentSuccess.tsx`)**
- Has add-to-calendar.
- Add: what happens next, the cancellation deadline as a date ("Free cancellation until Thu 14 Nov, 18:00"), the deposit
  return date, the venue address/map, and a "Manage booking" link that works on another device (ref + email lookup already exists).

**Cancellation (My Bookings)**
- Show the refund outcome *before* confirming: "You'll get €X back to your card within 5–10 days" versus "Refund pending
  from the venue".
- Today a self-cancel ends at "refund pending" with no timeline.

**Joining (events, Circles)**
- The approval-Circle request needs a "Tell the organiser about yourself" note and a visible pending state.
- Paid-event join should show host identity, refund policy and "what if the event is cancelled" before payment.

**Loading and errors.** The 409 conflict path already offers similar venues (`BookingFlow.tsx:90-92`); keep it. Add an
explicit "your hold expires in 30:00" indicator. Stripe's page expires at 30 minutes and customers currently get no warning.

---

## E. Database and API findings

| # | Finding | Evidence | Sev | Dependency / migration risk |
|---|---|---|---|---|
| E1 | Venue booking ↔ host event link is one-way (`games.booking_ref`), with no cascade on booking cancel or reschedule | `server/src/routes/bookings.ts:62-107,527-674` | **P0** | Additive: a lookup by `booking_ref` inside the cancel/reschedule transactions. Needs a refund policy for joiners. |
| E2 | `games.centre_id` is unvalidated, with no reservation requirement | `server/src/routes/games.ts:1211-1260` | P1 | Existing rows may reference venues without bookings. Grandfather them and validate new ones only. |
| E3 | Public availability uses a different occupancy predicate from checkout | `server/src/routes/availability.ts:81` | P1 | No schema change. |
| E4 | Trial flag trusted from the client | `server/src/routes/registrations.ts:291` | **P0** | No schema change. Audit existing `trial=1` registrations on paid clubs. |
| E5 | No indexes on the hot booking lookups: `bookings(room_id,date)`, `registrations(club_id)`, `experience_bookings(session_id)`, `program_enrollments(program_id)`, `client_id`, `email`, legacy `stripe_session_id`. The `FOR UPDATE` sections then scan. | `server/src/db/index.ts` (only commerce tables get `ensureIndex`, `:2222-3454`) | P2 (P1 at volume) | `ensureIndex` is additive and online for InnoDB. |
| E6 | 6-digit refs, no collision retry | `server/src/util.ts:6` | P2 | Changing the format affects support lookups. Keep the prefix and lengthen it. |
| E7 | No `completed` / `no_show` state on `bookings`. Cash rows are labelled `paid`. | `server/src/routes/bookings.ts:281` | P2 | Additive status values. Reports that count `paid` must be updated. |
| E8 | No FK constraints (documented choice); polymorphic `listing_type/id` | CLAUDE.md | P3 | Accept for launch. Add orphan-check reports instead. |
| E9 | Registration `medical`/`dob`/`address` are plaintext, with no retention or erasure | `server/src/routes/registrations.ts:86-120` | P1 (GDPR) | Retention job plus erasure endpoint. Erasure must keep financial records (anonymise, don't delete). |
| E10 | Circle join-request respond isn't state-conditional | `server/src/routes/circles.ts:1124` | P3 | None. |
| E11 | Guest cancel/reschedule authorises with ref + email (`OR client_id`). Combined with 6-digit refs and a 10-per-15-min per-IP limiter, risk is low but not zero for targeted abuse. | `server/src/routes/bookings.ts:527-540`, `server/src/rateLimit.ts:51` | P2 | A signed manage-link token in the confirmation email is better. |
| E12 | The five (six, with experiences) participant tables aren't unified (documented, deliberate) | CLAUDE.md | — | Do **not** unify before launch. |

**Working well (keep):**
- `FOR UPDATE` serialisation per parent resource
- `occupiesCapacitySql` with 30-minute holds
- atomic cancel (`changes === 1`)
- coupon reservation and release (`endPendingHold`)
- the `webhook_events` de-dupe with busy/park states
- `payment_records` / `refunds` / `disputes` tables
- audit rows on refunds

---

## F. Payment and revenue findings

**F1 — Live commercial model (all `commerce.*` switches off, `server/src/commerce/catalog.ts:386-398`).** [V]
- `customer total = price − coupon + 23% VAT + 5% platform fee (+ €100 deposit, online venue rooms only)`
  (`server/src/pricing.ts:5-27`, `server/src/checkoutService.ts:61-71`).
- HelloCircle is the sole merchant of record. There is no Connect, and vendor settlement is manual or off-platform
  (`server/src/checkoutService.ts:33-41`). That comment is now stale: Connect code exists but is switched off.
- **Risks:**
  - **[A]** If HelloCircle is merchant of record for the whole service, VAT is due on the *whole* consideration,
    including the 5% fee. The code applies VAT to the subtotal only (`server/src/pricing.ts:22-25`), so if the fee is
    VAT-able it is under-collected.
  - Conversely, if vendors are the suppliers (agent model), HelloCircle shouldn't be adding 23% VAT on behalf of
    vendors that may not be VAT-registered or may be exempt.
  - Either way, a flat 23% on every listing is unlikely to be right for all categories.
  - **Decision required:** agent model (pe-2) or merchant model.
- **The commerce engine (pe-2)** already implements the agent model:
  - fee deducted from the partner, VAT on the fee only
  - `vatMode` standard/exempt/reverse_charge
  - plan rates: Free 9% + €0.75, Pro 7% + €0.50 + €29/month
  - payment-cost estimates: 1.5% + €0.25 (`server/src/commerce/calc.ts:10-15`; rollout doc stage 2a)

  These rates are **seeded defaults, not verified against Stripe's actual IE pricing or the signed Stripe agreement [A]**.
  The engine covers only experiences (`commerce.engine_v2_experience`).

**F2 — Open Booking double-charges (P0).** [V] Worked example from the code:
- Room €40/h × 2h.
- Host pays €80 + €18.40 VAT + €4.00 fee + €100 deposit = **€202.40**.
- With 4 open spots, game price = `ceil(20240/5)` = €40.48 (`server/src/routes/bookings.ts:98`).
- Each joiner pays €40.48 + €9.31 VAT + €2.02 fee = **€51.81** (`server/src/routes/games.ts:1627`). Four joiners pay €207.24.
- **HelloCircle collects €409.64 for an €80 hire.** VAT is charged on VAT, and joiners fund 4/5 of a deposit that
  is later returned only to the host. The host is never reimbursed.

**F3 — Cash bookings.**
- The platform fee and VAT are added to cash-on-arrival totals, but HelloCircle can't collect either.
- Rows are marked `paid` at creation (`server/src/routes/bookings.ts:206,281`).
- Revenue reporting overstates collected money.

**F4 — Stripe costs on refunds and deposits.**
- Every refund (including the €100 deposit) is a full or partial refund of a charge whose Stripe fee isn't returned.
  The platform absorbs about 1.5% + €0.25 on the deposit for every venue booking.
- A pre-authorisation (`capture_method=manual`) or a deposit taken only when needed would avoid it.
- Card pre-auths expire after about 7 days **[A]**, so this only works close to the event date.

**F5 — Refund allocation.**
- `refundPaidOnce` refunds the remaining full amount, including HelloCircle's fee (`server/src/checkoutService.ts:254-310`).
- Partial refunds go through `/vendor/refunds` with `responsible: "partner"` (`server/src/routes/vendorOperations.ts:319-333`).
- With manual settlement there's no automatic clawback if the vendor was already paid. The ledger (`commerce.settlement_ledger`) is off.

**F6 — Disputes.** Recorded with fee and reserve ledger lines (`server/src/commerce/payments.ts:359-395`). The booking
status is unaffected, and nobody is notified to submit evidence. **P2:** admin alert plus evidence-due reminder.

**F7 — Coupons.**
- Server-validated and atomically reserved.
- Funding (partner/platform/split) is recorded but only *settles* through the engine.
- In the legacy model, who funds a coupon is not reflected in any payout.
- Programme coupons can't be listing-scoped (`server/src/routes/programs.ts` comment at `:231-240`). P3.

**F8 — Rewards, credits, Pro.** All built on this branch and switched off by default:
- customer credits apply only to engine-priced (experience) checkouts
- partner reward points
- Pro subscription

They are not launch-critical. Keep them off until F1 is decided.

**F9 — Webhook integrity.**
- Signed events only in production (`STRIPE_WEBHOOK_SECRET` required).
- Duplicate-safe confirms.
- SEPA async handling.
- `charge.refunded` and `charge.dispute.*` recorded.
- Confirm does not compare `amount_total` to the stored `total_cents`. Low risk, because the server sets the line items,
  but this is a cheap reconciliation assert. P3.

**F10 — Reconciliation.** `payment_records` + `refunds` + `disputes` + (optionally) the double-entry ledger exist.
Turning on `commerce.settlement_ledger` is the prerequisite for any real payout reconciliation. **[H]** Earlier TEST-mode
runs: `qa:stripe` 34/34 (`QA_REPORT.md:64`), not re-run here.

---

## G. QA test coverage matrix

**Existing coverage.** Run here [V]:
- server 774 passed / 23 skipped
- client 110 passed

Not re-run [H]: about 115 Playwright/integration specs under `tests/integration/specs` (booking-*, stripe-*,
stripe-sandbox-*, authorization-*, lifecycle-*, revenue-*, product-a11y-*).

| Area | Existing | Missing test → expected outcome | Priority |
|---|---|---|---|
| Trial bypass | none (`registrations.test.ts` only uses `trial:false`) | POST with `trial:true` on a paid club with `trial=0` → 400. A second trial for the same email → 409. | **P0** |
| Open Booking pricing | none | Joiner price is derived from the hire subtotal; VAT/fee applied once; sum of shares ≤ hire cost | **P0** |
| Booking cancel/reschedule → linked game | none | Cancel → game cancelled, joiners refunded and notified. Reschedule → game date/time moved. | **P0** |
| Availability vs cancelled bookings | none | A cancelled or stale-pending booking's slot appears free in `/availability` | P1 |
| Room overfill via open spots | none | `guests + openSpots > cap` → 400 | P1 |
| Game with `centreId` without booking | none | 400/403 unless a booking ref is owned by the host | P1 |
| `min_age` enforcement | none | An under-age participant is refused (experiences, games) | P1 |
| Vendor cancel ⇒ refund | refund-once covered (`checkoutService.refund.test.ts`, `stage-b-refund`) [H] | Vendor cancel of a paid booking → refund issued automatically, idempotent | P1 |
| Deposit release | none | Deposit-due queue lists bookings N days after the event | P1 |
| Ref collision | none | Duplicate ref → retried, not 500 | P2 |
| Concurrency | games, registrations, sessions (real MySQL) [V] | Venue room double-book race; experience session race | P2 |
| Webhooks | idempotency, policy, signature [V] | Amount mismatch assert | P3 |
| Role permissions | `QA_AUTHORIZATION_MATRIX.md` + authorization-* specs [H] | — | — |
| Mobile usability | lifecycle-ui-responsive [H] | Booking and registration forms at 375px with the on-screen keyboard (autocomplete/inputMode) | P2 |
| Accessibility | product-a11y-a..e [H] | Booking form labels associated (axe "label" rule on `/book/:id` step 3) | P1 |
| Fake-provider payments | QA provider stub (`qaProviderStubEnabled`) [V] | Expand to Open Booking and passes | P2 |

---

## H. Implementation roadmap

**Phase 1 — Critical security, payment and booking integrity (before any paid launch)**
1. Fix the trial bypass (E4/4c) and audit existing `trial=1` rows on paid clubs. *Small.*
2. Switch Open Booking resale off through the existing feature flag (`orgFeatureFlags(...).open_booking`) until it's
   redesigned (scenario 13, F2). *Config only.*
3. Cascade booking cancel/reschedule to the linked game (E1), with joiner refunds. *Medium.*
4. Availability predicate fix (E3); room capacity check including open spots. *Small.*
5. **Decide the commercial model (F1)**, with an Irish tax adviser and Stripe:
   - merchant vs agent model
   - VAT per category and per vendor
   - fee level
   - cash-booking fee handling

   Then remove the stale ADR comment. *Business decision; it blocks Phase 4.*
6. Vendor/host-initiated cancel → automatic full refund (18). *Medium; reuses `refundPaidOnce`.*

**Phase 2 — Complete core booking workflows**
1. Auto-refund within the policy window on self-cancel (17), plus an admin out-of-policy refund queue.
2. Deposit-release queue (1e), or change the deposit to a pre-auth / on-demand model.
3. Hosts must hold a venue booking to name a venue (E2). Venue vendor sees the event and attendee count.
4. Enforce `min_age`; safety acknowledgement and emergency contact for adventure experiences (3a).
5. `pay_at_venue` status for cash; `completed` / `no_show` states (E7).
6. Collision-safe refs (E6); signed manage-booking links (E11).
7. Decide membership scope (9). If it's in scope, build Stripe Billing customer memberships.

**Phase 3 — Checkout UX and conversion**
1. Form a11y and mobile: labels, `autocomplete`, `type="tel"`, `inputMode`. Prefill from the resident; household picker on all flows.
2. Server `/quote` for venue bookings; all-in price display from discovery.
3. Show the cancellation deadline and refund outcome on the review, confirmation and cancel screens; hold countdown.
4. Data minimisation: drop mandatory address; restructure the medical field; per-listing optional questions; terms-version capture on every paid order.
5. Multi-participant checkout for clubs and programmes; per-seat names for experiences.
6. Circle approval questions.

**Phase 4 — Advanced booking, rewards, monetisation** (after F1 is decided)
1. Engine pricing for all resource types (not just experiences).
2. Settlement ledger on; Connect payouts (venue + host split for resale).
3. Coupons v2, customer credits, partner rewards, Pro: switch on behind the existing switches, one at a time.
4. Sub-hour court slots, per-room hours, recurring bookings.

**Phase 5 — Launch readiness and regression**
1. Add the P0/P1 tests in §G to the server suite and the `qa:booking` / `qa:stripe` harness.
2. Run the full `qa:*` suite plus Stripe TEST end-to-end against staging (real HTTPS webhooks, still an open gap in `QA_REPORT.md:71`).
3. GDPR: retention schedule and erasure path for registrations and participant data; privacy notice updated for child/medical data.
4. Email deliverability (SPF/DKIM) and confirmation/cancellation email verification. **[H]** Booking emails were "NOT VERIFIED" in `QA_INTEGRATIONS.md:104`.
5. Index pass (E5) and a load test on the booking hot paths.

---

*Facts vs assumptions:* every **[V]** item was read in code or exercised by a test run during this audit. **[A]** items
(VAT treatment per category, Stripe IE fee levels, consumer price-display rules, pre-auth windows) need confirmation
from a tax adviser, counsel or the Stripe agreement. They were deliberately not treated as fact.
