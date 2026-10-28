import { db } from "../db/index.js";

// Participation Expansion Phase 1 (docs/participation-expansion/03, 07) —
// registration options and purchased lines. Additive only: two new tables and
// two new columns; no foreign keys (none anywhere in this schema) and no TEXT
// column with a literal DEFAULT (MySQL refuses it). Called from initSchema().
//
// offering_options — what a listing sells. Phase 1: experiences only.
// order_lines      — what an order bought, keyed on (source_type, source_ref)
//                    like attendance/order_acknowledgements; every label, price
//                    and tax value is a snapshot frozen at purchase and never
//                    re-read from offering_options afterwards.

type EnsureColumn = (table: string, column: string, ddl: string) => Promise<void>;
type EnsureIndex = (table: string, name: string, columns: string) => Promise<void>;

export async function initParticipationSchema(ensureColumn: EnsureColumn, ensureIndex: EnsureIndex): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS offering_options (
      id VARCHAR(191) PRIMARY KEY,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      kind VARCHAR(12) NOT NULL DEFAULT 'option',
      label VARCHAR(120) NOT NULL,
      description VARCHAR(500) NOT NULL DEFAULT '',
      price_minor INT NOT NULL DEFAULT 0,
      price_basis VARCHAR(12) NOT NULL DEFAULT 'per_person',
      heads_per_unit INT NOT NULL DEFAULT 1,
      age_band VARCHAR(12) NULL,
      capacity INT NULL,
      max_per_order INT NULL,
      sale_starts_at DATETIME NULL,
      sale_ends_at DATETIME NULL,
      tax_treatment VARCHAR(20) NOT NULL DEFAULT 'standard',
      sort_order INT NOT NULL DEFAULT 0,
      active TINYINT NOT NULL DEFAULT 1,
      created_by_user_id VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_lines (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      source_type VARCHAR(20) NOT NULL,
      source_ref VARCHAR(191) NOT NULL,
      line_no INT NOT NULL,
      line_kind VARCHAR(12) NOT NULL DEFAULT 'option',
      option_id VARCHAR(191) NULL,
      label_snapshot VARCHAR(120) NOT NULL,
      description_snapshot VARCHAR(500) NOT NULL DEFAULT '',
      price_basis_snapshot VARCHAR(12) NOT NULL,
      age_band_snapshot VARCHAR(12) NULL,
      heads_per_unit_snapshot INT NOT NULL,
      unit_minor INT NOT NULL,
      quantity_purchased INT NOT NULL,
      heads_purchased INT NOT NULL,
      quantity INT NOT NULL,
      heads INT NOT NULL,
      tax_treatment_snapshot VARCHAR(20) NOT NULL,
      vat_bps_snapshot INT NOT NULL,
      vat_mode_snapshot VARCHAR(20) NOT NULL,
      fee_bps_snapshot INT NOT NULL,
      pricing_source VARCHAR(90) NOT NULL,
      refunded_quantity INT NOT NULL DEFAULT 0,
      refunded_minor INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_order_line (source_type, source_ref, line_no)
    );
  `);
  await ensureIndex("offering_options", "idx_offering_options_listing", "(listing_type, listing_id, active, sort_order)");
  await ensureIndex("order_lines", "idx_order_lines_option", "(option_id)");
  // 'single' = priced the original way (one price × party); 'lines' = priced
  // from order_lines. Constant default, so every existing row reads 'single'.
  await ensureColumn("experience_bookings", "pricing_mode", "pricing_mode VARCHAR(10) NOT NULL DEFAULT 'single'");
  // A listing's options are edited with optimistic concurrency (409 when stale).
  await ensureColumn("experiences", "options_version", "options_version INT NOT NULL DEFAULT 0");
  // The lines a stored quote priced, compared again when the quote is consumed.
  await ensureColumn("commerce_quotes", "lines_json", "lines_json TEXT NULL");
}
