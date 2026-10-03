# HelloCircle — Booking model inventory (Phase 8)

Derived from code and schema on branch v8-0 (isolated QA database), 2026-10-01. These
are six independent participation models. Per CLAUDE.md they are deliberately parallel and not
unified; this document describes them as they are and invents no states.

Common pricing: `server/src/pricing.ts`.
- `computePricing(subtotal, deposit, discount, coupon)` calculates taxable = max(0, subtotal − discount), VAT 23% and platform fee 5% on the taxable amount, then total = taxable + VAT + fee + deposit. All of this is integer cents and server-side.
- `evaluateCoupon()` checks active, expiry, `max_uses` against `used_count`, and an optional listing scope. Percent coupons are rounded; fixed coupons are capped at the subtotal.
- (Historical, before HC-QA-050) `recordCouponUse()` ran only in the Stripe webhook confirm functions. Since Phase 9, coupon use is reserved atomically with the order (see the invariants below), and `recordCouponUse()` is no longer called.
- Currency is EUR only (cents integers; Stripe line items in `checkoutService.ts`). There's no per-listing currency field.

Payment boundary: `checkoutService.createCheckoutSession()`. With no `STRIPE_SECRET_KEY` it returns 503 "Payments aren't configured yet". Every caller then deletes the pending row it inserted; registrations check `stripe` before inserting at all.

## 1. Centre / room hire — `bookings`
| | |
|---|---|
| Create | `POST /api/bookings/checkout` (guest `X-Client-Id`; `resident_id` set if signed in) → `createBookingInternal` (shared with Make It Happen) |
| Capacity source | Room time slot. Inside a transaction: `FOR UPDATE` on `rooms`, overlap check against bookings on the same room/date with `payment_status != 'failed' AND status != 'cancelled'` (so **pending holds the slot**), plus `room_blocks`. `rooms.cap` vs `guests` is **not** checked. |
| Price source | `rooms.rate` × duration (`hireCost`; ≥8h = 6.5× rate) × 100, plus a €100 deposit for online rooms, a coupon and `computePricing`. No client price fields are read. |
| Status model | `status`: `confirmed` (default) → `cancelled`. `payment_status`: `pending` (online, awaiting Stripe) → `paid` (webhook, or immediately for cash rooms) / `failed` (webhook expired/failed). |
| Cancel | Guest: `POST /api/bookings/:ref/cancel` (client-id or email; 48h policy cutoff; `lookupLimiter`). Vendor: `POST /api/vendor/bookings/:ref/cancel` (org-scoped; centre_manager). Status flag only, with notification. |
| Change | Guest `POST /api/bookings/:ref/reschedule` (same ownership/cutoff, re-runs the locked overlap check) |
| Waitlist | None |
| Refund | Vendor finance → Stripe (out of scope) |
| Ownership | `client_id` or matching email; resident receipts by `resident_id` |

## 2. Club registration — `registrations` (optional `club_sessions`, `passes`)
| | |
|---|---|
| Create | `POST /api/registrations/checkout` (guest/resident). Paid online with Stripe off → 503 **before** any insert. |
| Capacity source | Club-wide `clubs.capacity`, minus active held waitlist offers. **Unlocked** count then insert (the code comment accepts the race). Per-session `club_sessions.capacity`: `FOR UPDATE` + count + insert in one transaction. Both count **only `payment_status='paid'`**, so pending online registrations hold nothing. |
| Price source | `clubs.price` × 100 (0 if trial) − coupon, then `computePricing`. A pass redemption costs 0 and decrements a pass credit (`FOR UPDATE`). |
| Status model | `status`: `confirmed` → `cancelled`. `payment_status`: `pending` → `paid` / `failed`. Free, trial, cash and pass are `paid` immediately. |
| Cancel | Guest `POST /api/registrations/:ref/cancel` (no cutoff; promotes the club waitlist). Vendor `POST /api/vendor/registrations/:ref/cancel` (facility_manager; promotes). |
| Waitlist | `POST /api/clubs/:id/waitlist` → `waitlist_entries` (club). Offers via `promoteNextWaitlistEntry`. Held offers count against club-wide capacity. |
| Ownership | `client_id` or email |

