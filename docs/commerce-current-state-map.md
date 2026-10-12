# Commerce — current-state map (Phase 0, read-only)

Audited on branch `staging` @ `544e663`, 2026-10-09. Nothing here was executed against a database or Stripe;
every statement is from reading code. Line numbers are as of that commit.

## 1. Where commerce lives today

| Concern | Owner (file:symbol) | Notes |
|---|---|---|
| Price maths | `server/src/pricing.ts:computePricing` (L21) | `taxable = max(0, subtotal − discount)`, `vat = round(taxable × 0.23)`, `fee = round(taxable × 0.05)`, `total = taxable + vat + fee + deposit`. Pure, integer cents, `Math.round` (half-away-from-zero for positives). |
| Coupon evaluation | `pricing.ts:evaluateCoupon` (L80) | Reads `coupons` row; checks active / expiry / `used_count < max_uses` / optional single-listing scope. No creator, funding, min-spend, max-discount or per-customer concept. |
| Coupon reservation | `bookingIntegrity.ts:consumeCoupon` (L39) / `releaseCoupon` (L48) | Conditional `UPDATE … used_count < max_uses` inside the caller's transaction (HC-QA-037/050). Released only when a pending hold fails/expires (`endPendingHold`, L60). |
| Legacy coupon increment | `pricing.ts:recordCouponUse` (L106) | **Dead** — no callers (all confirm* paths say "reserved at checkout, never consumed again"). |
| Stripe Checkout | `checkoutService.ts:createCheckoutSession` (L118) | Single platform account, `mode: "payment"`, `currency: "eur"` (L149), ad-hoc `price_data`, metadata `{type, ref}`, `expires_at = now + PENDING_HOLD_MINUTES`. QA stub seam (`qaProviderStubEnabled`). |
| Line items | `checkoutService.ts:pricingLineItems` (L60) | Literal labels "VAT (23%)", "Platform fee", "Refundable deposit … within 5 days". |
| Refunds | `checkoutService.ts:issueStripeRefund` (L200) + `refundPaidOnce` (L252) | **Full refunds only.** Row-locked, idempotency key `hc-refund-<session>`; reconciles an already-fully-refunded charge; refuses a partially-refunded one (HC-QA-091). |
| Capacity holds | `bookingIntegrity.ts:PENDING_HOLD_MINUTES = 30` (L14), `occupiesCapacitySql`, `gameSeatSql`, `holdIsLive` | Read-time expiry, no sweeper job. Equal to Stripe's minimum Checkout session lifetime. |
| Webhook | `routes/stripeWebhook.ts:stripeWebhookHandler` (L417), mounted raw at `index.ts:129` | Handles only `checkout.session.completed`, `.async_payment_succeeded`, `.async_payment_failed`, `.expired`. Signature mandatory when secret set; unsigned only with explicit local opt-in (`stripeWebhookPolicy.ts`). |
| Settlement of pending rows | `stripeWebhook.ts:settlePending` (L57), `confirmGameJoin` (L203), `confirmPass` (L291) | Parent-row lock → only `payment_status='pending'` rows move. Stale hold + no capacity → `status='cancelled', payment_status='paid'` = "refund required" (audit row, no refund performed). |
| Cancellation policy | `org_policies.cancellation_hours` (default 48) / `booking_window_days` (90) via `db/queries.ts:orgPoliciesForVendor` (L516); `selfCancel.ts` | Per-org, vendor-editable. Games use a free-text `cancellation_policy`. Programmes have no cut-off. |
| Feature flags | `feature_flags (org_id, flag_key)` + `queries.ts:FEATURE_FLAG_KEYS` (L537) | Per-org, admin-only, opt-out (missing row = on). Keys: `open_booking`, `programs`, `experiences`. |
| Global settings | `app_settings` (`db/index.ts` L1096) + `getSetting/setSetting` (L2313) | `VARCHAR(255)` key/value, 5-s cache, unversioned. Used for kill switches (maps, media, Cloudinary) and recommendation weights. |
| Audit | `audit.ts:writeAudit` → `audit_log` | `actor_user_id` (mixes `users.id` and `residents.id`), action, object, prev/new JSON. No role, reason, environment or correlation id. Never throws. |
| Vendor revenue view | `routes/vendorInsights.ts` GET `/payments` (L150) | Sums `total_cents` of paid rows across 4 tables (includes VAT, platform fee, deposit, cash bookings). |
| Client estimates | `client/src/api/public.ts:291-292` (`VAT_RATE`, `PLATFORM_FEE_RATE`), `BookingFlow.tsx:49,160-165`, `RegistrationFlow.tsx:127-128`, `ClubDetail.tsx:291` | Duplicated constants + duplicated `hireCost` day-rate rule (`× 6.5`). Programs/experiences/games instead call server quote endpoints (HC-QA-047). |

