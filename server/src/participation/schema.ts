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
  await initParticipationPhase2Schema(ensureColumn, ensureIndex);
}

// Participation Phase 2 (docs/participation-expansion/11, 12) — attendees,
// registration questions, per-person check-in and check-in assignments. All
// keyed like order_lines on (source_type, source_ref); new tables only, plus
// experiences.questions_version. A booking with no attendee rows (every
// booking made before Phase 2, or with the switch off) reads its people from
// party_size + seat names instead, so nothing needs a backfill.
//
// booking_attendees         — who is coming: adult/child, the order line they
//                             came with, and who looks after each child.
// registration_questions    — a listing's question set, saved whole under
//                             experiences.questions_version; never deleted.
// registration_answers      — answers with the question's label/type frozen;
//                             attendee_no 0 = the booking's own answers.
// attendee_checkins         — one row per person checked in (UNIQUE, so a
//                             second scan can't check the same person twice).
// listing_staff_assignments — an organisation member assigned to check people
//                             in for one listing, or one date of it.
//                             active_key is NULL once revoked (unique while live).
async function initParticipationPhase2Schema(ensureColumn: EnsureColumn, ensureIndex: EnsureIndex): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS booking_attendees (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      source_type VARCHAR(20) NOT NULL,
      source_ref VARCHAR(191) NOT NULL,
      attendee_no INT NOT NULL,
      line_no INT NULL,
      person_type VARCHAR(10) NOT NULL DEFAULT 'adult',
      name VARCHAR(120) NOT NULL,
      guardian_kind VARCHAR(10) NULL,
      guardian_attendee_no INT NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_booking_attendee (source_type, source_ref, attendee_no)
    );

    CREATE TABLE IF NOT EXISTS registration_questions (
      id VARCHAR(191) PRIMARY KEY,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      qkey VARCHAR(40) NOT NULL,
      version INT NOT NULL,
      scope VARCHAR(10) NOT NULL DEFAULT 'booking',
      input_type VARCHAR(10) NOT NULL DEFAULT 'text',
      label VARCHAR(200) NOT NULL,
      help VARCHAR(300) NOT NULL DEFAULT '',
      purpose VARCHAR(300) NOT NULL DEFAULT '',
      required TINYINT NOT NULL DEFAULT 0,
      choices_json TEXT NULL,
      min_value INT NULL,
      max_value INT NULL,
      applies_to VARCHAR(10) NOT NULL DEFAULT 'all',
      door_visible TINYINT NOT NULL DEFAULT 0,
      category VARCHAR(20) NOT NULL DEFAULT 'general',
      sort_order INT NOT NULL DEFAULT 0,
      active TINYINT NOT NULL DEFAULT 1,
      created_by_user_id VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS registration_answers (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      source_type VARCHAR(20) NOT NULL,
      source_ref VARCHAR(191) NOT NULL,
      attendee_no INT NOT NULL DEFAULT 0,
      question_id VARCHAR(191) NOT NULL,
      qkey VARCHAR(40) NOT NULL,
      questions_version INT NOT NULL,
      label_snapshot VARCHAR(200) NOT NULL,
      input_type_snapshot VARCHAR(10) NOT NULL,
      choices_snapshot TEXT NULL,
      door_visible_snapshot TINYINT NOT NULL DEFAULT 0,
      value_text VARCHAR(1000) NOT NULL,
      answered_by_kind VARCHAR(12) NOT NULL DEFAULT 'booker',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_registration_answer (source_type, source_ref, attendee_no, qkey)
    );

    CREATE TABLE IF NOT EXISTS attendee_checkins (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      source_type VARCHAR(20) NOT NULL,
      source_ref VARCHAR(191) NOT NULL,
      attendee_no INT NOT NULL,
      session_id VARCHAR(191) NOT NULL,
      method VARCHAR(10) NOT NULL DEFAULT 'manual',
      checked_in_by VARCHAR(191) NOT NULL,
      checked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_attendee_checkin (source_type, source_ref, attendee_no)
    );

    CREATE TABLE IF NOT EXISTS listing_staff_assignments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      org_id VARCHAR(191) NOT NULL,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      session_id VARCHAR(191) NULL,
      user_id VARCHAR(191) NOT NULL,
      duty VARCHAR(20) NOT NULL DEFAULT 'checkin',
      active_key VARCHAR(191) NULL,
      created_by VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME NULL,
      revoked_by VARCHAR(191) NULL,
      UNIQUE KEY uq_staff_assignment_active (active_key)
    );
  `);
  await ensureIndex("registration_questions", "idx_registration_questions_listing", "(listing_type, listing_id, active, sort_order)");
  await ensureIndex("attendee_checkins", "idx_attendee_checkins_session", "(session_id)");
  await ensureIndex("listing_staff_assignments", "idx_staff_assignments_user", "(user_id, listing_type, listing_id)");
  await ensureIndex("listing_staff_assignments", "idx_staff_assignments_listing", "(listing_type, listing_id)");
  await ensureColumn("experiences", "questions_version", "questions_version INT NOT NULL DEFAULT 0");
}
