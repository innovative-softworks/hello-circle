# Commerce Engine — rollout log

Branch `feature/commerce-engine` (local, uncommitted, not pushed), cut from `staging` @ `544e663` on 2026-10-09.
Decisions taken as approved with "continue": D10 yes, D11 drop the environment column, D12 store
approver fields with two-person approval as an off-by-default switch. D1–D9 remain open.

---

## Phase 0.5 — Hardening of live money-path defects

**1. Inspected.** Risks R3, R4, R5, R8, R10 and R14 from `commerce-risk-register.md`, and every seed/test
insert that could depend on the boot backfill (none do).

**2–3. Changed / files.**

| Risk | Change | Files |
|---|---|---|
| R8 | Boot backfill bounded to rows created before `LEGACY_PAYMENT_BACKFILL_BEFORE` (2026-07-24), extracted as `backfillLegacyPaymentStatus()` | `server/src/db/index.ts` |
| R4 | `couponAmountError()` (kind; integer ≥ 1; percent ≤ 100) on admin, vendor and host coupon creation. `evaluateCoupon` refuses malformed stored rows and refuses host coupons with no game. A vendor coupon with no listing now means "this vendor's organisation's listings", never platform-wide | `server/src/pricing.ts`, `routes/vendorOperations.ts`, `routes/games.ts`, `routes/admin.ts` |
| R5 | `/api/coupons/validate`: 30 requests per 15 minutes per IP, one generic error, optional listing context so the preview matches checkout | `routes/coupons.ts`, `rateLimit.ts`, `client/src/api/public.ts`, `BookingFlow.tsx`, `RegistrationFlow.tsx`, `GameJoinCard.tsx` |
| R14 | `vendorSuspended()` checked before any new order: bookings, registrations, programmes, experiences, passes | `bookingIntegrity.ts` + those routes |
| R10 | Pass checkout: integer credits 1–50, approved club only, vendor not suspended, club must have a price | `routes/passes.ts` |
| R3 | Pricing an activity (create, or changing the price on edit) needs `host_status='verified'`. Already-priced games keep working. Switch: `commerce.paid_games_require_verified_host` (default on) | `routes/games.ts` |

**4. Database changes.** None to the schema. The R8 change only narrows an `UPDATE`.

**5. APIs changed.**
- `POST /api/coupons/validate` now:
  - returns one message for every invalid code
  - may return 429
  - accepts `listingType` and `listingId`
- Coupon creation routes return 400 for bad amounts.
- Checkout routes return 409 "This listing isn't taking bookings right now" for suspended vendors.
- `POST/PUT /api/games` return 403 when an unverified resident sets a price.

**6. UI changed.** Coupon previews on the booking, registration and game-join screens send listing context. No
visual change.

**7–9. Tests.** Added `server/src/commerceHardening.test.ts` (23 tests).
- Full server suite: **54 files, 528 passed, 23 skipped** (baseline 505).
- Client: 16 files, 105 passed.

**10. Security impact.** Closes:
- a cross-vendor coupon abuse path
- price-raising negative coupons
- the coupon enumeration oracle
- a crash-window "unpaid becomes paid" path
- orders against suspended vendors
- unverified residents collecting money

**11. Data-migration impact.**
- Existing unscoped vendor coupons stop working on *other* vendors' listings. That is intended, but it's a
  behaviour change.
- Existing stored coupons with an amount ≤ 0 or above 100% now never apply.

**12. Remaining risks.**
- Suspended vendors' listings are still *visible* in discovery; only checkout refuses them.
- The checkout routes still return detailed coupon errors. They're throttled only by their own costs.

**13. Rollback.** Revert the files above. To restore open paid games without a deploy, set `app_settings`
`commerce.paid_games_require_verified_host = 'false'` (via the admin Switches card).

**14. Next.** Phase 1.

---

## Phase 1 — Configuration foundation (no customer-visible change)

**1. Inspected.**
- the `app_settings` and `feature_flags` patterns
- `audit.ts`
- the `initSchema` conventions, including the memory notes on TEXT columns, backticks in comments and
  `affectedRows`
- the admin router and the AdminDashboard tab pattern

**2–3. Changed / files (new).**
- `server/src/commerce/money.ts`: integer money maths, `priceBreakdown()`, `allocate()`
- `server/src/commerce/catalog.ts`: rule keys, field specs and bounds, v1 seeds, target draft, switches,
  `canonicalHash()`