**Not present anywhere:** Stripe Connect, payouts, payables records, ledger, subscriptions, Stripe Price/Product
IDs, reward/credit balances, coupon funding, processed-event table, `charge.refunded` / `charge.dispute.*` /
`invoice.*` handling, partial refunds, a sweeper for expired holds. `checkoutService.ts:32-40` documents this
as a deliberate v1 decision: *the platform is sole merchant of record; vendor settlement is manual/off-platform.*

## 2. Paid flows, traced UI → DB

All six share: server recomputes price (never trusts client totals) → coupon re-evaluated with listing context
→ row + coupon reservation in one transaction → `createCheckoutSession` → `stripe_session_id` written → webhook
`confirm*` flips `pending → paid`.

| | Venue booking | Club registration | Paid Game (host-led) | Programme | Pass | Experience |
|---|---|---|---|---|---|---|
| UI | `pages/BookingFlow.tsx` (`/book/:centreId`) | `pages/RegistrationFlow.tsx` | `components/GameJoinCard.tsx` | `pages/ProgramDetail.tsx` | `pages/ClubDetail.tsx` (10-pack) | `pages/ExperienceDetail.tsx` |
| API | `POST /api/bookings/checkout` → `createBookingInternal` (also Make-It-Happen) | `POST /api/registrations/checkout` | `POST /api/games/:id/join` | `POST /api/programs/:id/enroll` | `POST /api/passes/checkout` | `POST /api/experiences/:id/sessions/:sid/checkout` |
| Identity | X-Client-Id, optional resident | X-Client-Id, optional resident | resident required | X-Client-Id, optional resident | resident required | X-Client-Id, optional resident |
| Server quote endpoint | none (client estimates) | none | `GET /games/:id/quote` (L1404) | `GET /programs/:id/quote` (L196) | none | `POST …/quote` (L225) |
| Price source | `rooms.rate` **whole €** × hours (`hireCost`, ≥8h = 6.5× rate) | `clubs.price` **whole €** (trial = 0) | `games.price_cents` | `programs.price_cents` | `clubs.price` **whole €** × credits | `experiences.price_cents` × party |
| Extras | €100 deposit (`DEPOSIT_CENTS`, online only) | — | — | — | — | — |
| Coupon | yes, scope `centre` | yes, scope `club` | yes, scope `game` | yes, scope `program` | **no** | yes, scope `experience` |
| Capacity lock | `rooms` row FOR UPDATE + overlap/blocks | club (+ session) FOR UPDATE | game FOR UPDATE, `gameSeatSql` | program FOR UPDATE | **none** | session FOR UPDATE, party sum |
| Pending row | `bookings` pending | `registrations` pending | `game_participants` `pending_payment`/`pending` | `program_enrollments` pending | `passes` pending | `experience_bookings` pending |
| Breakdown stored | subtotal*/discount/vat/fee/coupon/total | same | **total + coupon only** (written after session create) | **total + coupon only** | **total only** (`purchased_cents`) | full breakdown |
| Cash / free path | cash room → `paid` immediately, no deposit | cash club or trial → `paid` | free game → `joined`/`paid` | free → `paid` | n/a | `payment_method` column exists |
| Failure/expiry | `endPendingHold(...,'fail')` keeps row `failed` | keep `failed` | delete row | delete row | plain `DELETE` (no hold logic) | delete row |
| Self-cancel | guest, ≥ org `cancellation_hours` | guest, no cut-off | resident leave (status only) | resident, no cut-off (`programmeCancelBlock`) | **none** | resident, org cut-off (`experienceCancelBlock`) |
| Refund route | vendor `finance` (`vendorOperations.ts:258`) | vendor `finance` (`:305`) | **host resident** (`games.ts:704`) | vendor `finance` (`vendorPrograms.ts`) | **none** | vendor `finance` (`vendorExperiences.ts:485`) |
| Notifications | guest+vendor+admin (`notifyNewBookingOrRegistration`) | same | payer + host-full | same | payer only | same |

