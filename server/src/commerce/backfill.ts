// Revenue & Connect Stage 2d — legacy-order snapshot backfill (docs 08 rule 3).
//
// Paid orders created before the commerce engine have no commerce order or
// pricing snapshot. This gives each one a "legacy-backfill" snapshot built
// from its own stored breakdown (or the exact recovery of a total-only row),
// so reports and statements can span old and new orders. Dry-run by default,
// idempotent (unique source per order), batch-sized, and never rewrites the
// original row. Rows whose breakdown can't be recovered are listed, not guessed.

import crypto from "node:crypto";
import { db } from "../db/index.js";
import type { CheckoutType } from "../checkoutService.js";
import { SOURCE_TABLES, CATEGORY_OF, SCENARIO_OF } from "./engine.js";
import { legacyBreakdownFromTotal, sourceOwner } from "./payments.js";
import { resolveRule } from "./rules.js";

const BREAKDOWN_TYPES: CheckoutType[] = ["booking", "registration", "experience"];
const TOTAL_ONLY_TYPES: CheckoutType[] = ["program", "game"];

export interface BackfillReport {
  dryRun: boolean;
  scanned: number;
  created: number;
  skippedExisting: number;
  unrecoverable: { type: string; ref: string; reason: string }[];
}

export async function backfillLegacySnapshots(opts: { dryRun?: boolean; limit?: number } = {}): Promise<BackfillReport> {
  const dryRun = opts.dryRun !== false;
  const limit = opts.limit ?? 500;
  const pricing = await resolveRule("pricing");
  const vatBps = Number(pricing.values.vatBps);
  const feeBps = Number(pricing.values.customerFeeBps);
  const report: BackfillReport = { dryRun, scanned: 0, created: 0, skippedExisting: 0, unrecoverable: [] };

  for (const type of [...BREAKDOWN_TYPES, ...TOTAL_ONLY_TYPES]) {
    const table = SOURCE_TABLES[type];
    const cols = BREAKDOWN_TYPES.includes(type) ? "x.subtotal_cents as t, x.discount_cents as d, x.vat_cents as v, x.platform_fee_cents as f, x.coupon_code as coupon," : "NULL as t, NULL as d, NULL as v, NULL as f, x.coupon_code as coupon,";
    const rows = (await db
      .prepare(
        `SELECT x.ref, ${cols} x.total_cents as total, x.client_id as clientId, x.resident_id as residentId FROM ${table} x
         LEFT JOIN commerce_orders o ON o.source_type = ? AND o.source_ref = x.ref
         WHERE x.payment_status = 'paid' AND x.ref IS NOT NULL AND o.id IS NULL AND COALESCE(x.total_cents, 0) > 0
         LIMIT ?`
      )
      .all(type, limit)
      .catch(async () =>
        // game_participants has no client_id column.
        db
          .prepare(
            `SELECT x.ref, ${cols} x.total_cents as total, NULL as clientId, x.resident_id as residentId FROM ${table} x
             LEFT JOIN commerce_orders o ON o.source_type = ? AND o.source_ref = x.ref
             WHERE x.payment_status = 'paid' AND x.ref IS NOT NULL AND o.id IS NULL AND COALESCE(x.total_cents, 0) > 0
             LIMIT ?`
          )
          .all(type, limit)
      )) as { ref: string; t: number | null; d: number | null; v: number | null; f: number | null; coupon: string | null; total: number; clientId: string | null; residentId: string | null }[];

    for (const r of rows) {
      report.scanned++;
      const total = Number(r.total);
      let taxable: number;
      let vat: number;
      let fee: number;
      let discount = 0;
      if (r.t !== null) {
        taxable = Number(r.t);
        vat = Number(r.v);
        fee = Number(r.f);
        discount = Number(r.d ?? 0);
      } else {
        const b = legacyBreakdownFromTotal(total, vatBps, feeBps);
        if (!b) {
          report.unrecoverable.push({ type, ref: r.ref, reason: "total doesn't match the legacy formula" });
          continue;
        }
        ({ taxable, vat, fee } = b);
      }
      const deposit = total - taxable - vat - fee;
      if (deposit < 0) {
        report.unrecoverable.push({ type, ref: r.ref, reason: "stored breakdown exceeds the total" });
        continue;
      }
      const owner = await sourceOwner(type, r.ref);
      if (!owner) {
        report.unrecoverable.push({ type, ref: r.ref, reason: "no partner found" });
        continue;
      }
      if (dryRun) {
        report.created++;
        continue;
      }
      const made = await db.transaction(async (tx) => {
        const id = crypto.randomUUID();
        try {
          await tx
            .prepare(
              `INSERT INTO commerce_orders (id, source_type, source_ref, scenario, category, customer_client_id, customer_resident_id, partner_kind, partner_id,
                 vendor_user_id, host_resident_id, currency, order_status, payment_status, customer_paid_minor, rule_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'EUR', 'confirmed', 'paid', ?, 'legacy')`
            )
            .run(id, type, r.ref, SCENARIO_OF[type], CATEGORY_OF[type], r.clientId, r.residentId, owner.partyType, owner.partyId, owner.partyType === "host" ? owner.partyId : null, total);
        } catch (e) {
          if (e instanceof Error && /Duplicate/.test(e.message)) return false;
          throw e;
        }
        await tx
          .prepare(
            `INSERT INTO pricing_snapshots (order_id, engine_version, rule_hash, rule_sources, rule_values, currency, list_minor, discount_minor, coupon_code,
               goods_gross_minor, vat_minor, customer_fee_minor, deposit_minor, customer_paid_minor, partner_gross_minor, success_fee_minor,
               payment_cost_minor, partner_payment_cost_minor, partner_payout_minor, platform_revenue_minor, platform_contribution_minor)
             VALUES (?, 'legacy-backfill', 'legacy', '[]', ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`
          )
          .run(id, JSON.stringify({ vatBps, customerFeeBps: feeBps }), taxable + discount, discount, r.coupon, taxable + vat, vat, fee, deposit, total, taxable, taxable, fee, fee);
        return true;
      });
      if (made) report.created++;
      else report.skippedExisting++;
    }
  }
  return report;
}