- `server/src/commerce/rules.ts`:
  - resolver
  - draft, update, discard, approve, publish, end and rollback
  - diff and impact preview
  - transactional audit
- `server/src/commerce/switches.ts`: `commerceSwitch()`
- `server/src/routes/adminCommerce.ts`: mounted at `/api/admin/commerce` (behind `requireAdmin`)
- `client/src/components/AdminCommerce.tsx`: the "Commercial rules" admin tab

Edited: `db/index.ts` (schema and seed), `routes/admin.ts` (mount), `client/src/api/admin.ts` (wrappers),
`pages/AdminDashboard.tsx` (tab).

**4. Database changes (additive, idempotent).**
- New table `commerce_rule_versions`, with unique `(rule_key, scope_type, scope_id, version)` and index
  `idx_rule_resolve`.
- `audit_log` gains the nullable columns `actor_kind`, `reason`, `correlation_id` and `environment`.
- Seed via `INSERT IGNORE`: global v1 of `pricing`, `checkout` and `cancellation`, plus an unpublished `pricing`
  v2 draft (the target model).

**5. APIs added** (admin only), all under `/api/admin/commerce`:
- `GET /catalog`
- `GET /rules[?key]` and `GET /rules/:id`
- `GET /rules/:id/diff/:otherId` and `GET /rules/:id/preview`
- `POST /rules/drafts` and `PUT /rules/:id`
- `POST /rules/:id/{discard,approve,publish,end,rollback}`
- `GET /resolve`
- `PUT /switches/:key`
- `GET /audit`

**6. UI added.** Admin → **Commercial rules**:
- the in-force values for each rule
- version history with lifecycle badges
- the new-version / edit-draft editor (overrides pin only the ticked fields)
- publish (with an optional future date), approve, discard, end, rollback, each with a mandatory reason
- details: values, diff against the previous version, and a money-impact preview on sample prices and recent
  paid orders
- the Switches card and the commercial change log

**7. Tests added.**
- `commerce/money.test.ts` (13): rounding equals legacy for every amount up to €2,000 (and checked separately up
  to €50,000), v1 equals `computePricing()` on a grid, the allocation invariant under v1 and the target model,
  discount capping, and `allocate`.
- `commerce/rules.test.ts` (19): catalog validation, seeded state, non-admin refusal, the reason requirement,
  field-merged scenario overrides, immutability of published versions, refusal of past effective dates,
  scheduled versions, ending a partner override, unknown-partner refusal, refusal to end the global rule,
  rollback as a new version, diff, two-person approval (including an edit voiding approval), the preview figures
  and audit completeness.

**8–9. Executed / results** (isolated Docker MySQL profile only):
- Server: **56 files, 560 passed, 23 skipped** (+55 over baseline, 0 regressions).
- Client: **16 files, 105 passed**.
- `tsc` on server and client: clean.
- `npm run build`: succeeded.

Browser check against a throwaway loopback MySQL container, with an empty env file (no Stripe, SMTP or Firebase
credentials, and neither `hello_circle_dev` nor `hello_circle`): fresh-install migration and seed succeeded, the
tab rendered, the preview showed correct figures, and creating and publishing a scenario override wrote two audit
rows. No console errors. The container was destroyed afterwards. This run found and fixed one UI bug: switching
the scope to an override left every field ticked, which would have frozen all global values into the override.

**10. Security impact.**
- Admin only, through the existing `requireAdmin`.
- Every write carries a reason and runs as one transaction together with its audit row.
- Backdating is impossible, so historical pricing can't be changed.
- Payload hashes are checked on publish.
- Resolution fails closed.

**11. Data-migration impact.** Additive only. No existing row is changed. Live checkout paths don't read the new
tables yet.

**12. Remaining risks / limitations.**
- Rules don't price live orders yet (Phase 2).
- `cancellation` and `checkout` values are still also hardcoded at their call sites. They will be switched to
  `resolveRule` behind `commerce.engine_v2` in Phase 2, with shadow comparison first.
- Partner scope ids are typed by hand, with no picker.
- Preview samples ignore deposits and coupons.
- DATETIME has one-second precision, so a publish and an end within the same second give a zero-length override.

