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
  await initConfigurationSchema(ensureColumn);
}

// Configuration framework Phase B/C (docs/participation-expansion/13, 14).
// Capability on/off state reuses the existing feature_flags table; only the
// per-organisation limits and the informational template are new.
async function initConfigurationSchema(ensureColumn: EnsureColumn): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS org_capability_limits (
      org_id VARCHAR(191) NOT NULL,
      limit_key VARCHAR(80) NOT NULL,
      value INT NOT NULL,
      PRIMARY KEY (org_id, limit_key)
    );
  `);
  // Which starting template an admin applied (informational; NULL = none yet).
  await ensureColumn("organisations", "template", "template VARCHAR(40) NULL");
  // Optimistic concurrency for capability changes (409 when stale).
  await ensureColumn("organisations", "config_version", "config_version INT NOT NULL DEFAULT 0");
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
      input_type VARCHAR(20) NOT NULL DEFAULT 'text',
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
      input_type_snapshot VARCHAR(20) NOT NULL,
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
  // Configuration Phase F — field registry properties on each question (all optional).
  await ensureColumn("registration_questions", "field_key", "field_key VARCHAR(60) NULL");
  await ensureColumn("registration_questions", "placeholder", "placeholder VARCHAR(120) NULL");
  await ensureColumn("registration_questions", "default_value", "default_value VARCHAR(200) NULL");
  await ensureColumn("registration_questions", "min_length", "min_length INT NULL");
  await ensureColumn("registration_questions", "max_length", "max_length INT NULL");
  await ensureColumn("registration_questions", "editability", "editability VARCHAR(20) NOT NULL DEFAULT 'until_start'");
  await ensureColumn("registration_questions", "exportable", "exportable TINYINT NOT NULL DEFAULT 0");
  // Phase F answer types are up to 12 characters ("multi_select"): widen the two
  // Phase 2 columns created at VARCHAR(10). Widening keeps every existing value.
  await widenVarchar("registration_questions", "input_type", 20, "NOT NULL DEFAULT 'text'");
  await widenVarchar("registration_answers", "input_type_snapshot", 20, "NOT NULL");
  // Phase G — sections, simple conditions, drafts and templates.
  await ensureColumn("registration_questions", "section", "section VARCHAR(120) NULL");
  await ensureColumn("registration_questions", "show_if_json", "show_if_json TEXT NULL");
  // Phase H — the same form engine for club registrations, programme enrolments
  // and hall bookings: each listing keeps its own published-version counter.
  for (const table of ["clubs", "programs", "centres", "games"]) await ensureColumn(table, "questions_version", "questions_version INT NOT NULL DEFAULT 0");
  // Phase K — partner messages: who sent it, to which audience, from which
  // template; one delivery row per person and channel (status, attempts),
  // and one row per (sender, idempotency key) so a repeated send is a no-op.
  // Deliveries keep the order reference, not the address (looked up at send).
  for (const [col, ddl] of [
    ["org_id", "org_id VARCHAR(191) NULL"],
    ["sent_by_user_id", "sent_by_user_id VARCHAR(191) NULL"],
    ["audience_json", "audience_json TEXT NULL"],
    ["template_key", "template_key VARCHAR(40) NULL"],
    ["recipient_count", "recipient_count INT NOT NULL DEFAULT 0"],
  ] as const) await ensureColumn("vendor_messages", col, ddl);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS vendor_message_deliveries (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      message_id INT NOT NULL,
      recipient_key VARCHAR(80) NOT NULL,
      channel VARCHAR(10) NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      order_ref VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191) NULL,
      first_name VARCHAR(60) NOT NULL DEFAULT '',
      status VARCHAR(24) NOT NULL DEFAULT 'queued',
      attempts INT NOT NULL DEFAULT 0,
      last_error VARCHAR(120) NULL,
      sent_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_message_delivery (message_id, recipient_key, channel),
      KEY idx_message_delivery_status (status, attempts)
    );
    CREATE TABLE IF NOT EXISTS vendor_message_requests (
      vendor_id VARCHAR(191) NOT NULL,
      idem_key VARCHAR(80) NOT NULL,
      message_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (vendor_id, idem_key)
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS registration_form_drafts (
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      base_version INT NOT NULL,
      draft_json TEXT NOT NULL,
      updated_by VARCHAR(191) NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (listing_type, listing_id)
    );
    CREATE TABLE IF NOT EXISTS registration_form_templates (
      id VARCHAR(191) PRIMARY KEY,
      org_id VARCHAR(191) NOT NULL,
      form_type VARCHAR(40) NOT NULL,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(300) NOT NULL DEFAULT '',
      questions_json TEXT NOT NULL,
      status VARCHAR(12) NOT NULL DEFAULT 'active',
      created_by VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_form_templates_org (org_id, status)
    );
  `);
  // The admin field policy: one row, versioned; every change is audited.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS field_policies (
      id INT NOT NULL PRIMARY KEY,
      version INT NOT NULL DEFAULT 0,
      policy_json TEXT NULL,
      updated_by VARCHAR(191) NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
  `);
}

/** Idempotent: widens a VARCHAR column only when it is narrower than `length`. */
async function widenVarchar(table: string, column: string, length: number, rest: string): Promise<void> {
  const row = (await db
    .prepare(`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`)
    .get(table, column)) as { len: number } | undefined;
  if (row && Number(row.len) < length) await db.exec(`ALTER TABLE ${table} MODIFY COLUMN ${column} VARCHAR(${length}) ${rest}`);
}