## 3. Programme enrolment — `program_enrollments`
| | |
|---|---|
| Create | `POST /api/programs/:id/enroll` (programme must be `published`) |
| Capacity source | `programs.capacity`: `FOR UPDATE` on the programme, count of `paid` and not-cancelled enrolments, insert in the same transaction. **Pending is not counted.** |
| Price source | `programs.price_cents` − coupon, then `computePricing` |
| Status model | `status`: `confirmed` → `cancelled`. `payment_status`: `pending` → `paid` / `failed`. Free is `paid` immediately. |
| Cancel | Guest/resident `POST /api/programs/enrollments/:ref/cancel`. Vendor `POST /api/vendor/programs/:pid/enrollments/:eid/cancel`. Session cancel (`DELETE …/sessions/:id`) only marks the session cancelled. |
| Waitlist | None (by design) |
| Ownership | `client_id` or `resident_id` |

## 4. Experience / adventure booking — `experience_bookings`
| | |
|---|---|
| Create | `POST /api/experiences/:id/sessions/:sessionId/checkout` (experience `approved`, session `scheduled`) |
| Capacity source | `experience_sessions.capacity ?? experiences.capacity`: `FOR UPDATE` on the session, `SUM(party_size)` of `paid` and not-cancelled bookings, insert in the same transaction. **Pending is not counted.** |
| Price source | `experiences.price_cents` × `partySize` − coupon, then `computePricing`. `partySize` is client-supplied and only checked for `> 0` (otherwise 1). |
| Status model | `status`: `confirmed` → `cancelled`. `payment_status`: `pending` → `paid` / `failed`. Cash and free are `paid` immediately. |
| Cancel | Guest `POST /api/experiences/bookings/:ref/cancel` (policy cutoff). Vendor `POST /api/vendor/experiences/:id/bookings/:bid/cancel`. Session cancel (`DELETE …/sessions/:id`) only marks the session cancelled. |
| Waitlist | None |
| Ownership | `client_id` or `resident_id` |

