import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, "..", "..", "hello-circle.sqlite");

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS centres (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    county TEXT NOT NULL,
    rating REAL NOT NULL,
    reviews INTEGER NOT NULL,
    capacity INTEGER NOT NULL,
    from_price INTEGER NOT NULL,
    managed_by TEXT NOT NULL,
    ph TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    blurb TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS centre_amenities (
    centre_id TEXT NOT NULL REFERENCES centres(id),
    amenity TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS centre_images (
    centre_id TEXT NOT NULL REFERENCES centres(id),
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT NOT NULL,
    centre_id TEXT NOT NULL REFERENCES centres(id),
    name TEXT NOT NULL,
    cap INTEGER NOT NULL,
    rate INTEGER NOT NULL,
    desc TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (centre_id, id)
  );

  CREATE TABLE IF NOT EXISTS clubs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sport TEXT NOT NULL,
    area TEXT NOT NULL,
    county TEXT NOT NULL,
    ages TEXT NOT NULL,
    price INTEGER NOT NULL,
    unit TEXT NOT NULL,
    trial INTEGER NOT NULL,
    ph TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    blurb TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS club_includes (
    club_id TEXT NOT NULL REFERENCES clubs(id),
    item TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS club_images (
    club_id TEXT NOT NULL REFERENCES clubs(id),
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    centre_id TEXT NOT NULL REFERENCES centres(id),
    room_id TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    duration INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    guests INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    total_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('vendor', 'admin')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'suspended')),
    name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('centre', 'club')),
    listing_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    club_id TEXT NOT NULL REFERENCES clubs(id),
    team TEXT NOT NULL,
    child_first TEXT NOT NULL,
    child_last TEXT NOT NULL,
    dob TEXT NOT NULL,
    g_first TEXT NOT NULL,
    g_last TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    ec_name TEXT NOT NULL,
    ec_phone TEXT NOT NULL,
    ec_rel TEXT NOT NULL,
    medical TEXT NOT NULL DEFAULT '',
    consent INTEGER NOT NULL,
    trial INTEGER NOT NULL,
    total_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('booking', 'registration')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    listing_type TEXT NOT NULL CHECK (listing_type IN ('centre', 'club')),
    listing_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A vendor-controlled closure: either a specific room+slot (room_id + time
  -- both set), a whole room for a whole day (room_id set, time NULL), or the
  -- entire centre for a day (room_id NULL, time NULL) — e.g. a festival
  -- closure. Never both centre-wide AND time-specific (a single time only
  -- makes sense for a single room).
  CREATE TABLE IF NOT EXISTS room_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    centre_id TEXT NOT NULL REFERENCES centres(id),
    room_id TEXT,
    date TEXT NOT NULL,
    time TEXT,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Platform-wide, admin-managed discount codes.
  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
    amount INTEGER NOT NULL,
    max_uses INTEGER,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration for databases created before image_url existed.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("centres", "image_url", "image_url TEXT NOT NULL DEFAULT ''");
ensureColumn("clubs", "image_url", "image_url TEXT NOT NULL DEFAULT ''");

// Vendor ownership + moderation status. Existing seeded rows have no vendor
// (vendor_id NULL) and are grandfathered in as already-approved.
ensureColumn("centres", "vendor_id", "vendor_id TEXT");
ensureColumn("centres", "status", "status TEXT NOT NULL DEFAULT 'approved'");
ensureColumn("clubs", "vendor_id", "vendor_id TEXT");
ensureColumn("clubs", "status", "status TEXT NOT NULL DEFAULT 'approved'");

// Vendor-facing stats: page views (incremented on each public detail fetch)
// and a listing date. SQLite's ADD COLUMN only allows a constant default, so
// non-constant ones (datetime('now'), CURRENT_TIMESTAMP) aren't accepted here
// — add with an empty default, then backfill.
ensureColumn("centres", "views", "views INTEGER NOT NULL DEFAULT 0");
ensureColumn("centres", "created_at", "created_at TEXT NOT NULL DEFAULT ''");
ensureColumn("clubs", "views", "views INTEGER NOT NULL DEFAULT 0");
ensureColumn("clubs", "created_at", "created_at TEXT NOT NULL DEFAULT ''");

// Vendor-set opening hours — bookings can only start within [opens_at, closes_at).
// Defaults match the original fixed 09:00-20:00 slot list exactly, so existing
// centres behave the same as before this existed.
ensureColumn("centres", "opens_at", "opens_at TEXT NOT NULL DEFAULT '09:00'");
ensureColumn("centres", "closes_at", "closes_at TEXT NOT NULL DEFAULT '21:00'");
db.exec(`
  UPDATE centres SET created_at = datetime('now') WHERE created_at = '';
  UPDATE clubs SET created_at = datetime('now') WHERE created_at = '';
`);

// Vendor registration profile: what kind of venue they run (chosen once,
// at signup) plus the business details admin reviews before approving.
// Nullable/empty for admin accounts and any vendor rows created before
// this existed.
ensureColumn("users", "vendor_type", "vendor_type TEXT");
ensureColumn("users", "business_name", "business_name TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "address", "address TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "county", "county TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "mobile", "mobile TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "landline", "landline TEXT NOT NULL DEFAULT ''");
ensureColumn("users", "description", "description TEXT NOT NULL DEFAULT ''");

// Backfill: vendors who signed up before draft-listing-at-signup existed
// (or before vendor_type/county did) have a profile but no listing row.
// Give each such vendor exactly one draft listing built from their stored
// profile, matching what a fresh signup now creates — idempotent, since it
// only fires while the vendor still has zero listings of their type.
const vendorsNeedingDraft = db
  .prepare(
    `SELECT id, vendor_type, business_name, address, county, mobile, description
     FROM users WHERE role = 'vendor' AND vendor_type IS NOT NULL AND business_name != ''`
  )
  .all() as { id: string; vendor_type: string; business_name: string; address: string; county: string; mobile: string; description: string }[];
for (const v of vendorsNeedingDraft) {
  if (v.vendor_type === "community") {
    const { n } = db.prepare(`SELECT COUNT(*) as n FROM centres WHERE vendor_id = ?`).get(v.id) as { n: number };
    if (n === 0) {
      db.prepare(
        `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, '', ?, ?, 'pending', datetime('now'))`
      ).run(crypto.randomUUID(), v.business_name, v.address, v.county, v.business_name, v.mobile, v.description, v.id);
    }
  } else if (v.vendor_type === "sports") {
    const { n } = db.prepare(`SELECT COUNT(*) as n FROM clubs WHERE vendor_id = ?`).get(v.id) as { n: number };
    if (n === 0) {
      db.prepare(
        `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status, created_at)
         VALUES (?, ?, '', ?, ?, '', 0, 'year', 0, ?, '', ?, ?, 'pending', datetime('now'))`
      ).run(crypto.randomUUID(), v.business_name, v.address, v.county, v.mobile, v.description, v.id);
    }
  }
}

// Cash-vs-online payment choice: rooms are per-room (booking is per-room),
// clubs are per-club (registration has no sub-resource). When 'cash', the
// booking/registration checkout skips Stripe and confirms immediately.
ensureColumn("rooms", "payment_method", "payment_method TEXT NOT NULL DEFAULT 'online'");
ensureColumn("clubs", "payment_method", "payment_method TEXT NOT NULL DEFAULT 'online'");
ensureColumn("centres", "payment_method", "payment_method TEXT NOT NULL DEFAULT 'online'");

// "Rooms" is now a pure internal implementation detail — bookings and
// availability stay keyed by room_id (unchanged), but vendors no longer add
// multiple rooms; a centre's own capacity/from_price/payment_method are the
// single source of truth, kept in sync with its one room on every save (see
// vendor.ts). One-time backfill to collapse every centre down to exactly one
// room — idempotent, since afterward every centre already has exactly one.
const centresForRoomCollapse = db.prepare(`SELECT id, capacity, from_price, payment_method FROM centres`).all() as {
  id: string;
  capacity: number;
  from_price: number;
  payment_method: string;
}[];
for (const c of centresForRoomCollapse) {
  const rooms = db.prepare(`SELECT id FROM rooms WHERE centre_id = ? ORDER BY sort_order`).all(c.id) as { id: string }[];
  if (rooms.length === 0) {
    db.prepare(
      `INSERT INTO rooms (id, centre_id, name, cap, rate, desc, sort_order, payment_method) VALUES (?, ?, '', ?, ?, '', 0, ?)`
    ).run(crypto.randomUUID(), c.id, c.capacity, c.from_price, c.payment_method);
  } else if (rooms.length > 1) {
    const keepId = rooms[0].id;
    for (const { id: otherId } of rooms.slice(1)) {
      db.prepare(`UPDATE bookings SET room_id = ? WHERE centre_id = ? AND room_id = ?`).run(keepId, c.id, otherId);
      db.prepare(`UPDATE room_blocks SET room_id = ? WHERE centre_id = ? AND room_id = ?`).run(keepId, c.id, otherId);
      db.prepare(`DELETE FROM rooms WHERE centre_id = ? AND id = ?`).run(c.id, otherId);
    }
    db.prepare(`UPDATE rooms SET cap = ?, rate = ? WHERE centre_id = ? AND id = ?`).run(c.capacity, c.from_price, c.id, keepId);
  }
}

// Vendor-controlled "open for bookings" switch — when closed, the venue
// stays visible/approved but families can't start a new booking.
ensureColumn("centres", "is_open", "is_open INTEGER NOT NULL DEFAULT 1");

// Optional map link (e.g. a Google Maps URL) vendors can add for their venue.
ensureColumn("centres", "map_url", "map_url TEXT NOT NULL DEFAULT ''");
ensureColumn("clubs", "map_url", "map_url TEXT NOT NULL DEFAULT ''");

// Pricing breakdown + payment tracking. total_cents (pre-existing) remains
// the final charged amount; these break it down and track the Stripe side.
// Bookings/registrations start 'pending' and only flip to 'paid' once the
// Stripe webhook confirms the charge — never on the client's say-so.
for (const table of ["bookings", "registrations"]) {
  ensureColumn(table, "subtotal_cents", "subtotal_cents INTEGER NOT NULL DEFAULT 0");
  ensureColumn(table, "discount_cents", "discount_cents INTEGER NOT NULL DEFAULT 0");
  ensureColumn(table, "vat_cents", "vat_cents INTEGER NOT NULL DEFAULT 0");
  ensureColumn(table, "platform_fee_cents", "platform_fee_cents INTEGER NOT NULL DEFAULT 0");
  ensureColumn(table, "coupon_code", "coupon_code TEXT");
  ensureColumn(table, "payment_status", "payment_status TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(table, "stripe_session_id", "stripe_session_id TEXT");
}
// Backfill: rows created before payment tracking existed were confirmed
// on submit (the old flow) — treat them as already paid.
db.exec(`
  UPDATE bookings SET payment_status = 'paid' WHERE payment_status = 'pending' AND stripe_session_id IS NULL;
  UPDATE registrations SET payment_status = 'paid' WHERE payment_status = 'pending' AND stripe_session_id IS NULL;
`);