**13. Rollback.**
- Remove the router mount and the tab. The table and the audit columns can stay: they are unused by legacy
  paths and safe to ignore.
- No data migration needs reversing.

**14. Recommended next phase.** Phase 2: quotes, orders, snapshots and shadow mode, with Experiences live first.
Before going live it needs D1/D2 (the target price model and VAT treatment). The preview makes the impact
concrete: under the target model a €10 list price nets the partner €7.56 (instead of €10 today) unless partners
re-price.

---

## Phase 2 — Quotes, orders, snapshots, shadow mode (Experiences first)

**1. Inspected.**
- The Experiences quote and checkout paths (`quoteExperience`, the row-locked booking transaction).
- Every transition point for an experience booking: webhook confirm, expiry, failure, resident cancel, vendor
  cancel, session cancel and refund.
- The QA provider stub seam.
- The other five flows' pricing sites, for shadow hooks.

**2–3. Changed / files.**
- New: `server/src/commerce/engine.ts`, which covers:
  - rule-based pricing
  - venue day-rate parity
  - Stripe line items that always sum to the total
  - single-use quotes
  - creating an order with its snapshot
  - `syncOrderFromSource()`
  - shadow pricing
- New: `server/src/routes/commerce.ts` (`/api/commerce`).
- Edited:
  - `routes/experiences.ts`: engine quote and checkout behind switches, exported `storedExperienceQuote`
  - `routes/stripeWebhook.ts`: order sync after confirm and fail dispatch
  - `checkoutService.ts`: order sync after a refund
  - `routes/vendorExperiences.ts`: order sync after a cancel
  - `routes/{bookings,registrations,programs,games,passes}.ts`: one shadow call each
  - `routes/adminCommerce.ts`: `/orders` and `/shadow`
  - `rateLimit.ts`: `commerceQuoteLimiter`
  - `db/index.ts`: schema
  - `commerce/catalog.ts`: switches
- Client: `api/public.ts` (`quoteId`, `vatIncluded`), `pages/ExperienceDetail.tsx` (sends the quote back,
  VAT-inclusive display, re-quotes after a 409), `api/admin.ts` and `components/AdminCommerce.tsx` (Shadow
  pricing and Orders cards).

**4. Database changes (additive).**
- New tables: `commerce_quotes`, `commerce_orders` (unique `(source_type, source_ref)`, indexed on Stripe session
  and partner), `commerce_order_lines`, `pricing_snapshots` (never updated after insert) and
  `commerce_shadow_diffs`.
- Money columns are `BIGINT` minor units plus `currency`.

**5. APIs.**
- New:
  - `POST /api/commerce/quotes` (experiences only, otherwise 409 `engine_not_enabled`, rate-limited)
  - `GET /api/commerce/orders/:id` (owner only; customer-visible fields only)
  - `GET /api/admin/commerce/orders?q=`
  - `GET /api/admin/commerce/shadow`
- Changed:
  - The experience quote endpoint adds `vatIncluded` and, when the engine is on, `quoteId` and `quoteExpiresAt`.
    It is now rate-limited at 120 requests per 15 minutes.
  - Experience checkout accepts `quoteId` and can return 409 with `code` set to `quote_used`, `quote_mismatch`,
    `quote_expired`, `quote_not_found` or `price_changed`.

**6. UI.**
- Admin → Commercial rules gains **Shadow pricing** (matched/mismatched per type over 30 days, plus recent
  mismatches) and **Orders** (searchable, with customer paid, partner payout, HelloCircle revenue and the rule
  versions used).
- The Experience booking form shows "incl. VAT" when the rule says VAT is included, and refreshes the total if
  the price moved.

**Switches.**
- `commerce.shadow_pricing` is now active.
- `commerce.engine_v2` (master) and `commerce.engine_v2_experience` (per type) are new and active.
- All default to **off**. With them off, checkout is the pre-engine code path, which a test proves.

**7–9. Tests.** `commerce/engine.test.ts` (20 tests):
- line items sum to the total for v1 and the target model
- v1 line layout identical to today's
- the target model shows one VAT-inclusive line
- the venue day rate matches legacy `hireCost()` for every rate from €1 to €300 and every duration from 1 to 12
  hours
