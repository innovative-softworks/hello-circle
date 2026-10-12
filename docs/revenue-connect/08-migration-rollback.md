# 08 — Migration and rollback plan

## Migration rules

1. **Additive only.** `CREATE TABLE IF NOT EXISTS`, `ensureColumn`, `ensureIndex` inside `initSchema()`. No
   destructive DDL. No legacy column removed or repurposed.
2. **Idempotent seeds.** Use `INSERT IGNORE` on natural unique keys, as for rule v1 today. Never depend on mysql2
   `affectedRows` for upsert detection (known quirk). No `DEFAULT` on TEXT/JSON columns. No backticks inside SQL
   comments in `db/index.ts`.
3. **Backfills.** Scripts under `server/src/scripts/` with `--dry-run` as the default, row counts, validation,
   batch progress, and resumable idempotency keys. They refuse `hello_circle` (prod) unless `APP_ENV=production`
   and `--i-have-approval` are both set.
4. **Ordering.** Schema first (inert), then code behind flags (off), then a per-type shadow comparison, then the
   flag on in staging, then the pilot.
5. **Backups.** The existing nightly backup plus a **pre-deploy backup** for every release touching finance tables
   (the procedure already exists in `docs/` / DEPLOY.md).

## Rollback per layer

| Layer | Rollback | Data effect |
|---|---|---|
| New tables and columns | Leave in place (ignored by legacy code). Optional manual `DROP` in a maintenance window only after the flags have been off for a full cycle | None |
| Engine pricing (`pricing.pe2`, per type) | Flag off → legacy `pe-1` on the next checkout | Existing orders keep their snapshot |
| Ledger / settlement | Flag off → no new postings or settlements. Existing entries remain as the record | Reversal entries only, never deletes |
| Connect (`connect.v1`) | Flag off → checkout goes back to platform-only charges. Pending (untransferred) allocations stay owed in the ledger and can be paid manually | Transfers already made stay; reversals only through the refund/dispute path |
| Pro billing (`billing.pro`) | Flag off → no new subscriptions. Existing subscriptions keep running in Stripe until cancelled in a controlled run | Plan snapshot on orders unchanged |
| Policy CMS (`policy.cms`) | Flag off → static `/privacy` and `/cookies` pages | Acceptance records kept |

## Tested rollback (success criterion 19)

For every stage, the isolated test profile runs a scripted **flag on → transactions → flag off → transactions**
cycle. The test asserts that legacy behaviour is byte-identical (golden totals) and that no historical snapshot
or ledger row changed (hash before and after).

## Stage 5e (Accounts v2, venue/host split)

Additive only: new `connected_accounts` columns (`api_model` default `'v1'`, `configuration_type`, `dashboard_type`,
`business_type`, `onboarding_state`, capability and requirement columns, `last_synced_at`, `last_event_id`,
`creation_key` unique), and new tables `connected_account_creations`, `connected_account_syncs`,
`venue_split_agreements`, `allocation_snapshots`, `allocation_lines`, `order_party_releases` and
`dispute_recovery_allocations`. New rule key `venue_split` (v1 seeded), and new help entries (v1 seeded, editable).

Rollback: switch `commerce.connect_v1` off, then deploy the previous build; it ignores the new columns and tables.
v2 accounts created meanwhile can't be managed by a pre-5e build. Keep Connect off until 5e is redeployed. No data
migration needs reversing; split agreements and snapshots are inert without the new code. See
`connect-operations.md` §7.
