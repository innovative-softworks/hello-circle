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
  // CLIENT_FOUND_ROWS: without this, MySQL's affectedRows on an UPDATE counts
  // only rows whose VALUE actually changed, not rows matched by the WHERE
  // clause — the opposite of better-sqlite3's `.changes`, which this shim is
  // built to mimic (see RunResult below). Without this flag, a no-op update
  // (e.g. re-approving an already-approved vendor) reports changes: 0 and
  // every `if (info.changes === 0) return 404` call site wrongly 404s.
  flags: ["FOUND_ROWS"],
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

/** Same undefined->null guarantee as normalizeParams, for the named-`@field`
 * object-argument form — every current named-param call site already guards
 * each field with `?? null`, so this was latent rather than triggered, but
 * without it the shim's documented "undefined is always normalized" contract
 * only actually held for positional params. */
function normalizeNamedParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) out[k] = v === undefined ? null : v;
  return out;
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
        ? await conn.execute(sql.replace(/@(\w+)/g, ":$1"), normalizeNamedParams(params[0] as Record<string, unknown>) as any)
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

    -- Resident "forgot password" recovery (My Life auth redesign) — same
    -- shape as password_reset_tokens below, keyed by email like
    -- guest_login_tokens instead of a user id, since a resident may not
    -- have a password set yet when this is requested. One deletes it on
    -- use (see routes/guestAuth.ts's reset-password), same as every other
    -- single-use token table in this schema.
    CREATE TABLE IF NOT EXISTS resident_password_reset_tokens (
      token VARCHAR(191) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
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

    -- Native push (Capacitor migration Phase 5) — one row per installed
    -- device, keyed by the FCM registration token itself (not resident_id)
    -- since the same device can sign out and back in as a different
    -- resident; UNIQUE on token plus INSERT..ON DUPLICATE KEY UPDATE in
    -- routes/residents.ts's POST /me/push-token repoints an existing
    -- device's row at whoever's currently signed in, rather than
    -- accumulating stale rows for one device. See push.ts for the actual
    -- send step, hooked into notifyResident() in notifications.ts.
    CREATE TABLE IF NOT EXISTS device_push_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      resident_id VARCHAR(191) NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      platform VARCHAR(16) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Minimal first-party, aggregate-only event log (post-audit hardening
    -- pass) — the app had zero analytics/event tracking anywhere, by
    -- explicit privacy-first design (see CookieNotice.tsx/CookiePolicy.tsx's
    -- "no analytics, no tracking" copy). This does NOT contradict that
    -- commitment: no third-party tracker, no per-viewer fingerprinting
    -- beyond the resident/client id the rest of the app already uses for
    -- ownership — it exists so the funnel (search -> intent -> match ->
    -- join -> attend -> repeat) can be measured at all before a pilot.
    -- Both id columns nullable since a given event may only have one (e.g.
    -- a server-side "attended" flip may have only a resident id).
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      resident_id VARCHAR(191),
      client_id VARCHAR(191),
      metadata TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_analytics_events_type (event_type, created_at)
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

    -- Follow (Follow feature) — "keep me in the loop" on a vendor Provider
    -- or a resident Host, deliberately separate from favourites above:
    -- favourites are per-*listing* with an interested/planning/joined
    -- lifecycle; a follow is a standing relationship with an account
    -- (vendor or host) and its own per-relationship notification_level,
    -- not a listing-status progression. Requires a real resident_id (no
    -- guest/localStorage fallback, unlike favourites) since a follow with
    -- no persistent identity to notify is meaningless.
    CREATE TABLE IF NOT EXISTS follows (
      id INT AUTO_INCREMENT PRIMARY KEY,
      resident_id VARCHAR(191) NOT NULL,
      followed_type VARCHAR(20) NOT NULL,
      followed_id VARCHAR(191) NOT NULL,
      notification_level VARCHAR(20) NOT NULL DEFAULT 'highlights',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_follow (resident_id, followed_type, followed_id)
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

    -- Explicit unmet-demand capture ("I want to do X, nothing matches yet")
    -- — deliberately separate from search_misses (passive, anonymous
    -- query-text logging with no resident linkage or matching). id is an
    -- app-generated UUID (see routes/participationIntents.ts), not
    -- AUTO_INCREMENT, since a resident needs to reference/cancel a specific
    -- row by id. resident_id nullable + client_id NOT NULL mirrors
    -- waitlist_entries' anonymous-capable shape, not favourites' resident-only
    -- one, since most search traffic is pre-signup. notes has no DEFAULT —
    -- MySQL rejects DEFAULT on TEXT (ER_BLOB_CANT_HAVE_DEFAULT). No expired
    -- status sweep — every read filters expires_at > NOW() directly.
    CREATE TABLE IF NOT EXISTS participation_intents (
      id VARCHAR(191) PRIMARY KEY,
      resident_id VARCHAR(191),
      client_id VARCHAR(191) NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL DEFAULT '',
      activity_label VARCHAR(255) NOT NULL,
      county VARCHAR(255) NOT NULL DEFAULT '',
      preferred_date VARCHAR(20) NOT NULL DEFAULT '',
      preferred_time_window VARCHAR(50) NOT NULL DEFAULT '',
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      UNIQUE KEY uniq_intent (client_id, activity_label, county),
      KEY idx_cluster (activity_label, county, status)
    );

    -- Idempotency guard so a burst of near-simultaneous intent submissions
    -- can't fire the "enough people are interested" notification more than
    -- once per activity+county (see participationIntents.ts). A row here
    -- means that cluster has already been notified once — v1 never re-fires
    -- even if the cluster later shrinks and regrows past the threshold.
    CREATE TABLE IF NOT EXISTS intent_cluster_notifications (
      activity_label VARCHAR(255) NOT NULL,
      county VARCHAR(255) NOT NULL DEFAULT '',
      notified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (activity_label, county)
    );

    -- Referral attribution (participation-intent plan Phase 3) — deliberately
    -- read-side only, no checkout code touched. 'share' rows log who created
    -- a share link (InviteButton.tsx); 'land' rows log who arrived carrying
    -- a ?ref= param, resolved from the same referrer_client_id column (on a
    -- share row it's the sharer's own client_id; on a land row it's whatever
    -- opaque ?ref= token the visitor arrived with — same "who initiated
    -- this" column, populated by two different code paths). Admin's
    -- estimated-attribution view (routes/admin.ts) joins land rows to real
    -- transactions by matching visitor_client_id within a time window —
    -- never a hard foreign key, since that's inherently a best-effort guess.
    CREATE TABLE IF NOT EXISTS referrals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event VARCHAR(10) NOT NULL,
      source VARCHAR(50) NOT NULL DEFAULT '',
      referrer_resident_id VARCHAR(191),
      referrer_client_id VARCHAR(191) NOT NULL DEFAULT '',
      listing_type VARCHAR(20) NOT NULL DEFAULT '',
      listing_id VARCHAR(191) NOT NULL DEFAULT '',
      visitor_client_id VARCHAR(191) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_visitor (visitor_client_id, created_at)
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

    -- Host-posted announcements for a Game (Game Detail redesign — "Latest
    -- update" module). Deliberately its own small log table rather than
    -- reusing notifications (which is a per-recipient inbox row, not a
    -- shared per-listing timeline) — every joined participant sees the same
    -- ordered list of updates for a game, plus each post still fans out one
    -- notifications row per participant the same way cancellation does.
    CREATE TABLE IF NOT EXISTS game_updates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_id VARCHAR(191) NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

    -- Circle Invitations (IA spec §10) — a distinct invite-then-accept path
    -- alongside the existing instant self-serve POST /:id/join (kept
    -- unchanged — Circles stay publicly joinable). An organiser (role in
    -- circle_members) invites a specific resident; the invite sits
    -- 'pending' until the invitee accepts (which also inserts the
    -- circle_members row) or declines.
    CREATE TABLE IF NOT EXISTS circle_invites (
      id VARCHAR(191) PRIMARY KEY,
      circle_id VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191) NOT NULL,
      invited_by_resident_id VARCHAR(191) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_circle_invite (circle_id, resident_id)
    );

    -- Circle planning / availability poll (IA spec §10) — members propose
    -- date/time options, others vote for every option they're available
    -- for (not single-choice — a real availability poll needs multi-select).
    -- The "recommended option" the spec wants is derived client-side from
    -- vote counts, not stored.
    CREATE TABLE IF NOT EXISTS circle_polls (
      id VARCHAR(191) PRIMARY KEY,
      circle_id VARCHAR(191) NOT NULL,
      question VARCHAR(255) NOT NULL,
      created_by_resident_id VARCHAR(191) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS circle_poll_options (
      id INT AUTO_INCREMENT PRIMARY KEY,
      poll_id VARCHAR(191) NOT NULL,
      date VARCHAR(20) NOT NULL,
      time VARCHAR(20) NOT NULL DEFAULT '',
      sort_order INT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS circle_poll_votes (
      poll_id VARCHAR(191) NOT NULL,
      option_id INT NOT NULL,
      resident_id VARCHAR(191) NOT NULL,
      PRIMARY KEY (poll_id, option_id, resident_id)
    );

    -- Circle Plans / "plan-ideas" (Phase 2 "Circles V2") — a lightweight,
    -- explicit "what should this Circle do next" object a member proposes
    -- and an organiser can turn into a real Game, closing the Circle->Plan->
    -- Activity->Participate->Return loop. Deliberately NOT the same concept
    -- as the existing games.circle_id relationship (a plan-idea has no
    -- Activity yet) or the existing fuzzy activity-label match in
    -- nextPlanFor()/GET /:id/upcoming (this is a real, owned relationship) —
    -- see routes/circles.ts's own comments for how those two stay
    -- untouched. status: idea | confirmed | activity_created | cancelled
    -- ('completed' is a derived display value computed from the linked
    -- Game's date, never stored — no background job to flip it).
    -- activity_source_type/activity_source_id are deliberately polymorphic
    -- (matching ActivitySummary's sourceType/sourceId, Phase 1) even though
    -- only 'game' is ever written today, so a future non-Game conversion
    -- target doesn't need another schema change.
    CREATE TABLE IF NOT EXISTS circle_plans (
      id VARCHAR(191) PRIMARY KEY,
      circle_id VARCHAR(191) NOT NULL,
      created_by_resident_id VARCHAR(191) NOT NULL,
      title VARCHAR(255) NOT NULL,
      note TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'idea',
      proposed_date VARCHAR(20) NOT NULL DEFAULT '',
      proposed_time VARCHAR(20) NOT NULL DEFAULT '',
      location_text VARCHAR(500) NOT NULL DEFAULT '',
      activity_source_type VARCHAR(20),
      activity_source_id VARCHAR(191),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME,
      cancelled_at DATETIME
    );

    -- Routines-as-an-object (IA spec §9) — the single most-named gap across
    -- every audit this project has run. Circles-from-repetition
    -- (getCircleSuggestions above) already detects "you keep showing up
    -- with the same people"; this is the personal counterpart — "you keep
    -- showing up on the same day," regardless of who else is there — and,
    -- unlike a Circle suggestion, actually materializes into an object a
    -- resident can see/pause/edit/cancel (see getRoutineSuggestions() in
    -- queries.ts and routes/residents.ts's routine endpoints). A routine is
    -- a personal planning aid, never an automatic booking — matches the
    -- spec's own explicit instruction for this screen.
    CREATE TABLE IF NOT EXISTS routines (
      id VARCHAR(191) PRIMARY KEY,
      resident_id VARCHAR(191) NOT NULL,
      activity_label VARCHAR(255) NOT NULL,
      centre_id VARCHAR(191),
      day_of_week INT NOT NULL,
      time VARCHAR(20) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

    -- Market/category launch config (participation-intent plan Phase 4) —
    -- same enabled-by-default/missing-row-means-on convention as
    -- feature_flags above, scoped by county instead of org_id. category
    -- values are INTEREST_OPTIONS (client/src/types.ts), reused rather than
    -- inventing a new taxonomy — this app has no other category enum
    -- anywhere (activity_label on games/circles/intents is free text).
    CREATE TABLE IF NOT EXISTS market_categories (
      county VARCHAR(255) NOT NULL,
      category VARCHAR(100) NOT NULL,
      enabled TINYINT NOT NULL DEFAULT 1,
      PRIMARY KEY (county, category)
    );

    -- Admin-editable notification templates (implementation backlog #2).
    -- Deliberately an override layer, not the source of truth: every real
    -- call site (notifications.ts) already has a hardcoded fallback
    -- subject/title/body, and only consults a row here if one exists for
    -- that template_key — an empty table (the default, on every existing
    -- install) means zero behavior change. All 3 *_template columns are
    -- nullable TEXT with no DEFAULT (MySQL TEXT+DEFAULT gotcha, see
    -- CLAUDE.md) since a given template_key only ever uses a subset (an
    -- in-app title has no subject; an email has no title).
    CREATE TABLE IF NOT EXISTS notification_templates (
      template_key VARCHAR(100) PRIMARY KEY,
      description VARCHAR(500) NOT NULL DEFAULT '',
      subject_template TEXT,
      title_template TEXT,
      body_template TEXT,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

    -- Resident safety centre (IA spec §13) — a resident's own blocked-users
    -- list. Deliberately app-level-enforced-nowhere-yet (no chat/join
    -- filtering reads this table in this pass) — it's the storage +
    -- visibility half of the spec's ask; wiring it into Circle
    -- chat/game-join visibility is a real, separate follow-up.
    CREATE TABLE IF NOT EXISTS blocked_residents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      blocker_resident_id VARCHAR(191) NOT NULL,
      blocked_resident_id VARCHAR(191) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_block (blocker_resident_id, blocked_resident_id)
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
    );

    -- HelloCircle Manage — links a vendor account to the resident (magic-link)
    -- account of the same person, so one browser session can hold both a
    -- vendor and a resident cookie and switch between them without signing
    -- out (routes/manage.ts). Single-use, short-lived, keyed by the vendor
    -- user id like resident_password_reset_tokens is keyed by email — same
    -- "one deletes it on use" convention as every other token table here.
    CREATE TABLE IF NOT EXISTS manage_link_tokens (
      token VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      resident_email VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL
    );

    -- Universal Sharing & Invitation system (Phase 2) — a polymorphic,
    -- person-to-person invite, distinct from circle_invites (which is
    -- specifically circle *membership*, has its own accept-inserts-a-member
    -- transaction, and stays untouched). This is for "I want you specifically
    -- to come to this Game/Experience/Program" — accepting here never
    -- auto-joins the entity (a priced Game/Experience/Program needs its own
    -- capacity/payment flow), it only flips status and notifies the inviter;
    -- the invitee still hits the entity's own Join button same as anyone
    -- else. invitee_resident_id is set for an invite to a known resident;
    -- invitee_email + token are set for an invite to someone with no
    -- account yet (emailed a /i/:token link) — exactly one of the two is
    -- populated per row. A token is also generated for known-resident
    -- invites (uniformly, so the same /i/:token landing page + "not
    -- signed in yet" path both work regardless of which case it is).
    CREATE TABLE IF NOT EXISTS invitations (
      id VARCHAR(191) PRIMARY KEY,
      token VARCHAR(191) NOT NULL,
      entity_type VARCHAR(20) NOT NULL,
      entity_id VARCHAR(191) NOT NULL,
      inviter_resident_id VARCHAR(191) NOT NULL,
      invitee_resident_id VARCHAR(191),
      invitee_email VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME,
      expires_at DATETIME NOT NULL,
      UNIQUE KEY uniq_invitation_token (token),
      UNIQUE KEY uniq_invitation_invitee (entity_type, entity_id, invitee_resident_id),
      UNIQUE KEY uniq_invitation_invitee_email (entity_type, entity_id, invitee_email),
      KEY idx_invitee_resident (invitee_resident_id, status)
    );

    -- Referral/share/invite funnel (Universal Sharing system) — one row per
    -- meaningful share/invite lifecycle event, read by the admin funnel
    -- rollup (routes/admin.ts) via analytics_events.event_type. No new
    -- table needed: analytics_events (see analytics.ts) already stores an
    -- arbitrary event_type + resident_id/client_id + JSON metadata, which is
    -- exactly the shape share_opened/share_channel_selected/invite_accepted/
    -- etc. need — see AnalyticsEventType in analytics.ts for the actual
    -- event vocabulary.
  `);

  async function ensureColumn(table: string, column: string, ddl: string) {
    const cols = (await db
      .prepare(`SELECT COLUMN_NAME as name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`)
      .all(table)) as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      try {
        await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      } catch (e) {
        // ER_DUP_FIELDNAME (1060): a rolling/multi-instance deploy can start
        // two processes against the same not-yet-migrated schema — both read
        // "column missing" before either's ALTER TABLE commits. Losing this
        // race isn't a real failure, another instance already added the
        // column — crashing this instance's boot over it would be wrong.
        if ((e as { code?: string }).code !== "ER_DUP_FIELDNAME") throw e;
      }
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
  // Vendor's own business logo (public provider profile hero) — nullable,
  // no DEFAULT: MySQL rejects a DEFAULT on TEXT/BLOB/JSON columns
  // (ER_BLOB_CANT_HAVE_DEFAULT), same fix already applied to host_bio.
  await ensureColumn("users", "logo", "logo TEXT NULL");
  await db.exec(`UPDATE users SET logo = '' WHERE logo IS NULL`);

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
  // Mobile onboarding redesign — an optional precise point (from geocoding a
  // searched address, or a GPS reading) alongside the existing home_county
  // string. Nullable: a resident who only ever picked a county from the
  // chip list (the original flow, still supported) has no coordinate at
  // all, and nothing downstream requires one — home_county remains the
  // single source of truth for county-scoped queries.
  await ensureColumn("residents", "home_lat", "home_lat DOUBLE NULL");
  await ensureColumn("residents", "home_lng", "home_lng DOUBLE NULL");

  // Optional password login (My Life redesign) — resident accounts remain
  // passwordless by default (magic-link only, same as always); this is an
  // opt-in second way in, not a replacement. NULL means "no password set
  // yet", not an unset/invalid state — every login path checks for that
  // explicitly rather than treating null as an empty-string password.
  await ensureColumn("residents", "password_hash", "password_hash VARCHAR(255) NULL");

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

  // Onboarding §2 (IA spec) — goals + participation-comfort steps. Same
  // signal-only convention as interests/availability above: stored, wired
  // into recommendations later, never required. `goals` is comma-joined
  // TEXT (no DEFAULT — see host_bio's comment on why); the comfort fields
  // are short enums stored as plain VARCHAR, not booleans, so a future
  // "any/no preference" state has somewhere to live besides NULL.
  await ensureColumn("residents", "goals", "goals TEXT");
  await ensureColumn("residents", "pref_group_size", "pref_group_size VARCHAR(20) NOT NULL DEFAULT ''");
  await ensureColumn("residents", "pref_beginner_friendly", "pref_beginner_friendly TINYINT NOT NULL DEFAULT 0");
  await ensureColumn("residents", "pref_solo_friendly", "pref_solo_friendly TINYINT NOT NULL DEFAULT 0");
  await ensureColumn("residents", "pref_budget", "pref_budget VARCHAR(20) NOT NULL DEFAULT ''");

  // Fuller post-activity feedback (IA spec §11) — activity_feedback's
  // `response` column already carries "would you do this again"; these are
  // the spec's other 4 structured questions, additive and all optional (a
  // resident can still answer just the original one, same convenience as
  // before). VARCHAR 'yes'/'maybe'/'no'/NULL, same shape as `response`.
  await ensureColumn("activity_feedback", "beginner_friendly", "beginner_friendly VARCHAR(20)");
  await ensureColumn("activity_feedback", "solo_friendly", "solo_friendly VARCHAR(20)");
  await ensureColumn("activity_feedback", "description_accurate", "description_accurate VARCHAR(20)");
  await ensureColumn("activity_feedback", "welcoming", "welcoming VARCHAR(20)");

  // Self-serve attendance confirmation + check-in (IA spec §11) — "did you
  // attend?" for a Game, resident-initiated (existing check-in machinery is
  // vendor-QR-scan-only, for bookings/registrations, not this). NULL =
  // unanswered; check-in is a separate, earlier signal (can check in
  // without yet confirming attendance after the fact).
  await ensureColumn("game_participants", "checked_in_at", "checked_in_at DATETIME");
  await ensureColumn("game_participants", "attended", "attended TINYINT");

  // Circle settings — "Close Circle" (IA spec §10). A closed circle drops
  // out of public browse (GET / filters status='active') but stays visible
  // to its own members (GET /:id and /mine don't filter) — same
  // soft-delete convention as every other status-based "remove" in this app.
  await ensureColumn("circles", "status", "status VARCHAR(20) NOT NULL DEFAULT 'active'");

  // Household guardian consent (IA spec §13) — a household member profile
  // itself has no consent concept today; the only consent/waiver in this
  // app lives on club registrations (registrations.consent), a different
  // table entirely. This is the household-level counterpart.
  await ensureColumn("household_members", "guardian_consent_given", "guardian_consent_given TINYINT NOT NULL DEFAULT 0");

  // Privacy: opt out of appearing in someone else's "familiar participants"
  // count (IA spec §13) — countFamiliarCoParticipants() reads this to
  // exclude the resident from other people's counts; it never removes
  // their own familiarCount, which is about who's familiar TO them.
  await ensureColumn("residents", "hide_from_familiar_count", "hide_from_familiar_count TINYINT NOT NULL DEFAULT 0");

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
  await backfillCentreClubCoords();

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
  // Community program detail (IA spec §5) — guardian rules/safeguarding
  // info, both optional free text a vendor can fill in for programs aimed
  // at children/dependants. Nullable TEXT, same convention as `equipment`.
  await ensureColumn("programs", "guardian_rules", "guardian_rules TEXT");
  await ensureColumn("programs", "safeguarding_info", "safeguarding_info TEXT");
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
  // Open game detail (IA spec §5) — an optional, display-only deadline by
  // which the min_participants threshold needs to be met. Purely
  // informational: this app has no scheduled-job infrastructure anywhere to
  // auto-cancel/notify once a deadline passes, so enforcing it is out of
  // scope for this pass — it's shown to participants, not acted on.
  await ensureColumn("games", "confirmation_deadline", "confirmation_deadline DATETIME");

  // Game Detail redesign — richer plan content a host can optionally fill
  // in at creation, matched to the Game Detail page's own new sections
  // ("About this plan", "What to bring", "Good to know", location privacy).
  // Every field is nullable/optional — an existing game (and the create-game
  // form left blank) simply omits the section it feeds, never shows a fake
  // value. TEXT columns deliberately carry no DEFAULT — see host_bio's own
  // comment earlier in this file (ER_BLOB_CANT_HAVE_DEFAULT; MySQL rejects
  // DEFAULT on TEXT/BLOB at ALTER TABLE time, not at typecheck).
  await ensureColumn("games", "description", "description TEXT");
  await ensureColumn("games", "duration_minutes", "duration_minutes INT");
  await ensureColumn("games", "equipment_needed", "equipment_needed TEXT");
  await ensureColumn("games", "min_age", "min_age INT");
  await ensureColumn("games", "surface_type", "surface_type VARCHAR(50) NOT NULL DEFAULT ''");
  await ensureColumn("games", "indoor_outdoor", "indoor_outdoor VARCHAR(20) NOT NULL DEFAULT ''");
  // Exact meeting instructions ("meet by the north gate, past the car
  // park") are only ever returned to the host or a joined participant (see
  // routes/games.ts's GET /:id) — a browsing, not-yet-joined visitor sees
  // the venue's public location only, matching the spec's own stated
  // privacy expectation for this field.
  await ensureColumn("games", "meeting_instructions", "meeting_instructions TEXT");
  await ensureColumn("games", "cancellation_policy", "cancellation_policy TEXT");
  // HelloCircle Manage Phase 4 — set only when a game is created as a specific
  // Circle's plan (via the "Create plan" deep-link), so a Circle's Manage >
  // Plans tab can filter accurately instead of the pre-existing loose
  // activity-label text match GET /circles/:id/upcoming still uses for its own,
  // deliberately different, "similar activity nearby" discovery purpose.
  await ensureColumn("games", "circle_id", "circle_id VARCHAR(191)");
  // Phase 2 "Circles V2" — set atomically (alongside circle_id, in the same
  // transaction as the game insert) when this game was created by
  // converting a confirmed circle_plans row, guarded by an idempotency
  // check on that row's status so two concurrent conversions can never
  // produce two games — see routes/games.ts's createGameRow().
  await ensureColumn("games", "plan_id", "plan_id VARCHAR(191)");
  // Phase 2 "Circles V2" — optionally links an existing circle_polls row to
  // a circle_plans row ("which day works?" attached to a specific plan-
  // idea). Nullable/optional: every pre-existing standalone poll
  // (plan_id IS NULL) keeps working completely unchanged.
  await ensureColumn("circle_polls", "plan_id", "plan_id VARCHAR(191)");

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
  // Open-booking setup (IA spec §6) — same display-only, never-enforced
  // convention as games.confirmation_deadline; passed through to the
  // resulting game by createGameFromOpenBooking() (see bookings.ts).
  await ensureColumn("bookings", "confirmation_deadline", "confirmation_deadline DATETIME");

  // Trust & Safety investigation notes (IA spec §16) — an admin's own
  // working notes on a report, separate from `status` (which drives the
  // queue). Nullable TEXT, no DEFAULT (see CLAUDE.md's MySQL TEXT+DEFAULT
  // gotcha).
  await ensureColumn("reports", "admin_notes", "admin_notes TEXT");

  // Bounded "featured" flag (IA spec §16) — replaces a full CMS with the
  // smallest thing that lets an admin promote a listing: one boolean,
  // sorted first in public listing/browse order. No scheduling, no
  // placement rules, no separate featured-content table.
  await ensureColumn("centres", "featured", "featured TINYINT NOT NULL DEFAULT 0");
  await ensureColumn("clubs", "featured", "featured TINYINT NOT NULL DEFAULT 0");
  await ensureColumn("experiences", "featured", "featured TINYINT NOT NULL DEFAULT 0");

  // Circle invite picker (implementation backlog #3) — opt-in, off by
  // default: this app has never had a resident directory, and the raw
  // Resident-ID field it replaces couldn't leak anyone's name/email to a
  // stranger by definition. A real search needs a real privacy model, not
  // just "search everyone" — GET /residents/search only ever matches
  // residents who've explicitly turned this on (see residents.ts), the
  // opposite polarity from hide_from_familiar_count (that one is opt-OUT
  // of something already visible; this is opt-IN to something that wasn't).
  await ensureColumn("residents", "discoverable_by_name", "discoverable_by_name TINYINT NOT NULL DEFAULT 0");

  // Payment-methods screen (implementation backlog #1) — the Stripe
  // Customer id behind a signed-in resident, created lazily on first
  // checkout (see checkoutService.ts's resolveStripeCustomer()), never
  // eagerly at signup. Nullable, no DEFAULT needed (plain VARCHAR).
  await ensureColumn("residents", "stripe_customer_id", "stripe_customer_id VARCHAR(255)");

  // Profile photo (Profile redesign follow-up) — an /uploads/<uuid>.<ext>
  // path from the same multer pipeline uploads.ts already uses for listing
  // images, just posted through a resident-scoped route instead of that
  // file's requireVendorOrAdmin one (see routes/residents.ts's own
  // "/me/avatar"). Nullable; Avatar (ui.tsx) falls back to initials when unset.
  await ensureColumn("residents", "avatar_url", "avatar_url VARCHAR(500) NULL");

  // Email-verified tracking (Profile redesign follow-up) — every magic-link
  // verify (guestAuth.ts's POST /verify) proves the resident controls this
  // inbox, so it stamps this the first time it succeeds for a given email;
  // password-only signup (POST /guest/signup) never does, since it never
  // requires opening an email at all. Nullable timestamp, not a boolean —
  // doubles as "when", not just "whether".
  await ensureColumn("residents", "email_verified_at", "email_verified_at DATETIME NULL");

  // Account deactivation (Profile redesign follow-up) — deliberately a soft
  // flag, not a DELETE. This app has no DB-level foreign keys anywhere (see
  // CLAUDE.md) and five separate, unreconciled participant tables plus real
  // Stripe payment/receipt records reference a resident's id — a hard
  // delete would either orphan rows across all of them or require an
  // audited cross-table cleanup this pass doesn't attempt. While set, the
  // resident is hidden from familiar-faces/discoverable-by-name (same
  // enforcement points as those two existing privacy flags) and excluded
  // from search — but nothing else changes, and there's deliberately no
  // separate "reactivate" flow to build: any successful sign-in (magic
  // link or password, see guestAuth.ts's createGuestSession()) clears it,
  // the same self-service pattern as Instagram/X's own "deactivate".
  await ensureColumn("residents", "deactivated_at", "deactivated_at DATETIME NULL");

  // Slugs (master-prompt punch list #1) — human-readable, shareable URLs
  // for the 4 listing types worth indexing (centres/clubs/experiences/
  // circles; Games are ephemeral one-offs and deliberately excluded).
  // Nullable — generated at create time and backfilled once for existing
  // rows (see slugify.ts's ensureSlugsBackfilled()). Uniqueness is enforced
  // at generation time (check-then-insert with a random suffix on
  // collision), not a DB constraint — this table set is demo-scale, a
  // formal UNIQUE index isn't worth the added migration complexity here.
  await ensureColumn("centres", "slug", "slug VARCHAR(255)");
  await ensureColumn("clubs", "slug", "slug VARCHAR(255)");
  await ensureColumn("experiences", "slug", "slug VARCHAR(255)");
  await ensureColumn("circles", "slug", "slug VARCHAR(255)");

  // Adventure trip metrics — optional, adventure-relevant fields (a pottery
  // "experience" has no meaningful distance/elevation, so the client only
  // renders these when set). Nullable, no DEFAULT on distance/elevation
  // (plain numeric types, not TEXT, so a DEFAULT would be legal — just
  // unnecessary, since "unset" should read as "not shown", not "0").
  // terrain_type is VARCHAR so DEFAULT '' is fine there (see host_status's
  // TEXT+DEFAULT note elsewhere in this file for why that distinction matters).
  await ensureColumn("experiences", "distance_km", "distance_km DECIMAL(6,2)");
  await ensureColumn("experiences", "elevation_gain_m", "elevation_gain_m INT");
  await ensureColumn("experiences", "terrain_type", "terrain_type VARCHAR(100) NOT NULL DEFAULT ''");

  // Host & Activity reviews (master-prompt punch list #3) — reviews.
  // listing_type was already a flexible VARCHAR(20) (centre/club only in
  // practice); no schema change needed there. Nothing to add here besides
  // this note — see routes/reviews.ts for the eligibility-logic extension.

  // Community-contributed places (master-prompt punch list #4) — a
  // resident-submitted venue, reviewed by admin, auto-published as a real
  // unclaimed listing on approval (same vendor_id-NULL pattern seed.ts
  // already uses for platform-curated venues).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS place_suggestions (
      id VARCHAR(191) PRIMARY KEY,
      client_id VARCHAR(191) NOT NULL,
      resident_id VARCHAR(191),
      suggested_name VARCHAR(255) NOT NULL,
      category VARCHAR(20) NOT NULL,
      area VARCHAR(255) NOT NULL DEFAULT '',
      county VARCHAR(255) NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      contact_info VARCHAR(500) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      published_listing_id VARCHAR(191),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME
    )
  `);

  // Saved-search alerts (master-prompt punch list #5) — trigger-based, not
  // cron (this app has no scheduled-job infrastructure anywhere, a
  // standing constraint — see waitlist.ts's own sweep-on-interval comment
  // for the one exception, which is a fixed in-process timer, not a real
  // job queue). Matching happens at the moment a new Game is created (see
  // games.ts's POST / ), not on a periodic scan.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS search_alerts (
      id VARCHAR(191) PRIMARY KEY,
      resident_id VARCHAR(191) NOT NULL,
      county VARCHAR(255) NOT NULL DEFAULT '',
      keywords VARCHAR(500),
      mood VARCHAR(20),
      active TINYINT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Pre-launch "coming soon" email capture (routes/launchSignups.ts) — named
  // launch_signups, deliberately distinct from waitlist_entries (a capacity
  // queue for a specific centre/club that's already live) even though both
  // are colloquially "a waitlist": this one exists before the product has
  // any bookable listings for the signer to queue against. email is the
  // natural key (re-submitting the same email updates name/county rather
  // than erroring or duplicating — see the route's ON DUPLICATE KEY UPDATE).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS launch_signups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL DEFAULT '',
      county VARCHAR(255) NOT NULL DEFAULT '',
      client_id VARCHAR(191),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Circles had no photo at all — every other listing type (centres, clubs,
  // experiences, games) has an image_url column; this brings Circles in
  // line so Home's circle cards can be as image-forward as everything else.
  await ensureColumn("circles", "image_url", "image_url VARCHAR(500) NOT NULL DEFAULT ''");

  // Circle Detail redesign — structured "About our community" content
  // (Mission/What we do/Who can join/Our values), each genuinely optional
  // and organiser-provided rather than derived from `about` — a Circle
  // that hasn't set these just omits that column on its detail page, same
  // "only render what's configured" convention every other optional field
  // in this file follows. TEXT columns carry no DEFAULT — see host_bio's
  // own comment above (ER_BLOB_CANT_HAVE_DEFAULT).
  await ensureColumn("circles", "what_we_do", "what_we_do TEXT");
  await ensureColumn("circles", "who_can_join", "who_can_join TEXT");
  // Named circle_values, not `values` — VALUES is a reserved SQL keyword
  // and better avoided as a bare column name even though MySQL would
  // technically accept it here.
  await ensureColumn("circles", "circle_values", "circle_values TEXT");

  // Referral attribution tightening (post-audit hardening pass) — captures
  // the *visitor's* own resident id at landing time, when they happen to
  // already be signed in. Deliberately distinct from referrer_resident_id
  // (which identifies the sharer, not the visitor) — see
  // getReferralAttribution()'s docstring for why the original client_id-only
  // join under-counted signed-in visitors who convert from a different
  // device/browser.
  await ensureColumn("referrals", "visitor_resident_id", "visitor_resident_id VARCHAR(191)");

  // Adult club registration — a club was previously always assumed to be a
  // kids' sports club (RegistrationFlow.tsx's whole form is written around a
  // minor: guardian, DOB, emergency contact). `audience` lets a vendor mark
  // their club as adult-facing so the registration form drops the
  // guardian/DOB framing; `registrant_type` records which shape a given
  // registration was actually submitted under, independent of the club's
  // current setting (a club can change `audience` later without meaning old
  // registrations are misclassified). Defaults preserve exact prior
  // behaviour for every existing club/registration — 'kids' and 'child'
  // respectively, i.e. nothing already in the DB changes meaning.
  await ensureColumn("clubs", "audience", "audience VARCHAR(10) NOT NULL DEFAULT 'kids'");
  await ensureColumn("registrations", "registrant_type", "registrant_type VARCHAR(10) NOT NULL DEFAULT 'child'");

  // HelloCircle Manage (Phase 1) — nullable link from a vendor account to the
  // resident account of the same person. Null for every vendor until they
  // deliberately link one via routes/manage.ts; no DB-level FK, same as every
  // other cross-table reference in this schema.
  await ensureColumn("users", "resident_id", "resident_id VARCHAR(191)");

  // Circle join modes (Follow/Notify/Stats gap audit §6) — Circles were
  // always instantly, publicly joinable (see routes/circles.ts's own
  // "Circles stay publicly joinable" comment on circle_invites above);
  // this adds the option for an organiser to require approval, or restrict
  // to invite-only. Default 'open' preserves exact prior behaviour for
  // every existing Circle.
  await ensureColumn("circles", "join_mode", "join_mode VARCHAR(20) NOT NULL DEFAULT 'open'");
  // circle_invites already models "a pending row an invitee accepts/
  // declines" — reused for resident-initiated join *requests* too rather
  // than adding a near-identical second table. `initiated_by` distinguishes
  // which party the row is waiting on: an 'organiser'-initiated row waits
  // on the invitee to accept/decline; a 'resident'-initiated one waits on
  // the organiser to approve/decline. Every existing row is a real
  // organiser invite, so the default backfills them correctly.
  await ensureColumn("circle_invites", "initiated_by", "initiated_by VARCHAR(20) NOT NULL DEFAULT 'organiser'");

  // Vendor reply on a review (Host Manage spec §16) — only ever set for
  // centre/club reviews (a vendor replies), never game/host reviews (no
  // vendor on those). Both nullable: every existing review is simply
  // unreplied-to.
  await ensureColumn("reviews", "vendor_reply", "vendor_reply TEXT");
  await ensureColumn("reviews", "vendor_reply_at", "vendor_reply_at DATETIME");

  // Vendor-scoped Offers (Host Manage spec §17) — every existing coupon is
  // admin/platform-wide and keeps working unchanged: NULL here means "any
  // vendor may not have created it" / "applies to any listing", exactly
  // today's behaviour. Only a vendor-created coupon ever sets these.
  await ensureColumn("coupons", "created_by_vendor_id", "created_by_vendor_id VARCHAR(191)");
  await ensureColumn("coupons", "eligible_listing_type", "eligible_listing_type VARCHAR(20)");
  await ensureColumn("coupons", "eligible_listing_id", "eligible_listing_id VARCHAR(191)");

  // Settings expansion (Host Manage spec §20) — refund policy copy + tax/
  // business registration details, alongside the existing
  // cancellation_hours/booking_window_days. All nullable/optional; no
  // existing org_policies row needs backfilling.
  await ensureColumn("org_policies", "refund_policy_text", "refund_policy_text TEXT");
  await ensureColumn("org_policies", "tax_number", "tax_number VARCHAR(100)");
  await ensureColumn("org_policies", "business_registration_number", "business_registration_number VARCHAR(100)");

  // Host Manage spec §26 — real bug fix: `users.description` (the public
  // bio shown on ProviderProfile.tsx) previously had NO edit route at all,
  // only ever set once at signup. `website`/`socials` are new fields
  // alongside it — `socials` stores a small fixed JSON object
  // ({instagram,facebook,x}), not a generic list, to avoid a whole
  // structured-links editor for what's a "nice to have" field. Both
  // nullable — no backfill needed.
  await ensureColumn("users", "website", "website VARCHAR(255)");
  await ensureColumn("users", "socials", "socials TEXT");

  // Vendor/admin account deactivation (Host Manage spec §28) — same "soft,
  // self-reversing" pattern already used for residents (see
  // residents.ts's own deactivate route and guestAuth.ts's sign-in-clears-it
  // logic): not a hard account lock, just a visibility/status toggle that
  // clears itself the next time this user logs in.
  await ensureColumn("users", "deactivated_at", "deactivated_at DATETIME");

  // Host-created coupons for paid Games (Vendor-parity pass, Phase 25) — a
  // resident host isn't a vendor `users` row, so this needs its own creator
  // column alongside the existing `created_by_vendor_id`; redemption itself
  // only ever checks `eligible_listing_type`/`eligible_listing_id`, not
  // creator, so evaluateCoupon() needs no change. `game_participants.coupon_code`
  // mirrors the same column already on `bookings`/`registrations`.
  await ensureColumn("coupons", "created_by_resident_id", "created_by_resident_id VARCHAR(191)");
  await ensureColumn("game_participants", "coupon_code", "coupon_code VARCHAR(50)");
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

/** Fills in lat/lng for any centre/club row that's missing them — an
 * idempotent, re-runnable backfill (not just a one-shot migration step),
 * since resetDemoListings() re-inserts centres/clubs with no coordinates
 * and initSchema() only runs once at server boot. resetDemo.ts's script
 * calls this again after resetDemoListings() for exactly that reason —
 * see its own comment (mirrors the same fix needed for backfillSlugs()). */
export async function backfillCentreClubCoords() {
  for (const table of ["centres", "clubs"] as const) {
    const rows = (await db.prepare(`SELECT id, county FROM ${table} WHERE lat IS NULL`).all()) as { id: string; county: string }[];
    for (const row of rows) {
      const { lat, lng } = approximateCoords(row.county, row.id);
      await db.prepare(`UPDATE ${table} SET lat = ?, lng = ? WHERE id = ?`).run(lat, lng, row.id);
    }
  }
}

export function approximateCoords(county: string, seedId: string): { lat: number; lng: number } {
  const centroid = COUNTY_CENTROIDS[county.trim().toLowerCase()] ?? COUNTY_CENTROIDS.dublin;
  let hash = 0;
  for (let i = 0; i < seedId.length; i++) hash = (hash * 31 + seedId.charCodeAt(i)) >>> 0;
  // Two pseudo-random offsets in [-0.06, 0.06) degrees (~±6km) from the hash's low/high bits.
  const offsetLat = (((hash & 0xffff) / 0xffff) - 0.5) * 0.12;
  const offsetLng = ((((hash >>> 16) & 0xffff) / 0xffff) - 0.5) * 0.12;
  return { lat: centroid.lat + offsetLat, lng: centroid.lng + offsetLng };
}
