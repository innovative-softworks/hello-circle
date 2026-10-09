# Commerce Engine — implementation plan (proposed, awaiting approval)

Builds on `commerce-audit.md`. Nothing here is implemented yet. Every phase is additive (`CREATE TABLE IF NOT
EXISTS` / `ensureColumn` / `ensureIndex` in `initSchema()`), feature-flagged, and leaves today's paths
authoritative until its flag is enabled.

## Guiding decisions baked into this plan

1. **Wrap, don't replace.** The five participation tables stay the operational record (capacity, attendance,
   status). A new `commerce_orders` row is created *alongside* the existing pending row and linked by
   `(source_type, source_ref)`. `settlePending` / `refundPaidOnce` / `endPendingHold` keep working; the order
   layer is updated in the same transaction.
2. **Rule v1 = today.** Phase 1 seeds a published global rule that reproduces current maths exactly (5% customer
   fee, 23% VAT on top, €100 deposit, 30-min hold, 48 h cancel). Shadow mode compares against it. The target model
   (€0 customer fee, 7% success fee) is a *draft* v2 that is published only after D1/D2 are decided.
3. **Integers only.** Money is `BIGINT` minor units + `CHAR(3) currency`; rates are `INT` basis points
   (700 = 7.00%); rounding is half-up per component, frozen by golden tests matching today's `Math.round`.
4. **Two flag layers, both existing patterns.** Global flags in `app_settings` (`commerce.engine_v2`, …;
   admin-toggled, cached) and per-org opt-outs in `feature_flags`. When a global flag is off, code paths are
   byte-for-byte today's.

## Phase 0.5 — Hardening of existing defects (needs explicit approval, **D10**)

Small, independent fixes for issues that exist in production today, each with a test in the isolated profile:
- R8: make the boot-time `pending → paid` backfill one-shot (marker in `app_settings`) or bound by `created_at`.
- R4: vendor/host coupon routes — require listing/org scope for partner coupons; validate `amount`
  (percent 1–100, fixed ≥ 1).
- R5: rate-limit `/api/coupons/validate`, unify error message.
- R14: quote/checkout rejects listings whose owning vendor is `suspended` *(after verifying)*.
- R3 (optional, flag): paid Games require `host_status='verified'`.

Rollback: each is a single revertable commit; no schema change except an `app_settings` marker.

## Phase 1 — Configuration foundation (no customer-visible change)

**Tables**
- `commerce_rule_sets` — `id`, `rule_key` (e.g. `fees`, `coupon_policy`, `reward_programme`, `subscription_plan`,
  `payout_policy`, `cancellation_policy`, `refund_policy`, `tax_assumption`, `payment_cost_policy`,
  `boost_pricing`), `scope_type` (`global | scenario | category | partner`), `scope_id`, `version`, `status`
  (`draft | scheduled | published | superseded | paused`), `priority`, `effective_from`, `effective_to`,
  `currency`, `payload JSON`, `payload_hash`, `previous_version_id`, `created_by`, `approved_by`,
  `published_at`, `change_reason`, timestamps. Unique `(rule_key, scope_type, scope_id, version)`.
- `audit_log` additive columns: `actor_kind` (`user | resident | system`), `reason`, `correlation_id`,
  `environment`.

**Code**
- `server/src/commerce/rules.ts` — typed payload schemas + validators (incl. hold ∈ [30,1440] min, rates ∈
  [0,10000] bps), `resolveRule(key, ctx, at)` with order partner → category → scenario → global, "exactly one
  published match" invariant, unit-tested.
- `server/src/commerce/money.ts` — bps maths, rounding, allocation helpers (largest-remainder for splits).
- Golden tests: today's `computePricing` outputs for a fixed matrix == `money.ts` + rule v1 outputs.
- Admin: new "Commerce" section inside `AdminDashboard.tsx` (existing `requireAdmin`), routes under
  `/api/admin/commerce/*` in a new `routes/adminCommerce.ts` mounted from `admin.ts`: list, draft edit,
  validate, preview (re-price a sample of recent orders under draft vs published), publish with
  effective date, history, diff, rollback (= publish a copy of an older version as new version). Mandatory reason.
- Seed: rule v1 (current behaviour). Draft v2 (target model) left unpublished.

**Not touched:** any checkout route. **Flags:** `commerce.rules_v2` (admin UI visibility only).

## Phase 2 — Quotes, orders, snapshots, shadow mode

**Tables:** `commerce_quotes` (expiring, server-computed, bound to resource + identity + coupon),
`commerce_orders`, `commerce_order_lines`, `pricing_snapshots` (immutable; includes `rule_version_ids`,
`engine_version`, all allocation fields from the prompt §8), `commerce_shadow_diffs`.

**Code:** `server/src/commerce/quoteService.ts` with one *resource adapter* per type (loads list price —
normalising whole-euro columns, R11 — capacity, partner identity, scenario). `POST /api/commerce/quotes`,
`GET /api/commerce/orders/:id`.

