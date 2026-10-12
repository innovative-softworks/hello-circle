# Commerce — data model (as built through Phase 2)

Everything here is additive. It's created in `initCommerceSchema()` (`server/src/db/index.ts`) with
`CREATE TABLE IF NOT EXISTS` and `ensureIndex`. Like the rest of the app, it has no foreign keys: relationships are
enforced in `server/src/commerce/*`. Money is `BIGINT` minor units next to a `CHAR(3)` currency. Rates are `INT`
basis points inside rule payloads.

```
commerce_rule_versions ──(resolved by)──▶ resolveRule() ──▶ PricingValues ──▶ priceBreakdown()
                                                                         │
commerce_quotes ──(single use, order_id)──▶ commerce_orders ◀──1:1── pricing_snapshots
                                               │  (source_type, source_ref) unique
                                               ├──1:n── commerce_order_lines
                                               └── mirrors ──▶ experience_bookings / bookings / … (legacy row)
commerce_shadow_diffs  (legacy price vs rules price, per checkout, while shadow is on)
audit_log  (+ actor_kind, reason, correlation_id, environment)
```

## `commerce_rule_versions` (Phase 1)

A versioned rule per `(rule_key, scope_type, scope_id)`, where `scope_id` is `''` for global.
- Status runs `draft → approved → published`, or `discarded`.
- `effective_from` is never in the past. `effective_to` exists only for ending overrides.
- `payload` is JSON text (TEXT, with no DEFAULT), alongside a `payload_hash` (sha256 of the canonical JSON).
- Unique: `(rule_key, scope_type, scope_id, version)`. Index: `(rule_key, scope_type, scope_id, status,
  effective_from)`.

## `commerce_quotes` (Phase 2)

| Column | Notes |
|---|---|
| `id` CHAR(36) | Returned to the client as `quoteId` |
| `source_type`, `resource_id`, `session_id`, `quantity`, `coupon_code` | What was priced; checkout must match all of them |
| `client_id`, `resident_id` | Who it was priced for; checkout must match one of them |
| `customer_paid_minor`, `rule_hash`, `breakdown` | The promise. Checkout re-prices and refuses if either the hash or the total differs |
| `expires_at` | 15 minutes (`QUOTE_TTL_MINUTES`, a technical constant) |
| `used_at`, `order_id` | Set once, under a row lock. Cleared only when no payment page was ever created |

## `commerce_orders` (Phase 2)

Wraps exactly one participation row: unique `(source_type, source_ref)`.

| Column | Values |
|---|---|
| `scenario`, `category` | From `SCENARIO_OF` / `CATEGORY_OF` in `engine.ts` |
| `partner_kind`, `partner_id` | `org` + organisation id; `vendor` + user id when the vendor has no org; `host` + resident id |
| `order_status` | `pending_payment`, `confirmed`, `cancelled`, `failed` |
| `payment_status` | `pending`, `paid`, `refunded`, `failed`, `not_required` (zero-total) |
| `fulfilment_status` | `scheduled`, `cancelled` (completion arrives with the ledger, Phase 4) |
| `payout_status` | `not_tracked` until Phase 4 |
| `stripe_session_id`, `stripe_payment_intent_id` | Indexed on the session id |

The status columns are **derived** from the source row by `syncOrderFromSource()`, which runs after every webhook
confirm/fail, refund and cancel. They are never set independently, so the order can't disagree with the booking
for long, and Phase 4 reconciliation can re-derive them.

## `commerce_order_lines` (Phase 2)

One line per priced item: `item_type`, `item_id`, `quantity`, `unit_minor`, `line_subtotal_minor`,
`discount_minor`, `tax_minor` and `final_minor`.

## `pricing_snapshots` (Phase 2, immutable)

Primary key `order_id`. It stores:
- the engine version, the rule hash, the contributing rule versions (`rule_sources`) and the merged values
  (`rule_values`)
- every `PriceBreakdown` field: list, discount, coupon, goods gross, VAT, customer fee, deposit, customer paid,
  partner gross, success fee, payment cost (total and partner share), partner payout, platform revenue and
  platform contribution
- `platform_funded_discount_minor` and `reward_liability_minor`, reserved for Phases 3 and 5 (0 for now)

No code path updates this table.

## `commerce_shadow_diffs` (Phase 2)

One row per legacy checkout while `commerce.shadow_pricing` is on. It records `matched`, `diff_fields` (`total`,
`vat`, `fee`, `discount`), both price JSONs and the rule hash.

## `coupons` additions and `coupon_redemptions` (Phase 3)

`coupons` gains:
- `funding` (`platform` | `split` | `partner`) and `platform_share_bps`
- `min_spend_cents`, `max_discount_cents`, `per_customer_limit` and `starts_at`, all nullable (null = no limit)
- `archived_at` (archive replaces delete)

Partner-created rows are always `partner`/0.

`coupon_redemptions` holds one row per order that used a coupon, unique on `(source_type, source_ref)`:
- `coupon_id`, `code` and `customer_key` (`r:<resident>` or `c:<client>`)
- `discount_minor` and `platform_funded_minor` (exact split)
- `status`: `reserved` → `confirmed` | `released` | `reversed`

It's written in the same transaction as the `used_count` increment, while `commerce.coupons_v2` is on. Status
moves only forward, through `endPendingHold` and `syncOrderFromSource`.

## Legacy columns kept as they are

The participation tables keep writing `subtotal_cents` (post-discount, see R12), `discount_cents`, `vat_cents`,
`platform_fee_cents` and `total_cents` exactly as before. For engine-priced experience bookings these come from
`legacyColumns(breakdown)`, so every existing reader (vendor payments, receipts, My Life) keeps working unchanged.