- shadow records a match under v1 and a mismatch under an override, without changing the charge
- quote → order → snapshot equals the stored charge
- single-use quotes; mismatch, expiry and price-changed refusals
- historical snapshots unchanged after a rule change
- checkout without a quote
- cancel mirrors onto the order
- a failed payment page fails the order and frees the quote
- the provider-stub webhook confirms exactly once; an expired session fails the order
- the customer order view hides internal fields and is scoped to its owner
- switching the engine off returns to the legacy path

Results:
- Full server suite: **57 files, 580 passed, 23 skipped**.
- Client: 105 passed.
- `tsc` and `npm run build` clean.

Browser check (throwaway loopback MySQL, no credentials):
- With the engine on, the Experience form showed the engine quote (€32.00, identical to today).
- The booking went through with the quote id; the order and snapshot were recorded (customer €32, partner €25,
  HelloCircle €1.25, global v1).
- Both new admin cards render.

**10. Security.**
- The order view returns nothing internal (payout, success fee, cost estimates, identity) and returns 404 to
  non-owners.
- Quotes are single-use, bound to identity, resource, party size and coupon, and checked against the rule hash
  and total under a row lock, so a replayed or duplicated checkout can't create a second order from one quote.
- Quote creation is rate-limited.

**11. Data-migration impact.** Additive only. Engine orders exist only for experience bookings made while both
engine switches are on. Shadow rows are written only while the shadow switch is on.

**12. Remaining risks / limitations.**
- Phase 2 still reads the hold duration (`PENDING_HOLD_MINUTES`) and cancellation defaults from code. The rules
  for them exist, but switching the SQL predicates is deferred to the per-type migrations (Phase 8).
- `syncOrderFromSource` reads the `status` column, which `passes` doesn't have. Passes must add one, or get a
  special case, before they move to the engine (Phase 8).
- Shadow pricing compares the pricing rule only. A booking's list price (venue day rate) is shadowed through the
  legacy list price, with parity proven separately in unit tests.
- New risk **R28**: vendor session cancel (`vendorExperiences.ts` DELETE session) marks pending holds `failed`
  without `releaseCoupon`, so a reserved coupon use can leak. This is pre-existing and not fixed here; flagged for
  the Phase 3 coupon work.
- Quotes accumulate rows; a cleanup of expired, unused quotes belongs with the Phase 4 operations jobs.

**13. Rollback.**
- Turn off `commerce.engine_v2` (or `commerce.engine_v2_experience`) in Admin → Commercial rules → Switches. New
  experience bookings immediately go back to legacy pricing, with no deploy.
- Existing orders and snapshots stay as a record. They are never consulted by legacy code.
- Code revert is safe because the tables are additive.

**14. Recommended next.**
1. Turn on **shadow pricing in staging** and collect real comparisons for every type.
2. Decide **D1/D2**.
3. Then either keep Experiences on rule v1 under the engine (zero customer change, but every order gets a
   snapshot), or start Phase 3 (coupon normalisation and funding, which also fixes R28).

---

## Phase 3 — Coupon normalisation (funding, limits, redemption ledger)

**1. Inspected.** Every coupon path:
- creation: admin, vendor and host routes
- evaluation: `evaluateCoupon`
- reservation: `consumeCoupon` in the five checkout flows
- release: `endPendingHold`, plus the session-cancel path (R28)
- refund: `refundPaidOnce`
- the engine snapshot

**2–3. Changed / files.**
- `pricing.ts`: `evaluateCoupon` refuses archived coupons and coupons that haven't started yet, enforces the
  minimum spend, caps the discount at its maximum, and returns `couponId`, `funding` and `platformShareBps`
  (partner-owned coupons are always partner-funded). New `parseCouponLimits()`.
- `bookingIntegrity.ts`:
  - `consumeCoupon(tx, code, redemption?)` records a redemption and enforces uses-per-customer under the coupon
    row lock (when `commerce.coupons_v2` is on)
  - `customerKeyOf()`
  - `releaseRedemption()`, called by `endPendingHold`
- `commerce/engine.ts`: `syncOrderFromSource` also moves the redemption (reserved → confirmed when paid, →
  released when failed or expired, → reversed when refunded).
- `commerce/money.ts`: a `platformFundedDiscountMinor` input. The partner is made whole for the funded share;
  platform contribution falls by the same amount.
- `routes/experiences.ts`: the engine path applies coupon funding (exact largest-remainder split) and stores it in
  the snapshot.