## 5. Activity / game join — `game_participants`
| | |
|---|---|
| Create | `POST /api/games/:id/join` (resident; canonical visibility first) |
| Capacity source | `games.capacity`: `FOR UPDATE` on the game, count of `joined` + `pending_payment`, plus active held waitlist offers (excluding the joiner's own) |
| Price source | `games.price_cents` (frozen once others have joined) − coupon. Free joins are `joined` immediately. |
| Status model | Participant `status`: `joined` / `pending_payment` / `cancelled`. `payment_status`: `paid` (the default, also for free) / `pending` / `refunded`. Game `status`: `open` / `pending_participants` / `cancelled`. |
| Cancel | Self-leave, host-remove, host cancel (Phase 7 HC-QA-025..028 rules) |
| Waitlist | `waitlist_entries` (game): offer and claim with the HC-QA-026 capacity invariant |
| Ownership | `resident_id`; host by `host_resident_id` |

## 6. Credit-pack pass — `passes`
Purchase only: `POST /api/passes/checkout` (resident). Always online, so with Stripe off it returns 503 and the pending row is deleted. Redeemed through club registration (see 2).


## Authoritative booking invariants (Phase 8 remediation, 2026-10-01)

These apply to every model above. Terminology is mapped to each model's own columns.

1. **Capacity.** occupancy + live holds + unexpired held waitlist offers ≤ capacity, at every commit.
   - **Occupancy:** `payment_status='paid'` and not cancelled. For activities: `status='joined'`.
   - **Live hold:** `payment_status='pending'` (activities: `status='pending_payment'`) created within `PENDING_HOLD_MINUTES` (30). This matches the Stripe Checkout session lifetime that `createCheckoutSession` sets.
   - **Hall slots:** the same rule applies to overlap; a stale pending booking no longer blocks a slot.
   - **Serialization:** the capacity decision and the insert run in **one transaction, under a row lock on the parent resource**: club, club session, programme, experience session, game, or room. Different parents don't block each other.
2. **Money.** The server derives every amount from validated inputs only:
   - resource price; hall duration (integer hours ≥ 1, within opening hours); party size (integer ≥ 1); coupon; EUR.
   - Client price, total and currency fields are ignored.
   - The UI shows the server quote (`/quote`) for the same inputs.
3. **Identity.** One active registration per (owner, club, session, participant name + DOB). One active enrolment per (owner, programme, participant name + DOB). The owner is the client id, or the resident when signed in.
   - Halls are protected by slot overlap; activities by UNIQUE(game, resident).
   - Multiple different participants per owner stay allowed (e.g. siblings).
   - After cancellation, rebooking is allowed.
4. **Cancellation.** active → cancelled happens once: `UPDATE … SET status='cancelled' WHERE … AND status != 'cancelled'`. Only the request that changed the row (`changes === 1`) releases capacity, promotes the waitlist, writes the audit row and sends notifications. Losers get 409.
5. **Parent availability.** Cancelled/inactive/past parents (sessions, programmes, games, rooms) refuse new bookings. Cancelling a parent (experience session) cancels its active children in the same transaction and notifies them once.
   - Paid children stay `payment_status='paid'` with `status='cancelled'`, which is the existing "refund required" state handled by the vendor refund route. No refund is fabricated.
   - Club sessions with registrations are deactivated, not deleted.
6. **Payment preparation.** A paid checkout inserts its pending row (the hold) inside the capacity transaction before the provider is called; provider refusal deletes it. Provider success (`confirm*`) locks the parent and:
   - is a no-op unless the row is still pending (duplicate delivery is safe);
   - confirms a live hold directly;
   - confirms a stale hold only if capacity still allows it, otherwise records `status='cancelled'` with `payment_status='paid'` (refund required).

   Provider failure or expiry marks the hold failed (or deletes it) and so releases capacity. Coupon use (Phase 9, HC-QA-050) is **reserved atomically in the reservation transaction for every order**, whether confirmed immediately or pending payment. It is handed back exactly once when a pending hold ends without payment (provider session not created, failed, or expired), via `endPendingHold()`. Provider success never consumes again, so a single-use coupon can discount at most one checkout at a time and at most one paid order.

Operational expiry: holds stop counting at read time after 30 minutes (no job needed for capacity). Rows are later marked failed by the provider's `checkout.session.expired` event; the session expiry is set to the same window.

## Contradictory combinations that must never exist
- **`bookings`:** `status='cancelled'` still blocking a slot (not possible: overlap excludes it). Two non-cancelled, non-failed bookings overlapping on one room/date. `total_cents < 0`.
- **`registrations`:** paid and not-cancelled count above `clubs.capacity` or `club_sessions.capacity`. `session_id` pointing to a missing session.
- **`program_enrollments`:** paid and not-cancelled count above `programs.capacity`.
- **`experience_bookings`:** paid and not-cancelled `SUM(party_size)` above capacity. Active bookings on a cancelled session. `total_cents` that doesn't match `price × party_size`.
- **`game_participants`:** see Phase 7 (joined + pending + held ≤ capacity; no stale waitlist entries).
- **Any model:** `payment_status='paid'` with a `stripe_session_id` for a free/cash row. A pending row surviving a 503 provider refusal.


## Phase 9 (Stripe TEST mode) additions — 2026-10-01

- **Webhook authority.** Only signed events change payment state. Once `STRIPE_WEBHOOK_SECRET` is set, a missing `Stripe-Signature` header is rejected with 400 (HC-QA-048). The ref comes only from server-written session metadata `{type, ref}`. A `completed` session that isn't paid never confirms; return URLs never confirm.
- **Activity charge recorded.** `game_participants.total_cents` stores the server-computed charge (HC-QA-049), used by confirmations and for reconciliation.
- **Refund once.** `refundPaidOnce()` locks the row, re-checks `paid`, calls the provider with an idempotency key (`hc-refund-<session>`), and marks `refunded` in one transaction (HC-QA-051). Concurrent requests get 409, and a provider error leaves the row `paid`.
- **Policy notes (unchanged, verified):**
  - A pending checkout can't be cancelled by the guest (409); it is abandoned through provider expiry.
  - A paid booking cancelled by the guest stays `cancelled` + `paid` (refund required) until the vendor refunds.
  - Online hall rooms always charge the €100 refundable deposit, so a €0-rate online hall is not free.
