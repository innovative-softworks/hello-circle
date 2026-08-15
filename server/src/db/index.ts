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
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
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

  // "Rooms" is now a pure internal implementation detail — bookings and
  // availability stay keyed by room_id (unchanged), but vendors no longer add
  // multiple rooms; a centre's own capacity/from_price/payment_method are the
  // single source of truth, kept in sync with its one room on every save (see
  // vendor.ts). One-time backfill to collapse every centre down to exactly one
  // room — idempotent, since afterward every centre already has exactly one.
  const centresForRoomCollapse = (await db.prepare(`SELECT id, capacity, from_price, payment_method FROM centres`).all()) as {
    id: string;
    capacity: number;
    from_price: number;
    payment_method: string;
  }[];
  for (const c of centresForRoomCollapse) {
    const rooms = (await db.prepare(`SELECT id FROM rooms WHERE centre_id = ? ORDER BY sort_order`).all(c.id)) as { id: string }[];
    if (rooms.length === 0) {
      await db
        .prepare(`INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order, payment_method) VALUES (?, ?, '', ?, ?, '', 0, ?)`)
        .run(crypto.randomUUID(), c.id, c.capacity, c.from_price, c.payment_method);
    } else if (rooms.length > 1) {
      const keepId = rooms[0].id;
      for (const { id: otherId } of rooms.slice(1)) {
        await db.prepare(`UPDATE bookings SET room_id = ? WHERE centre_id = ? AND room_id = ?`).run(keepId, c.id, otherId);
        await db.prepare(`UPDATE room_blocks SET room_id = ? WHERE centre_id = ? AND room_id = ?`).run(keepId, c.id, otherId);
        await db.prepare(`DELETE FROM rooms WHERE centre_id = ? AND id = ?`).run(c.id, otherId);
      }
      await db.prepare(`UPDATE rooms SET cap = ?, rate = ? WHERE centre_id = ? AND id = ?`).run(c.capacity, c.from_price, c.id, keepId);
    }
  }

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
}
