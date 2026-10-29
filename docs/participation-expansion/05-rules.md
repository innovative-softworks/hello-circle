# 05 · Rules: pricing, capacity and payment lifecycle; privacy, safeguarding and permissions

> These rules describe **mechanics**. They set no commercial value. VAT rates, fees, deposits, refund percentages and
> donation tax treatment stay exactly as they are today, or wait for D-04 part B, PD-3 or PD-5. Nothing here
> approves them.

## 1. Pricing
1. **The server prices every line.** The client sends `{ optionId, quantity }` and an optional `donationMinor`, never
   a unit price or total.
2. **Goods lines** are summed into the subtotal that today's pricing takes: `computePricing(sum, deposit, discount,
   coupon)` on legacy types, and `calculate({ lines })` in the engine on experiences (it already takes lines). The
   VAT and fee values are whatever is in force; they don't change.
3. **Coupons apply to goods lines only**, never to the donation. `evaluateCoupon()` gets the goods subtotal.
4. **Add-ons** (`heads_per_unit = 0`) are priced per unit and capped at `max_per_order`. A per-person add-on can't
   exceed the order's head count.
5. **Bundles** are a single per-booking line whose `bundle_slots` fix the attendee bands.
6. **Sale windows** (`sale_starts_at/ends_at`) are checked at quote **and** at checkout. A quote from before the
   window closed is refused at checkout with a clear error (as `QuoteError` already does).
7. **Eligibility** (`circle_members`, E6) is checked at checkout against `circle_members` on the server.
8. **Donations (blocked until PD-3):** a `donation` line is **not** run through `computePricing()`. Its tax treatment
   comes from an approved pricing rule (`resolveRule("pricing", { scenario: "donation" })`). With no approved rule,
   donation inputs are refused on the server (`participation.donations` off) and the UI doesn't show them. Donations
   are never assumed to be VAT-exempt or fee-free.
9. **Checkout agreement:** `recordCheckoutAgreement()` records the sum of every Stripe line, including any donation.
   Stripe line items list each line separately, including "Voluntary donation".
10. **Free orders with a donation** go through Stripe for the donation amount only (EV-04). The order is confirmed
    when the donation payment settles. An abandoned donation checkout leaves no free booking behind unless the
    organiser marks the donation optional *after* registering. That's a UX decision (PD-3b).

## 2. Capacity
1. **Heads, not orders.** Every listing that sells options counts `SUM(order_lines.heads)`, mirrored into the order
   row (`experience_bookings.party_size`; `1 + game_participants.guests`). Free options and infants count if the
   option says so (default: yes, for fire safety).
2. **Option caps:** an option with its own `capacity` is checked with its own `SUM(heads)` per option, under the same
   parent lock (`PARENT_LOCK`) as the listing cap. Lock order: parent row, then options in id order.
3. **Holds:** a card checkout holds for 30 minutes (unchanged). D-10 review holds are unchanged. An **external
   payment** holds until `external_payments.hold_until` (§3.4). There's no other kind of hold.
4. **Waitlist:** unchanged in phases 1–5. A group-fit offer (E8) is a later, separate change to `waitlist.ts`.

## 3. Payment lifecycle

### 3.1 Card (unchanged)
`pending` → Stripe → webhook → agreement check → `settleOrder()` → `paid`, or `payment_reviews`.

### 3.2 External payment (new, opt-in per listing, PD-4)
```
checkout(paymentMethod=bank_transfer|revolut)
  → order row: payment_status='pending'           (never 'paid')
  → external_payments: status='due', hold_until = rule(start time)
  → booker sees pay-to + reference
booker "I've paid"            → status='claimed' (+ claimed_reference / evidence)
finance verifies               → settleExternal(): org active? not cancelled? listing eligible? start not passed?
                                 capacity fits (if hold lapsed)? → order 'paid', ledger provider='external',
                                 confirmation + QR sent
finance rejects (reason)       → status='rejected', order stays pending until hold_until, booker told why
hold_until passes, no verify   → status='expired', place released, order 'cancelled' (nothing to refund)
payment arrives after expiry   → finance records it as an unmatched receipt; refund off-platform or re-book
                                 (never auto-confirms)
