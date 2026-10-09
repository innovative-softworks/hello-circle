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
