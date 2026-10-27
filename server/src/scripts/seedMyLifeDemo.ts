import "dotenv/config";
import { randomBytes } from "node:crypto";
import { db } from "../db/index.js";

// Fills one or more residents' My Life with example data so every section
// shows (owner, 2026-10-25): upcoming Sessions, Circle meetups not joined
// yet, past activity (enough for "Do it again"), saved items, follows, a
// "Waiting for" request, an open Circle poll and a waitlist offer ("Needs
// you"), interests and free times. Dev database only.
//
//   npm run seed-mylife-demo --workspace server -- someone@example.test [more emails]
//
// Re-running replaces what an earlier run added (rows are tagged "mlseed").

const DB = process.env.DB_NAME ?? "hello_circle";
if (DB !== "hello_circle_dev") {
  console.error(`Refusing to seed "${DB}". This script only writes to hello_circle_dev.`);
  process.exit(1);
}

const emails = process.argv.slice(2).filter((a) => a.includes("@"));
if (emails.length === 0) {
  console.error("Give at least one resident email: npm run seed-mylife-demo --workspace server -- you@example.test");
  process.exit(1);
}

type Row = Record<string, unknown>;
const tag = () => `mlseed-${randomBytes(5).toString("hex")}`;

/** YYYY-MM-DD for today in Ireland, shifted by `days`. */
function irelandDay(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Copy an existing game row under a new id with some fields changed. */
async function cloneGame(sourceId: string, changes: Row, idOverride?: string): Promise<string> {
  const id = idOverride ?? tag();
  const src = (await db.prepare(`SELECT * FROM games WHERE id = ?`).get(sourceId)) as Row | undefined;
  if (!src) throw new Error(`No game ${sourceId} to copy`);
  const row: Row = { ...src, ...changes, id, status: "open", lifecycle: src.lifecycle ?? null, series_id: null, plan_id: null, booking_ref: null, publish_at: null };
  const cols = Object.keys(row);
  await db.prepare(`INSERT INTO games (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => row[c]));
  return id;
}

async function join(gameId: string, residentId: string) {
  await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref) VALUES (?, ?, ?)`).run(gameId, residentId, `MLSEED-${randomBytes(3).toString("hex").toUpperCase()}`);
}

async function clearEarlierRun(residentId: string) {
  // Sessions an earlier run copied for this resident (joined ones, and the
  // meetups added to their Circles), so re-running doesn't pile them up.
  const old = (await db
    .prepare(
      `SELECT id FROM games WHERE id LIKE 'mlseed-%' AND (
         id IN (SELECT game_id FROM game_participants WHERE resident_id = ?)
         OR circle_id IN (SELECT circle_id FROM circle_members WHERE resident_id = ?)
         OR id LIKE ?)`
    )
    .all(residentId, residentId, `mlseed-rt-${residentId.slice(-12)}-%`)) as { id: string }[];
  for (const g of old) {
    await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM favourites WHERE listing_type = 'game' AND listing_id = ?`).run(g.id);
    await db.prepare(`DELETE FROM games WHERE id = ?`).run(g.id);
  }
  await db.prepare(`DELETE FROM game_participants WHERE resident_id = ? AND (ref LIKE 'MLSEED-%' OR game_id LIKE 'mlseed-%')`).run(residentId);
  await db.prepare(`DELETE FROM circle_poll_options WHERE poll_id IN (SELECT id FROM (SELECT id FROM circle_polls WHERE id LIKE 'mlseed-%') p)`).run();
  await db.prepare(`DELETE FROM circle_polls WHERE id LIKE 'mlseed-%' AND circle_id IN (SELECT circle_id FROM circle_members WHERE resident_id = ?)`).run(residentId);
  await db.prepare(`DELETE FROM participation_intents WHERE id LIKE 'mlseed-%' AND resident_id = ?`).run(residentId);
  await db.prepare(`DELETE FROM waitlist_entries WHERE resident_id = ? AND name = 'mlseed'`).run(residentId);
  await db.prepare(`DELETE FROM routines WHERE id LIKE 'mlseed-%' AND resident_id = ?`).run(residentId);
}

async function seedFor(email: string) {
  const resident = (await db.prepare(`SELECT id, name, home_county as county FROM residents WHERE LOWER(email) = LOWER(?)`).get(email)) as
    | { id: string; name: string; county: string | null }
    | undefined;
  if (!resident) {
    console.error(`  No resident with email ${email}. Sign in once with that email, then run this again.`);
    return;
  }
  const rid = resident.id;
  console.log(`\n${resident.name} (${email})`);
  await clearEarlierRun(rid);

  // Template games with a photo, open to anyone, no age limit.
  const templates = (await db
    .prepare(
      `SELECT id, activity_label as label FROM games
       WHERE status = 'open' AND visibility = 'public' AND image_url IS NOT NULL AND image_url <> ''
         AND (min_age IS NULL OR min_age = 0) AND circle_id IS NULL AND id NOT LIKE 'mlseed-%'
       ORDER BY created_at DESC LIMIT 12`
    )
    .all()) as { id: string; label: string }[];
  if (templates.length < 4) throw new Error("Not enough games with photos to copy. Run reset-demo first.");

  // 1. Upcoming Sessions you've joined (Coming up cards).
  const upcoming = [1, 3, 5, 9, 13];
  for (let i = 0; i < upcoming.length; i++) {
    const t = templates[i % templates.length];
    const id = await cloneGame(t.id, { date: irelandDay(upcoming[i]), visibility: "public" });
    await join(id, rid);
  }
  console.log(`  joined ${upcoming.length} upcoming Sessions`);

  // A weekly routine that matches the first upcoming Session (routine
  // matches, reminders and the My Plans → Routines view).
  const first = templates[0];
  const firstDate = irelandDay(upcoming[0]);
  const firstTime = ((await db.prepare(`SELECT time FROM games WHERE id = ?`).get(first.id)) as { time: string }).time;
  await db
    .prepare(`INSERT INTO routines (id, resident_id, activity_label, day_of_week, time, status) VALUES (?, ?, ?, ?, ?, 'active')`)
    .run(tag(), rid, first.label, new Date(`${firstDate}T12:00:00Z`).getUTCDay() + 1, firstTime);
  // and another copy of that Session a week later, so the routine has a match after the one already joined
  await cloneGame(first.id, { date: irelandDay(upcoming[0] + 7), visibility: "public" }, `mlseed-rt-${rid.slice(-12)}-${randomBytes(3).toString("hex")}`);
  console.log(`  added a weekly "${first.label}" routine`);

  // 2. Past activity: the same Session on the same weekday three times in
  //    the last 8 weeks (gives "Do it again", Recently and Your activity).
  const again = templates[5 % templates.length];
  for (const weeksAgo of [1, 2, 3]) {
    const id = await cloneGame(again.id, { date: irelandDay(-7 * weeksAgo + 1) });
    await join(id, rid);
  }
  console.log(`  added 3 past "${again.label}" Sessions`);

  // 3. Circle meetups this week that you haven't joined (green "Your Circle" cards).
  const circles = (await db
    .prepare(
      `SELECT c.id, c.created_by_resident_id as hostId FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
       WHERE cm.resident_id = ? AND c.status = 'active' ORDER BY cm.joined_at LIMIT 3`
    )
    .all(rid)) as { id: string; hostId: string }[];
  for (let i = 0; i < Math.min(2, circles.length); i++) {
    const c = circles[i];
    // Hosted by the Circle's organiser, or the copied Session's own host when
    // that organiser is this resident (so it stays "not joined yet").
    const changes: Row = { date: irelandDay(2 + i * 2), circle_id: c.id };
    if (c.hostId && c.hostId !== rid) changes.host_resident_id = c.hostId;
    await cloneGame(templates[(i + 6) % templates.length].id, changes);
  }
  console.log(`  added ${Math.min(2, circles.length)} Circle meetups (not joined)`);

  // 4. Needs you: an open poll in one of your Circles, and a waitlist offer.
  if (circles.length > 0) {
    const pollId = tag();
    const author = circles[0].hostId && circles[0].hostId !== rid ? circles[0].hostId : rid;
    await db.prepare(`INSERT INTO circle_polls (id, circle_id, question, created_by_resident_id, status) VALUES (?, ?, ?, ?, 'open')`).run(pollId, circles[0].id, "Which evening suits for the next meetup?", author);
    let order = 0;
    for (const d of [3, 4]) {
      await db.prepare(`INSERT INTO circle_poll_options (poll_id, date, time, sort_order) VALUES (?, ?, ?, ?)`).run(pollId, irelandDay(d), "19:00", order++);
    }
    console.log("  added an open Circle poll");
  }
  const offered = templates[7 % templates.length];
  await db
    .prepare(`INSERT INTO waitlist_entries (listing_type, listing_id, resident_id, client_id, name, email, status, offer_expires_at) VALUES ('game', ?, ?, ?, 'mlseed', ?, 'offered', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 HOUR))`)
    .run(offered.id, rid, `mlseed-${rid}`, email);
  console.log("  added a waitlist place offered to you");

  // 5. Saved items (photos) and follows.
  for (const t of templates.slice(8, 11)) {
    await db.prepare(`INSERT IGNORE INTO favourites (resident_id, listing_type, listing_id, status) VALUES (?, 'game', ?, 'interested')`).run(rid, t.id);
  }
  const centre = (await db.prepare(`SELECT id FROM centres WHERE status = 'approved' ORDER BY created_at LIMIT 1`).get()) as { id: string } | undefined;
  if (centre) await db.prepare(`INSERT IGNORE INTO favourites (resident_id, listing_type, listing_id, status) VALUES (?, 'centre', ?, 'planning')`).run(rid, centre.id);
  const follows = (await db.prepare(`SELECT COUNT(*) as n FROM follows WHERE resident_id = ?`).get(rid)) as { n: number };
  if (Number(follows.n) === 0 && centre) {
    await db.prepare(`INSERT INTO follows (resident_id, followed_type, followed_id) VALUES (?, 'centre', ?)`).run(rid, centre.id);
  }
  console.log("  saved items and a follow");

  // 6. Waiting for: an open "I'd like to do" request.
  await db
    .prepare(
      `INSERT INTO participation_intents (id, resident_id, client_id, name, email, activity_label, county, preferred_date, preferred_time_window, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'Padel', ?, ?, 'evening', 'active', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))`
    )
    .run(tag(), rid, `mlseed-${rid}`, resident.name, email, resident.county || "Dublin", irelandDay(10));
  console.log("  added a Waiting for request (Padel)");

  // 7. Interests and free times, only if none are set.
  await db
    .prepare(
      `UPDATE residents SET interests = COALESCE(NULLIF(interests, ''), 'Swimming,Football,Walking,Outdoor'),
         availability = COALESCE(NULLIF(availability, ''), 'tue:evening,thu:evening,sat:morning,sun:morning') WHERE id = ?`
    )
    .run(rid);
  console.log("  interests and free times set (kept yours if you had them)");
}

for (const email of emails) await seedFor(email);
console.log("\nDone. Reload /bookings to see it.");
process.exit(0);