```
- **A transaction ID alone never means paid.** Only a finance verification does.
- `hold_until`:
  - default proposal: the earlier of 72 hours after checkout and 24 hours before the start;
  - if that is already past, **no external option is offered**;
  - it can only ever be shortened (same principle as D-10).
- **Verifying twice** is blocked by `row_version`, and every transition writes `writeAudit()`.
- **Check-in:** the door shows "Payment pending". Staff with finance permission may *record cash and check in* in
  one step. Others can't check in an unpaid order. This is a deliberate extension of the existing paid-only rule
  (`vendorOperations.ts:1045`).

### 3.3 Cash due ("pay on the night")
This is the same state machine with `method = 'cash_due'`. The difference is that recording the cash is the
verification. The person who took the cash is stored, and recording it twice is blocked. Existing listings with
`payment_method = 'cash'` **keep their current behaviour** until PD-5 decides otherwise.

### 3.4 Refunds and partial cancellation
1. **Removing a seat** reduces the line's `quantity`/`heads`. The refund amount is that line's unit price × the
   removed quantity, plus its share of VAT and fee **under the order's original snapshot**, capped at what was paid
   less what was already refunded (`refundedSoFar()`).
2. **The refund policy** (percentage by notice period) is the existing per-listing or platform policy. No new
   percentages are introduced here.
3. **Donations are refunded only on an explicit request** (X-01) or when the occurrence is cancelled by the
   provider. In that case everything is refunded through `refundOnProviderCancel()`.
4. **Card refunds** go through `refundPaidOnce()`/`refundInApp()` (once per row, with an idempotency key). External
   refunds are recorded as "refunded off-platform" with a reference. HelloCircle never claims to have moved money it
   didn't move.

## 4. Privacy (R8)
1. **Minimisation:**
   - Names are optional unless the organiser needs them.
   - DOB is asked only when an option has an age rule that needs a date.
   - Household members are copied in, never linked live.
2. **Question sensitivity:**
   - `normal`: visible to listing managers.
   - `sensitive` (health, dietary, access needs): visible to roles named in `visible_to`, left out of exports by
     default.
   - `special_category` (religious belief, health under GDPR Art. 9): allowed only if PD-6 says yes. When allowed,
     these questions:
     - show a purpose statement next to the question;
     - are optional unless the organiser records a lawful basis;
     - are never visible to door or volunteer roles;
     - are never exported without `include=sensitive` plus an audit row.
3. **Retention:** `retention_days` per question, counted from the end of the occurrence. **Answers aren't deleted
   automatically until D-07/DEC-14 sets the retention list.** Until then, sensitive answers are hidden (not deleted)
   30 days after the occurrence and the privacy request tool can export them.
4. **Erasure:** when D-07 allows it, erasure sets `order_answers.erased_at` and clears `value`. It removes attendee
   names except the payer's, and keeps lines, amounts and refunds for tax.
5. **Roles at KNOTS (controller and processor):** the organisation is the controller for its registration questions,
   and HelloCircle is the processor. Partner terms need a data-processing clause before questions launch. *This is a
   legal check, not legal advice.*

## 5. Safeguarding
- **Child attendees** (age band `child`/`infant`, or a DOB under 18):
  - an adult attendee or named guardian is required on the same order, unless the option is marked "drop-off" (camps)
    and has a collection list;
  - the collection list is a per-attendee question type, visible to door and occurrence staff only during the
    occurrence.
- **Volunteer duties working with children** can be marked "vetting required". The duty stays `invited` until a
  manager confirms vetting offline. HelloCircle doesn't hold vetting documents (National Vetting Bureau Acts; check
  with counsel).
- **Photo consent** is per attendee, and is visible to the communications role only.

## 6. Permissions

| Action | Partner owner | centre_manager / facility_manager (by type) | finance | communications | read_only_analyst | Occurrence role (door/volunteer) | Resident host (games) |
|---|---|---|---|---|---|---|---|
| Edit options, questions, payment methods | ✓ | ✓ | – | – | – | – | game +1s/co-host only |
| See attendee list (names, heads) | ✓ | ✓ | ✓ | ✓ | counts only | own occurrence, first name + initial | own game |
| See answers (normal) | ✓ | ✓ | – | – | – | per question grant | – |
| See answers (sensitive / special) | ✓ | per `visible_to` | – | photo consent only | – | never | – |
| Check in | ✓ | ✓ | ✓ | – | – | if `can_check_in` | host + co-host |
| Verify or reject external payment | ✓ | – | ✓ | – | – | – | – |
| Record cash at the door | ✓ | – | ✓ | – | – | only if PD-4 allows `can_take_cash` | host (games, cash due) |
| Money summary and payments export | ✓ | – | ✓ | – | ✓ (no contact details) | – | own earnings |
| Invite door and volunteer roles | ✓ | ✓ | – | – | – | – | co-host |

- **Server enforcement:**
  - partner routes use `requirePlatformRole()`/`hasPlatformRole()` with the role sets in `vendorHelpers.ts`;
  - door routes check either the partner role or an active `occurrence_roles` row, plus `expires_at`;
  - admin routes declare one `requireAdminPermission()` each.
- **Org suspension (D-01):** blocks new sales and external verification for a suspended organisation. Verification
  calls `assertSellable()` inside its transaction.
