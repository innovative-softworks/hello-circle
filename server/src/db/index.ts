import crypto from "node:crypto";
import mysql from "mysql2/promise";
import type { Pool, PoolConnection } from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "hello_circle",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
  // DATETIME columns (created_at, expires_at, ...) are stored in UTC — the DB
  // server's own system time zone is UTC, so NOW()/CURRENT_TIMESTAMP already
  // produce UTC. Without this, mysql2 falls back to whatever local time zone
  // the Node process happens to run in to interpret those values, which is
  // environment-dependent (dev machine vs. host) rather than guaranteed —
  // this makes UTC interpretation explicit instead of accidental. The client
  // then renders everything in Europe/Dublin explicitly at display time.
  timezone: "Z",
});

/** better-sqlite3 auto-nulls `undefined` bind params; mysql2 throws on them.
 * The `COALESCE(?, col)` partial-update pattern used throughout admin/vendor
 * routes relies on being able to pass `undefined` for untouched fields. */
function normalizeParams(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : p));
}

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

type Queryable = Pool | PoolConnection;

function statement(conn: Queryable, sql: string) {
  return {
    // Typed `any`, matching better-sqlite3's own (untyped) `.get`/`.all` —
    // every call site already does its own `as SpecificRow` cast on the result.
    async get(...params: unknown[]): Promise<any> {
      const [rows] = await conn.query(sql, normalizeParams(params));
      return (rows as unknown[])[0];
    },
    async all(...params: unknown[]): Promise<any[]> {
      const [rows] = await conn.query(sql, normalizeParams(params));
      return rows as unknown[];
    },
    async run(...params: unknown[]): Promise<RunResult> {
      // Support both positional (?, ?, ...) and named (@field) styles, the
      // latter used by seed.ts/bookings.ts/registrations.ts/notifications.ts
      // via a single object argument — the pool has namedPlaceholders: true,
      // so translate `@field` to mysql2's `:field` syntax and pass the object
      // straight through as the values argument (not wrapped in an array).
      const isNamed = params.length === 1 && typeof params[0] === "object" && params[0] !== null && !Array.isArray(params[0]);
      // mysql2's TS types don't model the namedPlaceholders object-values
      // form of execute() (they only type ExecuteValues as array/Buffer),
      // even though it's supported and documented at runtime — cast through.
      const [result] = isNamed
        ? await conn.execute(sql.replace(/@(\w+)/g, ":$1"), params[0] as any)
        : await conn.query(sql, normalizeParams(params));
      const r = result as mysql.ResultSetHeader;
      return { changes: r.affectedRows, lastInsertRowid: r.insertId };
    },
  };
}

export const db = {
  prepare(sql: string) {
    return statement(pool, sql);
  },
  /** Runs `fn` against a single connection with an active transaction —
   * replaces better-sqlite3's synchronous `db.transaction(fn)`. Call sites
   * change from `const tx = db.transaction(() => {...}); tx();` to
   * `await db.transaction(async (tx) => {...});`, using the passed `tx`
   * (not the outer `db`) for every statement inside the callback. */
  async transaction<T>(fn: (tx: { prepare(sql: string): ReturnType<typeof statement> }) => Promise<T>): Promise<T> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn({ prepare: (sql: string) => statement(conn, sql) });
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },
  async exec(sql: string): Promise<void> {
    // Strip `-- ...` line comments before splitting/running. Three separate
    // bugs (a semicolon, a backtick, and an apostrophe each once appearing
    // inside a comment) all traced back to the same root cause: neither the
    // naive `split(";")` below nor mysql2's named-placeholders quote-tracker
    // understands SQL line comments, so any semicolon/backtick/quote inside
    // one — completely normal in an English sentence — corrupts statement
    // splitting or the placeholder scan of a later, real string literal in
    // the same statement. Comments stay in this source file for developers;
    // they're just never part of what's actually sent to MySQL.
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    for (const statement of withoutComments.split(";").map((s) => s.trim()).filter(Boolean)) {
      await pool.query(statement);
    }
  },
};