**Shadow:** with `commerce.shadow` on, every existing checkout also runs the new engine with rule v1 and writes
a `commerce_shadow_diffs` row (never alters the response). Gate to proceed: zero unexplained diffs over an agreed
sample in staging.

**First live type: Experiences** — already has a server quote endpoint, full breakdown columns, single vendor
owner, coupon support, finance-gated refund, and the fewest legacy paths. With `commerce.engine_v2.experience`
on: quote → order → existing pending row → existing Stripe flow; webhook updates order in the same transaction.

**Client:** `ExperienceDetail.tsx` reads `/commerce/quotes` behind the flag. Bookings/registrations/passes later
replace their client-side maths (C1–C6) in Phase 8.

## Phase 3 — Coupon normalisation

Additive `coupons` columns: `funding` (`partner | platform | split`), `platform_share_bps`, `owner_kind`,
`owner_id`, `min_spend_cents`, `max_discount_cents`, `per_customer_limit`, `starts_at`, `status`
(`active | paused | expired | archived`), `archived_at`. Backfill: admin-created → `platform`; vendor/host →
`partner`. New `coupon_redemptions` (reserve → confirm → release → reverse, unique per order) replaces bare
`used_count` arithmetic while keeping `used_count` updated for compatibility. Role rules from prompt §9;
admin-only for `platform`/`split`; audit with reason; soft-archive instead of delete (R6). Migrate Experiences
first, then the rest in Phase 8.

## Phase 4 — Settlement ledger

`ledger_entries` (append-only, `entry_group_id`, double-entry `account`/`amount_minor` signed, unique
`idempotency_key`), `payout_allocations`, `stripe_events` (unique Stripe event id). Post on: paid, completion
(D6), refund (full + **partial** — extend `issueStripeRefund` with an amount, R7), dispute opened/closed (new
webhook handlers, R9), payout recorded (manual export until Stripe Connect is approved, D3). Reconciliation
views + "refund required" queue (R13). Financial invariants from prompt §21 as property tests.

## Phase 5 — Circle Credits

`reward_accounts`, `reward_transactions` (unique idempotency key, source order/refund). Earn pending on paid,
release on completion, proportional reversal on refund/chargeback, redemption → `subscription_credits`, negative
balance blocks redemption. Partner-facing "Offers & Credits" tab in `VendorDashboard` and host Manage.
Depends on Phase 4 (R23).

## Phase 6 — Pro subscriptions

`subscription_plans` (rule-backed price), `partner_subscriptions`, `subscription_invoices`,
`subscription_credits`. Stripe Billing in **test mode only**; Stripe Price IDs stored per environment in
config, never in code. `invoice.*` / `customer.subscription.*` webhook handlers with `stripe_events`
idempotency. Blocked on D8 (what Pro unlocks) and a test-mode key.

## Phase 7 — Boost vouchers

`boost_vouchers`, `boost_campaigns`, redemption records. Reuse the existing admin `featured` flag mechanism
(`admin.ts:276`) as the visibility effect, add a visible "Promoted" label, keep organic ranking
(`recommendationWeights.ts`) untouched.

## Phase 8 — Migrate remaining types (one at a time)

Order: Programmes → Venue bookings (deposit, cash, Open Booking — D4, D9) → Club registrations (cash, trial,
pass redemption) → Paid Games (host scenario, D5) → Passes (R10). Each: shadow → integration tests → role tests →
refund tests → flag on in staging → rollback drill.

## Phase 9 — Staging/release readiness

As prompt §19 Phase 9. Production only on explicit instruction (standing rule: no push/deploy without
per-instance approval).

## Rollback model (all phases)

- Flags off ⇒ legacy path. New tables are ignored, never dropped.
- No legacy column is removed or repurposed during rollout.
- Every backfill script: `--dry-run` default, row counts, idempotent, resumable, refuses `hello_circle`
  (prod) unless an explicit approval flag *and* env are set.

## Rough effort (single engineer, including tests)

| Phase | Estimate |
|---|---|
| 0.5 hardening | 1–2 days |
| 1 config foundation + admin UI | 5–7 days |
| 2 quotes/orders/shadow + Experiences live | 6–8 days |
| 3 coupons | 4–5 days |
| 4 ledger + partial refunds + disputes + reconciliation | 8–10 days |
| 5 Circle Credits | 4–5 days |
| 6 Pro (test mode) | 5–7 days |
| 7 Boost | 3–4 days |
| 8 remaining 5 types | 8–12 days |
| 9 readiness | 4–6 days |

## Documentation to be created as phases land

`commerce-architecture.md`, `commerce-config-catalog.md`, `commerce-data-model.md`, `commerce-workflows.md`,
`commerce-security.md`, `commerce-test-plan.md`, `commerce-rollout.md`, `commerce-operations-runbook.md` — each
started in the phase that first needs it (config catalog in Phase 1, data model in Phase 2, runbook in Phase 4).
