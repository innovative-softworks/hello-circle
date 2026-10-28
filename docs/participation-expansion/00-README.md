# Ireland Participation Expansion: Phase 0 audit

**Status:** audit and proposal only (2026-10-28). Nothing is implemented. No code, schema, data, commit or deploy
changes were made. Implementation waits for review and approval of the architecture in `03-architecture.md` and the
decisions in `06-plan.md` §4.

**Inputs:** the KNOTS (Kildare Network of Telugu Society) Satyanarayana Swamy Vratham brief, the Ground-Level
Scenarios page (20 scenarios, requirements R1–R9), and the repository on branch `feature/circles-and-experience-3`
(head `473dbfa` plus uncommitted work in the tree).

## Documents

| File | Contents |
|---|---|
| `01-current-state.md` | Architecture and data flow, lifecycle traced for each listing type, capability matrix, what must be preserved, confirmed gaps with code references |
| `02-scenarios.md` | Scenario-to-feature mapping, an expanded Irish scenario inventory, existing requirements (R1–R9) kept separate from proposed enhancements (E1–E10) |
| `03-architecture.md` | Proposed shared participation layer, data model and relationships, migration notes, API contract |
| `04-ux-and-sitemap.md` | Sitemap changes for residents, hosts, partners and admins; UX flows for simple, structured and managed participation |
| `05-rules.md` | Rules for pricing, capacity and the payment lifecycle; privacy, safeguarding and permissions |
| `06-plan.md` | Phases and dependencies, test plan and acceptance criteria, risks, open decisions, rollback |

## Summary

1. **Most of what's needed already exists in shared form.** Every paid path goes through
   `checkoutService.createCheckoutSession()` with its checkout agreement. Capacity holds are shared predicates
   (`bookingIntegrity.ts`). The webhook settles orders through `payments/orderState.ts`. Payment reviews (D-10/D-11)
   and the ledger already work. Attendance, acknowledgements and commerce orders are already keyed on
   `(kind/source_type, ref)`. The proposal extends that `(source_type, source_ref)` pattern. It doesn't merge the
   five participation tables.
2. **Pricing is the safest place to extend.** `commerce/calc.ts` already takes `lines: { unitMinor, quantity }[]`,
   and the commerce engine prices experiences behind switches. Several options per order fit the engine's existing
   input shape. Today every route passes one subtotal, so nobody uses that shape yet.
3. **Experiences are the natural home for community events.** They already have departures, `party_size` counted
   as heads in capacity, one name per seat (`experience_booking_participants`), acknowledgements, the engine pilot,
   per-booking attendance, D-01 sellable checks and Circle links. A new `kind = 'event'` reuses all of that.
4. **The two dangerous gaps are about money, not features:**
   - **Cash means paid.** Today a cash order is written `payment_status = 'paid'` the moment it's created
     (`bookings.ts:328`, `registrations.ts:394`, `experiences.ts:425`). Revolut, bank transfer or "pay on the night"
     can't reuse that path.
   - **Donations can't be priced yet.** Every line in `computePricing()` carries 23% VAT and the 5% fee. Taking a
     donation needs your D-04 part B tax decision first.
5. **Family and group orders split three ways:**
   - **Easy (heads on one row):** experiences and events.
   - **Medium (a guest count on a seat row):** games, where `uniq_participant (game_id, resident_id)` allows one
     seat per resident.
   - **Hard (several rows paid by one checkout):** clubs and programmes, where each row is one person. One Stripe
     session per ref (`metadata { type, ref }`) means paying for several rows changes the webhook contract. That
     stays a separate, explicitly approved phase.

## Corrections to the Ground-Level Scenarios page

- **Named seats on experiences.** Experiences *do* store one name per seat (`experience_booking_participants`, Booking
  UX Phase 4 B7), and `cleanParticipantNames()` takes the list in `experiences.ts:385`. The page said "no names" for
  EX-01 and EV-01. The real gap is age band, role and per-person answers on those seats.
- **Who can check in.** Vendor check-in requires `payment_status = 'paid'` (`vendorOperations.ts:1045`) and covers
  bookings and registrations only. Experiences and programmes have their own attendance routes.
- **Passes.** Passes are club-only (`passes.ts:103` inserts `listing_type = 'club'`).

## What you need to decide before Phase 1

See `06-plan.md` §4. The blocking ones:
- **PD-1:** a community event is an experience kind, not a new table.
- **PD-2:** who may sell paid events (partner organisations only).
- **PD-3:** donation tax treatment (with the D-04 part B accountant review).
- **PD-4:** whether external payments are allowed, and who may verify them.
- **PD-6:** whether religious and other special-category questions are allowed.