export async function initSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS centres (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      area VARCHAR(255) NOT NULL,
      county VARCHAR(255) NOT NULL,
      rating DOUBLE NOT NULL,
      reviews INT NOT NULL,
      capacity INT NOT NULL,
      from_price INT NOT NULL,
      managed_by VARCHAR(255) NOT NULL,
      ph VARCHAR(255) NOT NULL,
      image_url VARCHAR(500) NOT NULL DEFAULT '',
      blurb TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS centre_amenities (
      centre_id VARCHAR(191) NOT NULL,
      amenity VARCHAR(255) NOT NULL,
      sort_order INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS centre_images (
      centre_id VARCHAR(191) NOT NULL,
      url VARCHAR(500) NOT NULL,
      sort_order INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id VARCHAR(191) NOT NULL,
      centre_id VARCHAR(191) NOT NULL,
      name VARCHAR(255) NOT NULL,
      cap INT NOT NULL,
      rate INT NOT NULL,
      \`desc\` TEXT NOT NULL,
      sort_order INT NOT NULL,
      PRIMARY KEY (centre_id, id)
    );

    CREATE TABLE IF NOT EXISTS clubs (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      sport VARCHAR(255) NOT NULL,
      area VARCHAR(255) NOT NULL,
      county VARCHAR(255) NOT NULL,
      ages VARCHAR(255) NOT NULL,
      price INT NOT NULL,
      unit VARCHAR(50) NOT NULL,
      trial TINYINT NOT NULL,
      ph VARCHAR(255) NOT NULL,
      image_url VARCHAR(500) NOT NULL DEFAULT '',
      blurb TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS club_includes (
      club_id VARCHAR(191) NOT NULL,
      item VARCHAR(255) NOT NULL,
      sort_order INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS club_images (
      club_id VARCHAR(191) NOT NULL,
      url VARCHAR(500) NOT NULL,
      sort_order INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ref VARCHAR(191) NOT NULL UNIQUE,
      client_id VARCHAR(191) NOT NULL,
      centre_id VARCHAR(191) NOT NULL,
      room_id VARCHAR(191) NOT NULL,
      date VARCHAR(20) NOT NULL,
      time VARCHAR(20) NOT NULL,
      duration INT NOT NULL,
      event_type VARCHAR(255) NOT NULL,
      guests INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL,
      notes TEXT NOT NULL,
      total_cents INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(191) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

    -- Short-lived, single-use magic-link tokens emailed to a guest. Consuming
    -- one deletes it (deletion IS the "used" marker) and creates a
    -- guest_sessions row below — guests never get a users row/password.
    CREATE TABLE IF NOT EXISTS guest_login_tokens (
      token VARCHAR(191) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL
    );

    -- The resulting signed-in session after a magic link is verified — same
    -- shape/lifetime as sessions above, keyed by email instead of user_id.
    CREATE TABLE IF NOT EXISTS guest_sessions (
      token VARCHAR(191) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      client_id VARCHAR(191) NOT NULL,
      name VARCHAR(255) NOT NULL,
      rating INT NOT NULL,
      comment TEXT NOT NULL,
      hidden TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ref VARCHAR(191) NOT NULL UNIQUE,
      client_id VARCHAR(191) NOT NULL,
      club_id VARCHAR(191) NOT NULL,
      team VARCHAR(255) NOT NULL,
      child_first VARCHAR(255) NOT NULL,
      child_last VARCHAR(255) NOT NULL,
      dob VARCHAR(20) NOT NULL,
      g_first VARCHAR(255) NOT NULL,
      g_last VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL,
      address VARCHAR(500) NOT NULL,
      ec_name VARCHAR(255) NOT NULL,
      ec_phone VARCHAR(255) NOT NULL,
      ec_rel VARCHAR(255) NOT NULL,
      medical TEXT NOT NULL,
      consent TINYINT NOT NULL,
      trial TINYINT NOT NULL,
      total_cents INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      recipient_id VARCHAR(191) NOT NULL,
      kind VARCHAR(20) NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      ref VARCHAR(191) NOT NULL,
      \`read\` TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS room_blocks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      centre_id VARCHAR(191) NOT NULL,
      room_id VARCHAR(191),
      date VARCHAR(20) NOT NULL,
      time VARCHAR(20),
      reason VARCHAR(500) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(191) NOT NULL UNIQUE,
      kind VARCHAR(20) NOT NULL,
      amount INT NOT NULL,
      max_uses INT,
      used_count INT NOT NULL DEFAULT 0,
      expires_at DATETIME,
      active TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- A vendor's request to take ownership of a listing that was seeded/added
    -- with no owning vendor (centres.vendor_id / clubs.vendor_id IS NULL).
    -- Approving one sets vendor_id on the listing itself, separate from the
    -- listing's own moderation status (that's publication, this is ownership).
    CREATE TABLE IF NOT EXISTS listing_claims (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      vendor_id VARCHAR(191) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME
    );

    -- Resident identity (MVP). Created the first time a guest verifies a
    -- magic link (see guestAuth.ts) — deliberately separate from 'users'
    -- (vendor/admin accounts): residents never get a password, same
    -- passwordless model guest_sessions already uses. Anonymous X-Client-Id
    -- checkout keeps working unchanged — this is additive identity, not a
    -- login wall.
    CREATE TABLE IF NOT EXISTS residents (
      id VARCHAR(191) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL DEFAULT '',
      home_county VARCHAR(255) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Household members (MVP) a resident registers/books on behalf of.
    CREATE TABLE IF NOT EXISTS household_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      resident_id VARCHAR(191) NOT NULL,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      dob VARCHAR(20) NOT NULL DEFAULT '',
      notes TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Server-side favourites (MVP) for a signed-in resident. Signed-out
    -- guests keep the existing client/src/favorites.ts localStorage-only
    -- behaviour unchanged.
    CREATE TABLE IF NOT EXISTS favourites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      resident_id VARCHAR(191) NOT NULL,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_favourite (resident_id, listing_type, listing_id)
    );

    -- FIFO waitlist (MVP) for a full club (see clubs.capacity below) or a
    -- full game (see games below).
    CREATE TABLE IF NOT EXISTS waitlist_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191),
      client_id VARCHAR(191) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'waiting',
      offer_expires_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- "Join a Game" (MVP) — a lightweight joinable activity, deliberately
    -- independent of bookings/registrations and (in v1) of Stripe/pricing.ts.
    CREATE TABLE IF NOT EXISTS games (
      id VARCHAR(191) PRIMARY KEY,
      host_resident_id VARCHAR(191) NOT NULL,
      activity_label VARCHAR(255) NOT NULL,
      centre_id VARCHAR(191),
      location_text VARCHAR(500) NOT NULL DEFAULT '',
      date VARCHAR(20) NOT NULL,
      time VARCHAR(20) NOT NULL,
      skill_level VARCHAR(50) NOT NULL DEFAULT '',
      capacity INT NOT NULL,
      price_cents INT,
      visibility VARCHAR(20) NOT NULL DEFAULT 'public',
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- payment_status/stripe_session_id/ref (NEXT — paid Join-a-Game) mirror
    -- the bookings/registrations pattern: a free/cash game inserts straight
    -- in as 'joined'/'paid' — a priced game inserts as 'pending_payment' and
    -- only flips once the Stripe webhook confirms it (see routes/games.ts,
    -- routes/stripeWebhook.ts). 'status' counts toward capacity for both
    -- 'joined' and 'pending_payment' so a spot isn't oversold mid-checkout.
    CREATE TABLE IF NOT EXISTS game_participants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_id VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191) NOT NULL,
      ref VARCHAR(191) UNIQUE,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'joined',
      payment_status VARCHAR(20) NOT NULL DEFAULT 'paid',
      stripe_session_id VARCHAR(255),
      UNIQUE KEY uniq_participant (game_id, resident_id)
    );

    -- Recurring per-session schedule for a club (NEXT phase) — turns the
    -- flat "register" action into a real session with its own capacity.
    -- Not yet wired into registrations.ts checkout (see CLAUDE.md-style note
    -- in routes/clubSessions.ts) — v1 of this table is read/manage only.
    CREATE TABLE IF NOT EXISTS club_sessions (
      id VARCHAR(191) PRIMARY KEY,
      club_id VARCHAR(191) NOT NULL,
      day_of_week INT NOT NULL,
      time VARCHAR(20) NOT NULL,
      capacity INT,
      label VARCHAR(255) NOT NULL DEFAULT '',
      active TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Circles (NEXT) — a persistent group anchored to recurring
    -- participation, not a generic social feed.
    CREATE TABLE IF NOT EXISTS circles (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      activity_label VARCHAR(255) NOT NULL DEFAULT '',
      area VARCHAR(255) NOT NULL DEFAULT '',
      county VARCHAR(255) NOT NULL DEFAULT '',
      about TEXT NOT NULL,
      centre_id VARCHAR(191),
      created_by_resident_id VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS circle_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      circle_id VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'member',
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_circle_member (circle_id, resident_id)
    );

    -- Participation Chat (implementation plan Phase 11) — polling-based, not
    -- WebSocket (no real-time infra exists anywhere else in this stack, and
    -- current traffic doesn't justify adding an always-on connection layer;
    -- see routes/chat.ts). scope_type is 'game' (temporary, opens 24h before
    -- the game and archives some hours after — see routes/chat.ts's
    -- CHAT_OPENS_BEFORE_MS/CHAT_ARCHIVES_AFTER_MS) or 'circle' (persistent,
    -- no window). scope_id is the game/circle id. Membership (who can
    -- read/post) is derived from game_participants/circle_members at
    -- request time, not duplicated onto this table.
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      scope_type VARCHAR(20) NOT NULL,
      scope_id VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191) NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_chat_scope (scope_type, scope_id, id)
    );

    -- Credit-pack passes (NEXT) — a resident buys N credits up front,
    -- redeemable against a club/game instead of paying per-booking.
    CREATE TABLE IF NOT EXISTS passes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ref VARCHAR(191) UNIQUE,
      resident_id VARCHAR(191) NOT NULL,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      credits_total INT NOT NULL,
      credits_used INT NOT NULL DEFAULT 0,
      purchased_cents INT NOT NULL,
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      stripe_session_id VARCHAR(255),
      expires_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Logged zero/low-result searches (NEXT — demand intelligence),
    -- aggregated into a signal shown to vendors/admins.
    CREATE TABLE IF NOT EXISTS search_misses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      query_text VARCHAR(500) NOT NULL,
      listing_type VARCHAR(20) NOT NULL DEFAULT '',
      county VARCHAR(255) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Targeted vendor -> participant messages (NEXT), distinct from the
    -- automatic booking/registration notifications in notifications.ts.
    CREATE TABLE IF NOT EXISTS vendor_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendor_id VARCHAR(191) NOT NULL,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Multi-tenant org hierarchy scaffolding (FUTURE, best-effort). A real
    -- multi-org deployment would scope centres/clubs under one of these via
    -- their new nullable org_id column below — every existing listing has
    -- org_id NULL and behaves exactly as before — this is data-model only,
    -- not tenant isolation (see plan doc "Not yet" section).
    CREATE TABLE IF NOT EXISTS organisations (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      kind VARCHAR(50) NOT NULL DEFAULT 'council',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Manual/staff attendance check-in (FUTURE, best-effort) against a paid
    -- booking or registration ref. No hardware/QR-scanning integration —
    -- staff look up the ref and mark it, see routes/vendor.ts check-in route.
    -- Also reused for per-session Program attendance (Phase B) with
    -- kind='program_session' and ref = "<sessionId>:<enrollmentId>".
    CREATE TABLE IF NOT EXISTS attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kind VARCHAR(20) NOT NULL,
      ref VARCHAR(191) NOT NULL UNIQUE,
      checked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checked_in_by VARCHAR(191)
    );

    -- Password reset (Phase A) — vendor/admin only, residents are
    -- passwordless. Same single-use/expiry shape as guest_login_tokens.
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      expires_at DATETIME NOT NULL
    );

    -- Post-activity feedback (Phase A) — a light "would you do this again"
    -- prompt, not a 5-star review request every time.
    CREATE TABLE IF NOT EXISTS activity_feedback (
      id INT AUTO_INCREMENT PRIMARY KEY,
      kind VARCHAR(20) NOT NULL,
      ref VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191),
      client_id VARCHAR(191) NOT NULL,
      response VARCHAR(20) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_feedback (kind, ref, client_id)
    );

    -- Programs (Phase B — Gate 1 from the plan doc). A generalised
    -- multi-session activity — deliberately NOT a migration of centre-hire
    -- or club-registration, which keep working exactly as they do today.
    -- This is the seed a real Activity/Session model grows from, applied to
    -- new activity types only, decided this way on purpose (see plan doc
    -- "decisions" section: don't touch working payment code for a
    -- data-model purity goal).
    CREATE TABLE IF NOT EXISTS programs (
      id VARCHAR(191) PRIMARY KEY,
      listing_type VARCHAR(20) NOT NULL,
      listing_id VARCHAR(191) NOT NULL,
      vendor_id VARCHAR(191) NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      age_range VARCHAR(100) NOT NULL DEFAULT '',
      image_url VARCHAR(500) NOT NULL DEFAULT '',
      price_cents INT NOT NULL DEFAULT 0,
      capacity INT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- A concrete date/time instance of a program — this is the "session"
    -- half of the Activity/Session model the plan doc calls Gate 1.
    CREATE TABLE IF NOT EXISTS program_sessions (
      id VARCHAR(191) PRIMARY KEY,
      program_id VARCHAR(191) NOT NULL,
      date VARCHAR(20) NOT NULL,
      time VARCHAR(20) NOT NULL,
      duration_minutes INT NOT NULL DEFAULT 60,
      capacity INT,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- One registration covers every session of a program (matches "8-week
    -- program, one sign-up" from the spec) rather than per-session booking.
    CREATE TABLE IF NOT EXISTS program_enrollments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ref VARCHAR(191) UNIQUE,
      program_id VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191),
      client_id VARCHAR(191) NOT NULL,
      participant_name VARCHAR(255) NOT NULL,
      participant_dob VARCHAR(20) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL DEFAULT '',
      total_cents INT NOT NULL DEFAULT 0,
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      stripe_session_id VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Experiences & Adventures (implementation plan, added post-IA-spec-audit)
    -- — a real, standalone third listing type alongside centres/clubs, not a
    -- sub-type of either: an adventure/experience has its own location
    -- (area/county/meeting point), not a room inside a centre. 'kind'
    -- distinguishes the two ('adventure' gets the fuller
    -- difficulty/itinerary/equipment/transport/weather field set; 'experience'
    -- is the lighter sibling — same table, most of those fields just stay
    -- empty). Existing vendor accounts create these (no new "operator"
    -- account type) — same vendor_id/org ownership model as centres/clubs.
    CREATE TABLE IF NOT EXISTS experiences (
      id VARCHAR(191) PRIMARY KEY,
      vendor_id VARCHAR(191) NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'experience',
      title VARCHAR(255) NOT NULL,
      area VARCHAR(255) NOT NULL DEFAULT '',
      county VARCHAR(255) NOT NULL DEFAULT '',
      lat DECIMAL(9,6),
      lng DECIMAL(9,6),
      meeting_point VARCHAR(500) NOT NULL DEFAULT '',
      blurb TEXT NOT NULL,
      description TEXT NOT NULL,
      difficulty VARCHAR(20) NOT NULL DEFAULT '',
      duration_minutes INT NOT NULL DEFAULT 120,
      fitness_requirements TEXT NOT NULL,
      itinerary TEXT NOT NULL,
      equipment_provided TEXT NOT NULL,
      equipment_required TEXT NOT NULL,
      transport_info TEXT NOT NULL,
      safety_info TEXT NOT NULL,
      weather_policy TEXT NOT NULL,
      eligibility TEXT NOT NULL,
      cancellation_terms TEXT NOT NULL,
      price_cents INT NOT NULL DEFAULT 0,
      capacity INT NOT NULL DEFAULT 8,
      payment_method VARCHAR(20) NOT NULL DEFAULT 'online',
      image_url VARCHAR(500) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      views INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS experience_images (
      experience_id VARCHAR(191) NOT NULL,
      url VARCHAR(500) NOT NULL,
      sort_order INT NOT NULL
    );

    -- A bookable date/time instance (a specific departure) — mirrors
    -- program_sessions, but experience_bookings below books ONE session at a
    -- time (a single hike on a single day), not "enroll once, attend every
    -- session" the way a program enrollment does.
    CREATE TABLE IF NOT EXISTS experience_sessions (
      id VARCHAR(191) PRIMARY KEY,
      experience_id VARCHAR(191) NOT NULL,
      date VARCHAR(20) NOT NULL,
      time VARCHAR(20) NOT NULL,
      capacity INT,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Same subtotal/discount/vat/platform_fee/coupon/total shape as
    -- bookings/registrations/program_enrollments so this can go straight
    -- through the existing computePricing()/checkoutService.ts unchanged.
    -- party_size (not present on those other tables) is real here — an
    -- adventure booking is commonly "2 spots on Saturday's hike," not
    -- always a single participant.
    CREATE TABLE IF NOT EXISTS experience_bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ref VARCHAR(191) UNIQUE,
      experience_id VARCHAR(191) NOT NULL,
      session_id VARCHAR(191) NOT NULL,
      client_id VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191),
      participant_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL DEFAULT '',
      party_size INT NOT NULL DEFAULT 1,
      subtotal_cents INT NOT NULL DEFAULT 0,
      discount_cents INT NOT NULL DEFAULT 0,
      vat_cents INT NOT NULL DEFAULT 0,
      platform_fee_cents INT NOT NULL DEFAULT 0,
      coupon_code VARCHAR(191),
      total_cents INT NOT NULL DEFAULT 0,
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      stripe_session_id VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Per-day opening hours (Phase B) — supersedes a centre's single
    -- opens_at/closes_at window when rows exist for it, falling back to
    -- that single window when a centre has none, so every existing centre
    -- keeps behaving exactly as before.
    CREATE TABLE IF NOT EXISTS centre_hours (
      id INT AUTO_INCREMENT PRIMARY KEY,
      centre_id VARCHAR(191) NOT NULL,
      day_of_week INT NOT NULL,
      opens_at VARCHAR(10) NOT NULL DEFAULT '09:00',
      closes_at VARCHAR(10) NOT NULL DEFAULT '21:00',
      closed TINYINT NOT NULL DEFAULT 0,
      UNIQUE KEY uniq_centre_day (centre_id, day_of_week)
    );

    -- Staff invitations (Phase C — Gate 2), same single-use-token shape as
    -- guest_login_tokens. Accepting one creates a normal users row with
    -- role='vendor' and the invited platform_role, linked via org_id.
    CREATE TABLE IF NOT EXISTS org_invites (
      token VARCHAR(191) PRIMARY KEY,
      org_id VARCHAR(191) NOT NULL,
      email VARCHAR(255) NOT NULL,
      platform_role VARCHAR(30) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

    -- Configurable per-org policy (Phase C) — today's hard-coded 48h
    -- cancellation cutoff becomes this table's default value, so nothing
    -- changes for any org until it explicitly sets its own row.
    CREATE TABLE IF NOT EXISTS org_policies (
      org_id VARCHAR(191) PRIMARY KEY,
      cancellation_hours INT NOT NULL DEFAULT 48,
      booking_window_days INT NOT NULL DEFAULT 90
    );

    -- Feature flags (Phase D, best-effort) per organisation.
    CREATE TABLE IF NOT EXISTS feature_flags (
      org_id VARCHAR(191) NOT NULL,
      flag_key VARCHAR(50) NOT NULL,
      enabled TINYINT NOT NULL DEFAULT 1,
      PRIMARY KEY (org_id, flag_key)
    );

    -- Moderation reports (Phase D, best-effort) — the only user-generated
    -- surfaces today are Circles and reviews (reviews already had their own
    -- hide/unhide path — this generalises reporting itself).
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      target_type VARCHAR(20) NOT NULL,
      target_id VARCHAR(191) NOT NULL,
      reporter_client_id VARCHAR(191) NOT NULL,
      reason TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Platform-wide audit log (Phase D, best-effort) — written to going
    -- forward from admin/platform-admin routes. Nothing is backfilled for
    -- actions taken before this existed.
    CREATE TABLE IF NOT EXISTS audit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      actor_user_id VARCHAR(191),
      action VARCHAR(100) NOT NULL,
      object_type VARCHAR(50) NOT NULL,
      object_id VARCHAR(191) NOT NULL,
      previous_value TEXT,
      new_value TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  async function ensureColumn(table: string, column: string, ddl: string) {
    const cols = (await db
      .prepare(`SELECT COLUMN_NAME as name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`)
      .all(table)) as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }

  // Migration for databases created before image_url existed.
  await ensureColumn("centres", "image_url", "image_url VARCHAR(500) NOT NULL DEFAULT ''");
  await ensureColumn("clubs", "image_url", "image_url VARCHAR(500) NOT NULL DEFAULT ''");

  // Vendor ownership + moderation status. Existing seeded rows have no vendor
  // (vendor_id NULL) and are grandfathered in as already-approved.
  await ensureColumn("centres", "vendor_id", "vendor_id VARCHAR(191)");
  await ensureColumn("centres", "status", "status VARCHAR(20) NOT NULL DEFAULT 'approved'");
  await ensureColumn("clubs", "vendor_id", "vendor_id VARCHAR(191)");
  await ensureColumn("clubs", "status", "status VARCHAR(20) NOT NULL DEFAULT 'approved'");

  // Vendor-facing stats: page views (incremented on each public detail fetch)
  // and a listing date.
  await ensureColumn("centres", "views", "views INT NOT NULL DEFAULT 0");
  await ensureColumn("centres", "created_at", "created_at DATETIME NULL");
  await ensureColumn("clubs", "views", "views INT NOT NULL DEFAULT 0");
  await ensureColumn("clubs", "created_at", "created_at DATETIME NULL");

  // Vendor-set opening hours — bookings can only start within [opens_at, closes_at).
  // Defaults match the original fixed 09:00-20:00 slot list exactly, so existing
  // centres behave the same as before this existed.
  await ensureColumn("centres", "opens_at", "opens_at VARCHAR(10) NOT NULL DEFAULT '09:00'");
  await ensureColumn("centres", "closes_at", "closes_at VARCHAR(10) NOT NULL DEFAULT '21:00'");
  await db.exec(`
    UPDATE centres SET created_at = NOW() WHERE created_at IS NULL;
    UPDATE clubs SET created_at = NOW() WHERE created_at IS NULL;
  `);

  // Vendor registration profile: what kind of venue they run (chosen once,
  // at signup) plus the business details admin reviews before approving.
  // Nullable/empty for admin accounts and any vendor rows created before
  // this existed.
  await ensureColumn("users", "vendor_type", "vendor_type VARCHAR(20)");
  await ensureColumn("users", "business_name", "business_name VARCHAR(255) NOT NULL DEFAULT ''");
  await ensureColumn("users", "address", "address VARCHAR(500) NOT NULL DEFAULT ''");
  await ensureColumn("users", "county", "county VARCHAR(255) NOT NULL DEFAULT ''");
  await ensureColumn("users", "mobile", "mobile VARCHAR(255) NOT NULL DEFAULT ''");
  await ensureColumn("users", "landline", "landline VARCHAR(255) NOT NULL DEFAULT ''");
  await ensureColumn("users", "description", "description TEXT NULL");
  await db.exec(`UPDATE users SET description = '' WHERE description IS NULL`);

  // Backfill: vendors who signed up before draft-listing-at-signup existed
  // (or before vendor_type/county did) have a profile but no listing row.
  // Give each such vendor exactly one draft listing built from their stored
  // profile, matching what a fresh signup now creates — idempotent, since it
  // only fires while the vendor still has zero listings of their type.
  const vendorsNeedingDraft = (await db
    .prepare(
      `SELECT id, vendor_type, business_name, address, county, mobile, description
       FROM users WHERE role = 'vendor' AND vendor_type IS NOT NULL AND business_name != ''`
    )
    .all()) as { id: string; vendor_type: string; business_name: string; address: string; county: string; mobile: string; description: string }[];
  for (const v of vendorsNeedingDraft) {
    if (v.vendor_type === "community") {
      const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM centres WHERE vendor_id = ?`).get(v.id)) as { n: number };
      if (n === 0) {
        await db
          .prepare(
            `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at)
             VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, '', ?, ?, 'pending', NOW())`
          )
          .run(crypto.randomUUID(), v.business_name, v.address, v.county, v.business_name, v.mobile, v.description, v.id);
      }
    } else if (v.vendor_type === "sports") {
      const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM clubs WHERE vendor_id = ?`).get(v.id)) as { n: number };
      if (n === 0) {
        await db
          .prepare(
            `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at)
             VALUES (?, ?, '', ?, ?, '', 0, 'year', 0, ?, '', ?, ?, 'pending', NOW())`
          )
          .run(crypto.randomUUID(), v.business_name, v.address, v.county, v.mobile, v.description, v.id);
      }
    }
  }

  // Cash-vs-online payment choice: rooms are per-room (booking is per-room),
  // clubs are per-club (registration has no sub-resource). When 'cash', the
  // booking/registration checkout skips Stripe and confirms immediately.
  await ensureColumn("rooms", "payment_method", "payment_method VARCHAR(20) NOT NULL DEFAULT 'online'");
  await ensureColumn("clubs", "payment_method", "payment_method VARCHAR(20) NOT NULL DEFAULT 'online'");
  await ensureColumn("centres", "payment_method", "payment_method VARCHAR(20) NOT NULL DEFAULT 'online'");

  // Every centre must have at least one bookable room — a centre with zero
  // rooms (e.g. from data predating this table, or a partial signup) can't
  // ever be booked. This is a one-time, idempotent safety backfill, not a
  // collapse: unlike the old migration this replaced, it never merges or
  // deletes existing rooms, so a centre with multiple rooms keeps all of them.
  const centresForRoomBackfill = (await db.prepare(`SELECT id, capacity, from_price, payment_method FROM centres`).all()) as {
    id: string;
    capacity: number;
    from_price: number;
    payment_method: string;
  }[];
  for (const c of centresForRoomBackfill) {
    const roomCount = (await db.prepare(`SELECT COUNT(*) as n FROM rooms WHERE centre_id = ?`).get(c.id)) as { n: number };
    if (roomCount.n === 0) {
      await db
        .prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method) VALUES (?, ?, 'Main Room', ?, ?, '', 0, ?)`)
        .run(crypto.randomUUID(), c.id, c.capacity, c.from_price, c.payment_method);
    }
  }

  // Soft-delete flag for rooms (same pattern as club_sessions.active) — a
  // "removed" room is deactivated, never hard-deleted, so historical
  // bookings.room_id references stay valid.
  await ensureColumn("rooms", "active", "active TINYINT NOT NULL DEFAULT 1");

  // Vendor-controlled "open for bookings" switch — when closed, the venue
  // stays visible/approved but families can't start a new booking.
  await ensureColumn("centres", "is_open", "is_open TINYINT NOT NULL DEFAULT 1");

  // Optional map link (e.g. a Google Maps URL) vendors can add for their venue.
  await ensureColumn("centres", "map_url", "map_url VARCHAR(500) NOT NULL DEFAULT ''");
  await ensureColumn("clubs", "map_url", "map_url VARCHAR(500) NOT NULL DEFAULT ''");

  // Pricing breakdown + payment tracking. total_cents (pre-existing) remains
  // the final charged amount; these break it down and track the Stripe side.
  // Bookings/registrations start 'pending' and only flip to 'paid' once the
  // Stripe webhook confirms the charge — never on the client's say-so.
  for (const table of ["bookings", "registrations"]) {
    await ensureColumn(table, "subtotal_cents", "subtotal_cents INT NOT NULL DEFAULT 0");
    await ensureColumn(table, "discount_cents", "discount_cents INT NOT NULL DEFAULT 0");
    await ensureColumn(table, "vat_cents", "vat_cents INT NOT NULL DEFAULT 0");
    await ensureColumn(table, "platform_fee_cents", "platform_fee_cents INT NOT NULL DEFAULT 0");
    await ensureColumn(table, "coupon_code", "coupon_code VARCHAR(191)");
    await ensureColumn(table, "payment_status", "payment_status VARCHAR(20) NOT NULL DEFAULT 'pending'");
    await ensureColumn(table, "stripe_session_id", "stripe_session_id VARCHAR(255)");
  }
  // Backfill: rows created before payment tracking existed were confirmed
  // on submit (the old flow) — treat them as already paid.
  await db.exec(`
    UPDATE bookings SET payment_status = 'paid' WHERE payment_status = 'pending' AND stripe_session_id IS NULL;
    UPDATE registrations SET payment_status = 'paid' WHERE payment_status = 'pending' AND stripe_session_id IS NULL;
  `);

  // Guest-facing cancellation. Deliberately separate from payment_status
  // (which tracks the Stripe payment lifecycle: pending/paid/failed) so
  // cancelling can never race with or be overwritten by a webhook confirming
  // payment — this is a distinct booking-lifecycle flag.
  await ensureColumn("bookings", "status", "status VARCHAR(20) NOT NULL DEFAULT 'confirmed'");
  await ensureColumn("registrations", "status", "status VARCHAR(20) NOT NULL DEFAULT 'confirmed'");

  // Resident linkage (MVP) — populated only when the guest was signed in at
  // checkout; client_id remains the primary scoping key, this is additive.
  await ensureColumn("bookings", "resident_id", "resident_id VARCHAR(191)");
  await ensureColumn("registrations", "resident_id", "resident_id VARCHAR(191)");

  // A notification may now target a resident directly (MVP), not only a
  // vendor/admin — same polymorphic shape, just a second nullable recipient
  // column rather than overloading recipient_id across two identity spaces.
  await ensureColumn("notifications", "resident_id", "resident_id VARCHAR(191)");

  // Club capacity (MVP) — nullable = unlimited, matching every existing
  // club's current (uncapped) behaviour exactly. Only once this is set does
  // "full" / "join the waitlist" mean anything for a club.
  await ensureColumn("clubs", "capacity", "capacity INT");

  // Org scoping (FUTURE, best-effort) — nullable, unused by any query today;
  // see organisations table above.
  await ensureColumn("centres", "org_id", "org_id VARCHAR(191)");
  await ensureColumn("clubs", "org_id", "org_id VARCHAR(191)");

  // Lightweight RBAC scaffolding (FUTURE, best-effort) — an additional,
  // optional named role layered on top of the existing role='vendor'|'admin'
  // (e.g. 'centre_manager', 'finance', 'read_only_analyst'), checked by the
  // new requirePlatformRole() guard in auth.ts. Existing requireVendor /
  // requireAdmin / requireVendorOrAdmin are completely unchanged.
  await ensureColumn("users", "platform_role", "platform_role VARCHAR(30)");

  // Marketplace provider-tier scaffolding (FUTURE, best-effort) — a data
  // field only; no commercial/billing logic is attached to it.
  await ensureColumn("users", "provider_tier", "provider_tier VARCHAR(20) NOT NULL DEFAULT 'standard'");

  // Safeguarding scaffolding (FUTURE, best-effort) — records which waiver
  // text version a guardian agreed to alongside the existing `consent` flag.
  // Not a substitute for legal review of the waiver text itself.
  await ensureColumn("registrations", "waiver_version", "waiver_version VARCHAR(20) NOT NULL DEFAULT ''");

  // Optional link to a specific recurring session (Tier 1 UI pass) — wires
  // club_sessions into the actual registration checkout instead of leaving
  // it read/manage-only. NULL means "no specific session" (a club with no
  // sessions configured behaves exactly as before).
  await ensureColumn("registrations", "session_id", "session_id VARCHAR(191)");

  // Pass redemption (Tier 2) — set when this registration was paid for by
  // spending a credit-pack pass instead of a normal charge. NULL for every
  // registration that pays/registers the ordinary way.
  await ensureColumn("registrations", "pass_id", "pass_id INT");

  // Resident onboarding + preferences (Phase A). Signal-only for now — see
  // plan doc: "store the signal, wire it into recommendations later, don't
  // block on personalization existing yet". interests/availability are
  // comma-joined plain text, not JSON, to avoid a JSON column type
  // dependency for what's currently just a stored list.
  await ensureColumn("residents", "interests", "interests TEXT");
  await ensureColumn("residents", "availability", "availability TEXT");
  await ensureColumn("residents", "onboarding_completed", "onboarding_completed TINYINT NOT NULL DEFAULT 0");
  await ensureColumn("residents", "notification_prefs", "notification_prefs TEXT");
  await ensureColumn("residents", "accessibility_prefs", "accessibility_prefs TEXT");
  await ensureColumn("residents", "search_radius_km", "search_radius_km INT NOT NULL DEFAULT 10");

  // "Host" trust tier (IA spec five-layer audit) — a resident who's applied
  // to be a verified community host, distinct from the vendor/admin roles
  // in auth.ts. Deliberately an attribute of the existing residents row,
  // not a new identity system or table (see CLAUDE.md's existing
  // three-identity-system note) — badge-only for v1, never gates hosting a
  // Game/Circle (see games.ts/circles.ts).
  await ensureColumn("residents", "host_status", "host_status VARCHAR(20) NOT NULL DEFAULT 'none'");
  // TEXT can't carry a DEFAULT in MySQL (ER_BLOB_CANT_HAVE_DEFAULT) — nullable,
  // same convention as interests/availability above; application code treats
  // NULL as empty (see residents.ts's GET /me).
  await ensureColumn("residents", "host_bio", "host_bio TEXT");
  await ensureColumn("residents", "host_phone", "host_phone VARCHAR(255) NOT NULL DEFAULT ''");
  await ensureColumn("residents", "host_applied_at", "host_applied_at DATETIME");
  await ensureColumn("residents", "host_decided_at", "host_decided_at DATETIME");

  // Organisation linkage (Phase C — Gate 2). Every existing vendor is
  // backfilled with their own 1:1 organisation below so nothing about the
  // current one-login-per-vendor model breaks — org_id is additive.
  await ensureColumn("users", "org_id", "org_id VARCHAR(191)");

  // Distinguishes the org owner (the vendor who signed up — unrestricted,
  // same access they've always had) from staff added later via an invite
  // (restricted to their assigned platform_role). Every existing vendor
  // defaults to 0 = owner, preserving today's behaviour exactly.
  await ensureColumn("users", "invited_staff", "invited_staff TINYINT NOT NULL DEFAULT 0");

  const vendorsNeedingOrg = (await db
    .prepare(`SELECT id, business_name FROM users WHERE role = 'vendor' AND org_id IS NULL`)
    .all()) as { id: string; business_name: string }[];
  for (const v of vendorsNeedingOrg) {
    const orgId = crypto.randomUUID();
    await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, ?, 'vendor')`).run(orgId, v.business_name || "My organisation");
    await db.prepare(`UPDATE users SET org_id = ? WHERE id = ?`).run(orgId, v.id);
  }

  // Map discovery view (Phase E, best-effort) — there's no real geocoding
  // integration, so lat/lng are approximated from a static county-centroid
  // table plus a small deterministic offset (hashed from the listing id, so
  // it's stable across restarts and multiple listings in the same county
  // don't stack on one marker). Good enough to plot pins on a map; not
  // accurate enough for turn-by-turn directions.
  await ensureColumn("centres", "lat", "lat DECIMAL(9,6)");
  await ensureColumn("centres", "lng", "lng DECIMAL(9,6)");
  await ensureColumn("clubs", "lat", "lat DECIMAL(9,6)");
  await ensureColumn("clubs", "lng", "lng DECIMAL(9,6)");
  for (const table of ["centres", "clubs"] as const) {
    const rows = (await db.prepare(`SELECT id, county FROM ${table} WHERE lat IS NULL`).all()) as { id: string; county: string }[];
    for (const row of rows) {
      const { lat, lng } = approximateCoords(row.county, row.id);
      await db.prepare(`UPDATE ${table} SET lat = ?, lng = ? WHERE id = ?`).run(lat, lng, row.id);
    }
  }

  // A real contact number for the listing itself — distinct from `ph`
  // (a decorative CSS placeholder pattern shown behind a photo before it
  // loads, not a phone field — was being misread as one in the admin UI
  // until this session) and distinct from the vendor account's own
  // mobile/landline, which was never surfaced to the public.
  await ensureColumn("centres", "phone", "phone VARCHAR(255) NOT NULL DEFAULT ''");
  await ensureColumn("clubs", "phone", "phone VARCHAR(255) NOT NULL DEFAULT ''");

  // Structured accessibility features, kept separate from the general
  // amenities/includes free-text bag so it can be filtered on directly
  // (see routes/centres.ts, routes/clubs.ts) rather than just displayed as
  // one more bullet point. Comma-joined TEXT, same tradeoff already made
  // for residents.interests etc. — avoids a JSON column type dependency for
  // what's currently just a stored, filterable list.
  // MySQL TEXT columns can't carry a DEFAULT — left nullable instead, same
  // as residents.interests/.accessibility_prefs above; reader code treats
  // NULL the same as '' (both mean "no accessibility info yet").
  await ensureColumn("centres", "accessibility", "accessibility TEXT");
  await ensureColumn("clubs", "accessibility", "accessibility TEXT");

  // Phase 3 first slice: a lightweight, fixed activity-category tag (see
  // client/src/constants.ts's ACTIVITY_CATEGORIES) — deliberately not a new
  // taxonomy table, just a loosely-validated string alongside the existing
  // free-text clubs.sport/programs.title, which stay as-is.
  await ensureColumn("clubs", "category", "category VARCHAR(50) NOT NULL DEFAULT ''");
  await ensureColumn("programs", "category", "category VARCHAR(50) NOT NULL DEFAULT ''");
  await ensureColumn("programs", "skill_level", "skill_level VARCHAR(30) NOT NULL DEFAULT ''");
  // TEXT column, nullable (no DEFAULT — see the accessibility columns above
  // for why); comma-joined list, same convention as accessibility/amenities.
  await ensureColumn("programs", "equipment", "equipment TEXT");
  await ensureColumn("programs", "instructor_name", "instructor_name VARCHAR(255) NOT NULL DEFAULT ''");
  // Session-level instructor overrides the program/club's own instructor
  // when set; empty string means "use the parent's instructor".
  await ensureColumn("program_sessions", "instructor_name", "instructor_name VARCHAR(255) NOT NULL DEFAULT ''");
  // Purely descriptive — which of the centre's rooms this session happens
  // in. Not wired into room availability/booking conflict checks; a
  // program session and a paid room booking are still separate concepts.
  await ensureColumn("program_sessions", "room_id", "room_id VARCHAR(191)");
  await ensureColumn("club_sessions", "instructor_name", "instructor_name VARCHAR(255) NOT NULL DEFAULT ''");

  // Neither games nor club_sessions had a photo at all — the homepage
  // discovery feed (routes/discover.ts) needs one to render a real card
  // background instead of always falling back to a placeholder. No
  // create/edit UI sets these yet (out of scope for that feed's first
  // pass) — same additive-ahead-of-the-write-path pattern as several other
  // columns in this file.
  await ensureColumn("games", "image_url", "image_url VARCHAR(500) NOT NULL DEFAULT ''");
  await ensureColumn("club_sessions", "image_url", "image_url VARCHAR(500) NOT NULL DEFAULT ''");

  // programs.status grows from a two-state active/archived model to a real
  // draft/published/paused/archived lifecycle — one-time, idempotent
  // backfill of every existing 'active' row (after this, 'active' is
  // retired; the app only ever reads/writes the four new values).
  await db.prepare(`UPDATE programs SET status = 'published' WHERE status = 'active'`).run();

  // attendance grows from "row exists = checked in" to a real status —
  // Present/Absent/Late/Cancelled/No-show for Program session attendance
  // (vendorPrograms.ts). Every existing row (all from the booking/
  // registration front-door check-in flow in vendorOperations.ts, which
  // stays binary — a tapped "Check in" always means present) backfills to
  // 'present', preserving its current meaning exactly.
  await ensureColumn("attendance", "status", "status VARCHAR(20) NOT NULL DEFAULT 'present'");

  // Solo-friendly (implementation plan Phase 2) — an explicit signal that a
  // game welcomes someone who doesn't already have a partner/group, set by
  // the host at creation time. Games only for now (the clearest fit —
  // "come alone" concern maps directly onto a pickup game); programs/club
  // sessions can grow this later if it proves useful there too.
  await ensureColumn("games", "solo_friendly", "solo_friendly TINYINT NOT NULL DEFAULT 0");

  // Open Booking (implementation plan Phase 3) — a private room booking can
  // optionally open some of its spots to other residents. open_spots is
  // NULL for a normal private booking (the default, unchanged behavior);
  // a number means "once confirmed, create a joinable Game for this many
  // additional spots." games.booking_ref links the resulting Game back to
  // its source booking (by ref, matching how bookings are addressed
  // everywhere else in this codebase, not by the internal auto-increment
  // id) so its date/time/venue are traceable to one authoritative booking
  // rather than duplicated. See bookings.ts's createGameFromOpenBooking.
  await ensureColumn("bookings", "open_spots", "open_spots INT");
  await ensureColumn("games", "booking_ref", "booking_ref VARCHAR(191)");

  // Minimum Participation Booking (implementation plan Phase 4) — a game
  // can require N participants before it's confirmed. Scoped to games only
  // (not a new facility-hold/reservation system): a threshold game starts
  // 'pending_participants' instead of 'open', stays joinable and paid the
  // exact same way any other game is, and flips to 'open' the moment
  // joined count reaches min_participants (see games.ts's join handler).
  // If a game never reaches its threshold, cancelling and refunding
  // whoever already joined is handled off-platform, same convention as
  // every other cancellation in this app.
  await ensureColumn("games", "min_participants", "min_participants INT");

  // Interest → Participation states (implementation plan Phase 6) — a
  // favourite is no longer just saved-or-not. 'interested' is the default
  // (what every existing row backfills to); 'planning' is a resident
  // manually signalling stronger intent; 'joined' is set automatically the
  // moment a real booking/registration/game-join confirms for that exact
  // listing (see favourites.ts's upgradeFavouriteStatus, called from
  // bookings.ts/registrations.ts/games.ts/stripeWebhook.ts's confirm paths)
  // — never downgraded automatically, since "I did this" shouldn't quietly
  // revert.
  await ensureColumn("favourites", "status", "status VARCHAR(20) NOT NULL DEFAULT 'interested'");

  // Make It Happen (implementation plan Phase 10) — reuses Open Booking's
  // open_spots/games.booking_ref mechanism (a Make It Happen request IS an
  // Open Booking started from a blank search instead of an existing
  // reservation), but additionally requires the FULL requested group before
  // the activity is "viable": min_participants mirrors open_spots exactly
  // (not a partial threshold) and is read by createGameFromOpenBooking()
  // to set the resulting game's own min_participants (Phase 4 machinery,
  // unchanged) — the linked game starts 'pending_participants' instead of
  // 'open' until every requested spot is filled. NULL for a plain Open
  // Booking (Phase 3), which keeps starting 'open' immediately as before.
  await ensureColumn("bookings", "min_participants", "min_participants INT");
}

export const COUNTY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  antrim: { lat: 54.72, lng: -6.2 },
  armagh: { lat: 54.35, lng: -6.65 },
  carlow: { lat: 52.71, lng: -6.93 },
  cavan: { lat: 53.99, lng: -7.36 },
  clare: { lat: 52.85, lng: -8.98 },
  cork: { lat: 51.9, lng: -8.47 },
  derry: { lat: 54.99, lng: -7.31 },
  donegal: { lat: 54.87, lng: -8.11 },
  down: { lat: 54.33, lng: -5.71 },
  dublin: { lat: 53.35, lng: -6.26 },
  fermanagh: { lat: 54.35, lng: -7.64 },
  galway: { lat: 53.27, lng: -9.05 },
  kerry: { lat: 52.15, lng: -9.57 },
  kildare: { lat: 53.16, lng: -6.91 },
  kilkenny: { lat: 52.65, lng: -7.25 },
  laois: { lat: 53.03, lng: -7.33 },
  leitrim: { lat: 54.13, lng: -8.0 },
  limerick: { lat: 52.66, lng: -8.63 },
  longford: { lat: 53.73, lng: -7.79 },
  louth: { lat: 53.92, lng: -6.45 },
  mayo: { lat: 53.85, lng: -9.3 },
  meath: { lat: 53.6, lng: -6.66 },
  monaghan: { lat: 54.25, lng: -6.97 },
  offaly: { lat: 53.27, lng: -7.49 },
  roscommon: { lat: 53.76, lng: -8.19 },
  sligo: { lat: 54.27, lng: -8.47 },
  tipperary: { lat: 52.67, lng: -7.83 },
  tyrone: { lat: 54.6, lng: -7.31 },
  waterford: { lat: 52.26, lng: -7.11 },
  westmeath: { lat: 53.53, lng: -7.35 },
  wexford: { lat: 52.42, lng: -6.47 },
  wicklow: { lat: 52.98, lng: -6.37 },
};

export function approximateCoords(county: string, seedId: string): { lat: number; lng: number } {
  const centroid = COUNTY_CENTROIDS[county.trim().toLowerCase()] ?? COUNTY_CENTROIDS.dublin;
  let hash = 0;
  for (let i = 0; i < seedId.length; i++) hash = (hash * 31 + seedId.charCodeAt(i)) >>> 0;
  // Two pseudo-random offsets in [-0.06, 0.06) degrees (~±6km) from the hash's low/high bits.
  const offsetLat = (((hash & 0xffff) / 0xffff) - 0.5) * 0.12;
  const offsetLng = ((((hash >>> 16) & 0xffff) / 0xffff) - 0.5) * 0.12;
  return { lat: centroid.lat + offsetLat, lng: centroid.lng + offsetLng };
}