\* `bookings.subtotal_cents`, `registrations.subtotal_cents` and `experience_bookings.subtotal_cents` actually
store `taxableCents` (post-discount), not the list subtotal (`bookings.ts` insert, `registrations.ts:112`,
`experiences.ts:314`).

Pass redemption (`registrations.ts:250-283`) consumes one credit and inserts a zero-priced `paid` registration —
so a club's GMV is recognised at pass purchase, not per session.

Open Booking (`pricing.ts:splitCostPerPerson`, `bookings.ts:97`, `makeItHappen.ts:83`): the booker pays the full
booking; each joiner then pays `ceil(total / (spots+1))` as **additional** revenue via the paid-game flow. No
credit back to the booker — by design (comment in `pricing.ts:29-38`).

## 3. State machines in use

```
payment_status:  pending ──webhook paid──▶ paid ──refundPaidOnce──▶ refunded
                    │                       ▲
                    └─expired/failed─▶ failed (bookings, registrations) | row deleted (others)
status:          confirmed ──self/vendor cancel──▶ cancelled      (independent of payment_status)
late payment:    pending + stale hold + no capacity ──▶ status=cancelled, payment_status=paid  ("refund required")
game_participants.status: pending_payment → joined | cancelled
```
There is **no fulfilment/completion state** on any participation table. "Did it happen" is derived from the
session date/time plus one of the two attendance mechanisms below.

## 4. The two attendance mechanisms

1. **`attendance` table** (`db/index.ts:798`, `kind`, `ref UNIQUE`, `status`) — staff/vendor check-in against a
   booking/registration ref (`vendorOperations.ts` check-in routes), programme session registers
   (`kind='program_session'`, `ref = "<sessionId>:<enrollmentId>"`), experience attendance
   (`vendorExperiences.ts:541`).
2. **`game_participants.checked_in_at` / `.attended`** (`db/index.ts:1517-1518`) — host marks present/no-show, plus
   resident self-report ("Did you attend?", `games.ts:833`).

`server/src/attendanceState.ts:deriveAttendanceState` interprets both into one vocabulary (`registered | attended
| no_show | cancelled`) without merging storage. A settlement "completion" signal can reuse this read-side helper.

## 5. Circle ↔ commerce

Circles have no payment surface (`circle_members` is unpaid). The only links are `games.circle_id` / `plan_id`
(organiser-created activities) and `programs/experiences/clubs.circle_id` (`db/index.ts:2179-2181`). A paid Game
attached to a Circle pays through the ordinary game flow. No Circle code needs to change for commerce.

## 6. Identity at checkout

- Guest: `X-Client-Id` (`util.ts:clientIdFrom`) owns bookings/registrations/programmes/experiences.
- Resident: magic link / password / Google / Bearer (`guestAuth.ts:111`) → `req.resident`; required for games
  and passes; optional elsewhere (adds `resident_id`, Stripe Customer for saved cards).
- Host: any resident can create a priced Game — `POST /api/games` (`games.ts:1286`) never checks `host_status`.
  `host_status='verified'` only gates "opportunities" (`games.ts:306`) and follower notifications.
- Vendor / staff: `requireVendor` + `attachVendorIds` (`orgVendorIds`), money actions gated
  `requirePlatformRole("finance")` (owners always pass).
- Admin: `adminRouter.use(requireAdmin)` (`admin.ts:18`); every admin route, including coupons, is admin-only.