- The five checkout routes pass redemption context and now surface the real coupon error (for example "You've
  already used this code") instead of always saying "fully redeemed".
- `routes/admin.ts`:
  - coupon list shows funding, limits and redemption totals
  - create, pause and resume need a reason and are audited
  - DELETE now **archives**
  - funding is platform or split only
- `routes/vendorOperations.ts`, `routes/games.ts`: partner coupons are stored partner-funded and accept the limits.
- `routes/vendorExperiences.ts`: R28. Session cancel releases reserved coupon uses and redemptions in the same
  transaction.
- `audit.ts`: optional `reason` and `actorKind`, and records the environment.
- Client: the admin Coupons tab adds funding, HelloCircle share, the four limits, a required reason, and
  pause/resume/archive with a reason. The "€ off" amount is now entered **in euros** (it used to be cents).

**4. Database changes (additive).**
- `coupons` gains `funding` (default `platform`), `platform_share_bps` (default 10000), `min_spend_cents`,
  `max_discount_cents`, `per_customer_limit`, `starts_at` and `archived_at`. A backfill sets partner-created
  coupons to `partner` / 0.
- New table `coupon_redemptions`, unique on `(source_type, source_ref)`, indexed on
  `(coupon_id, customer_key, status)`.

**5. APIs.**
- `POST /api/admin/coupons` accepts `funding`, `platformShareBps`, the limits and `reason`.
- `PUT /api/admin/coupons/:id/active` and `DELETE /api/admin/coupons/:id` require `reason`. DELETE archives.
- `POST /api/vendor/coupons` and `POST /api/games/coupons` accept the limits.

**6. UI.** The admin Coupons tab as described above.

**Switch.** `commerce.coupons_v2` (off by default) gates the redemption ledger and the per-customer limit. Minimum
spend, maximum discount and start dates apply whenever a coupon sets them; every existing coupon has them unset,
so it behaves exactly as before.

**7–9. Tests.** `commerce/coupons.test.ts` (17 tests):
- limits and funding at evaluation
- the money invariant with platform funding, and funding capped at the discount
- admin reason, audit, funding validation and archive
- vendor coupons forced to partner funding
- the ledger off (legacy) and on (exact split recorded)
- uses-per-customer
- reserved → confirmed → reversed via the provider stub
- an expired checkout releases both the coupon use and the redemption
- R28 session cancel releases them
- the engine snapshot keeps the partner whole

Results:
- Full server suite: **58 files, 597 passed, 23 skipped**.
- Client: 105 passed.
- Build clean.

Browser check (throwaway database): created a €5 split-funded coupon (50% HelloCircle, one per customer) through
the new form, then archived it. The database had amount 500, `split`/5000, the limit set, `archived_at` set, the
row not deleted, and two audit rows with their reasons.

**10. Security.**
- Partners can't spend HelloCircle money: funding is forced server-side, and `evaluateCoupon` ignores a stored
  platform share on partner-owned rows.
- Every admin coupon change has a reason in the audit log.
- Per-customer limits are race-safe under the coupon row lock.

**11. Data-migration impact.**
- Existing admin coupons are now recorded as HelloCircle-funded. That only changes allocations on engine-priced
  orders: under the engine, an admin coupon now makes the partner whole.
- Existing partner coupons are backfilled to partner-funded.
- No coupon becomes stricter, because every limit column is null.

**12. Remaining risks.**
- Refunds don't hand back a coupon use (R19; unchanged by design). The redemption is marked `reversed` for
  accounting, but `used_count` is untouched.
- VAT treatment of a HelloCircle-funded discount is part of D2.
- Vendor and host dashboards don't yet expose the new limit fields in their own forms (the API accepts them).
- Redemptions are recorded only for checkouts made while the switch is on. Past uses aren't backfilled.

**13. Rollback.**
- Turn off `commerce.coupons_v2` to stop recording and stop per-customer enforcement.
- Code revert is safe: the columns and tables are additive, and archived coupons simply stay inactive.

**14. Next.** Phase 4: the settlement ledger. It turns snapshots and redemptions into append-only ledger entries
and payout allocations, adds partial refunds (R7) and dispute handling (R9), and needs D3 (manual payouts vs
Stripe Connect) and D6 (the completion rule).
