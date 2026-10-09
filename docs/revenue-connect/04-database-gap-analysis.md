# 04 — Database gap analysis and proposed changes

Conventions are kept: MySQL with additive `CREATE TABLE IF NOT EXISTS` / `ensureColumn` in `initSchema()`. There
are no down-migrations today, so rollback is by feature flag plus ignorable tables (see 08). Money is `BIGINT`
minor units with `CHAR(3) currency`. Rates are `INT` basis points. Timestamps are `DATETIME` UTC.

## Brief entities vs what exists

| Brief entity | Exists? | Plan |
|---|---|---|
| pricing_plans, plan_versions, plan_entitlements | ✗ | **New.** `pricing_plans` (free/pro/enterprise), plan values held as versioned config (below), `plan_entitlements` keyed by plan version |
| fee_rules, tax_rules, business_config_versions | ~ `commerce_rule_versions` | **Extend.** Add rule keys `plan.free`, `plan.pro`, `tax.vat`, `payment_costs`, `settlement`, `rewards`, `credits`, `availability`. Add statuses `review`, `scheduled`, `retired` and a `reviewed_by` column |
| calculation_snapshots | ~ `pricing_snapshots` | **Extend.** Add `formula_version`, `plan_key` + `plan_version_id`, `tax_rule_version_id`, `policy_version_ids`, `vendor_funded_discount_minor`, `credit_applied_minor`, `platform_fee_vat_minor`, `partner_pool_minor`, `reward_reserve_minor`, `risk_reserve_minor`, `margin_warning` |
| connected_accounts, account_requirements | ✗ | **New.** One per payee (`org` or `host`), with Stripe account id, capabilities, `payouts_enabled`, `requirements_due` (JSON), verification status and country |
| payment_records | ~ `commerce_orders` | **Extend.** Add `stripe_charge_id`, `stripe_balance_txn_id`, actual Stripe fee, captured amount |
| transfer_records | ✗ | **New.** Settlement allocation → Stripe transfer: amount, `transfer_group`, reversal amount, status |
| payout_records | ✗ | **New.** Mirrors Stripe payouts per connected account (`payout.*` webhooks) |
| settlements, settlement_allocations | ✗ (`payout_allocations` planned) | **New.** Weekly settlement run per payee. Allocations per order and recipient (venue/host/vendor), with fixed/percentage/remainder split metadata |
| ledger_accounts, ledger_entries | ✗ | **New.** Append-only double entry: `entry_group_id` balanced per group, `account_code`, `party_type/id`, signed `amount_minor`, `source_type/id`, unique `idempotency_key`, `estimate`/`actual` flag, `reverses_entry_id` |
| subscriptions, subscription_events | ✗ | **New.** Partner Pro subscriptions (Stripe Billing ids, status, period, grace-until, plan version) |
| coupon_campaigns, coupon_versions, coupon_redemptions | ~ `coupons` + `coupon_redemptions` | **Extend.** `coupon_campaigns` (budget cap, approval, owner, public/internal, timezone); `coupon_versions` (immutable terms); eligibility tables; `stackable`, `new_customer_only` |
| credit_accounts, credit_entries | ✗ | **New.** Per-customer credit account per currency; entries typed (refund, promo, referral, recovery, gift, vendor) with funding owner, expiry, terms version, remaining balance. Redemptions locked per account |
| reward_accounts, reward_entries | ✗ | **New.** Partner points: pending, available, redeemed, reversed, expired, adjusted |
| disputes, refunds | ✗ (refund = status flag) | **New.** `refunds` (partial, reason, responsible party, linked order/transfer reversal); `disputes` (Stripe dispute id, status, evidence due, recovery status) |
| webhook_events | ✗ | **New.** Unique Stripe `event_id`, type, account (Connect), minimal payload digest, received/processed timestamps, status (`processed`/`failed`/`manual_review`), attempt count |
| reconciliation_runs | ✗ | **New.** Per run: Stripe balance transactions vs ledger, mismatches |
| policy_documents, policy_versions, policy_acceptances | ✗ (`terms_accepted_at`, `terms_version` columns only) | **New.** Per §20/§22 (content hash, statuses, placeholders check, acceptance with key, version and hash) |
| help_articles | ✗ (static pages) | **New.** Keyed articles and field-help entries (name, definition, formula, example, who pays, when, refund behaviour, policy link) |
| complaints, appeals | ~ `reports` | **New** `complaints`, `appeals`, `moderation_decisions` (with a reason shown to the user) |
| audit_events | ~ `audit_log` (+ reason, actor_kind, correlation, environment) | **Keep `audit_log`** (already extended). Add `actor_role` |
| — | — | **New** `trader_profiles` (DSA/DAC7: business vs individual, registration, VAT/TIN, address, verification dates); `users.admin_role` |

## Integrity choices

- **Foreign keys:** declared between the new finance tables (orders → snapshots, lines, allocations, transfers,
  ledger groups) where both sides are new. Legacy participation tables keep application-enforced relationships
  (adding FKs there risks failing on historical orphans; decision B10).
- **Unique constraints:** `webhook_events.event_id`; `ledger_entries.idempotency_key`; `transfer_records(allocation_id)`;
  `refunds.stripe_refund_id`; `policy_versions(document_key, version)`; `policy_acceptances(user, policy_version)`.
- **Optimistic locking:** `row_version INT` on `settlements`, `credit_accounts`, `reward_accounts` and
  `subscriptions`, updated with `WHERE row_version = ?`.
- **Immutability:** ledger entries, snapshots, published config and policy versions have no UPDATE path in code.
  Corrections are reversing entries or new versions.

## Legacy data

- No rewrite of historical rows. Legacy paid orders get **total-only "legacy" snapshots** via a dry-run-first
  backfill, so reports can span both.
- Whole-euro columns stay as they are and are normalised at the engine boundary.
