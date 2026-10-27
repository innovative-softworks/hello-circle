import "dotenv/config";
import { db } from "../db/index.js";

// Activities that show every card label (owner, 2026-10-27; the rules are in
// client/src/components/CardDate.tsx and the "Activity card labels"
// artifact). Most are dated today or this weekend, so the Home and Explore
// feeds show them as well as the Activities page. Dev database only.
//
//   npm run seed-card-labels --workspace server -- [viewer@example.test ...]
//
// The "yours" labels (You're going, On the waitlist, Request sent) are set
// up for each viewer email given (default: ce2-a@example.test, if that
// resident exists). Re-running replaces what an earlier run added (ids start
// "cardseed-").

const DB = process.env.DB_NAME ?? "hello_circle";
if (DB !== "hello_circle_dev") {
  console.error(`Refusing to seed "${DB}". This script only writes to hello_circle_dev.`);
  process.exit(1);
}

const TZ = "Europe/Dublin";
const irelandDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const irelandHhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const today = irelandDate(new Date());
const plusDays = (days: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
// The coming weekend inside the feeds' 7-day window (today counts).
const weekend = [0, 1, 2, 3, 4, 5, 6].map(plusDays).filter((d) => dow(d) === 6 || dow(d) === 0);
const sat = weekend.find((d) => dow(d) === 6) ?? weekend[0];
const sun = weekend.find((d) => dow(d) === 0) ?? weekend[0];
const startedAgo = irelandHhmm(new Date(Date.now() - 20 * 60 * 1000));

const viewerEmails = process.argv.slice(2).filter((a) => a.includes("@"));
if (viewerEmails.length === 0) viewerEmails.push("ce2-a@example.test");

async function clearEarlierRun() {
  await db.prepare(`DELETE FROM game_join_requests WHERE game_id LIKE 'cardseed-%'`).run();
  await db.prepare(`DELETE FROM waitlist_entries WHERE listing_type = 'game' AND listing_id LIKE 'cardseed-%'`).run();
  await db.prepare(`DELETE FROM game_participants WHERE game_id LIKE 'cardseed-%'`).run();
  await db.prepare(`DELETE FROM games WHERE id LIKE 'cardseed-%'`).run();
}

/** Ten people to fill places with (created once, kept between runs). */
async function fillers(): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const id = `cardseed-person-${i}`;
    await db.prepare(`INSERT IGNORE INTO residents (id, email, name, onboarding_completed) VALUES (?, ?, ?, 1)`).run(id, `${id}@example.test`, `Card Seed ${i}`);
    ids.push(id);
  }
  return ids;
}

type Spec = {
  key: string;
  label: string; // the label this activity should show (for the summary)
  title: string;
  date: string;
  time: string;
  capacity: number;
  joined: number;
  priceCents?: number;
  durationMinutes?: number;
  minParticipants?: number;
  pending?: boolean;
  joinMode?: "open" | "approval";
  comingSoon?: boolean;
  circle?: boolean;
  createdDaysAgo?: number;
  soloFriendly?: boolean;
  viewer?: "joined" | "waiting" | "requested";
};

const SPECS: Spec[] = [
  { key: "live", label: "Happening now", title: "Lunchtime Pilates", date: today, time: startedAgo, durationMinutes: 180, capacity: 12, joined: 2 },
  { key: "tonight", label: "Starts soon (Tonight)", title: "Evening Five-a-side", date: today, time: "19:30", durationMinutes: 60, capacity: 10, joined: 3 },
  { key: "soon", label: "Starts soon (Tomorrow)", title: "Morning Bootcamp", date: plusDays(1), time: "07:00", capacity: 15, joined: 3 },
  { key: "going", label: "You're going", title: "Pickleball Social", date: sat, time: "10:00", capacity: 12, joined: 3, viewer: "joined" },
  { key: "wait", label: "On the waitlist", title: "Sea Kayak Taster", date: sat, time: "11:00", capacity: 2, joined: 2, priceCents: 1500, viewer: "waiting" },
  { key: "request", label: "Request sent", title: "Trail Running Club", date: sun, time: "07:30", capacity: 10, joined: 1, joinMode: "approval", viewer: "requested" },
  { key: "full", label: "Fully booked", title: "Pottery Wheel Evening", date: sun, time: "19:30", capacity: 2, joined: 2, priceCents: 2500 },
  { key: "needs", label: "2 more needed", title: "Tag Rugby Pickup", date: sat, time: "15:00", capacity: 12, joined: 4, minParticipants: 6, pending: true },
  { key: "few", label: "2 spots left", title: "Swim Technique Session", date: sun, time: "18:30", capacity: 8, joined: 6, priceCents: 800 },
  { key: "coming", label: "Coming soon", title: "Winter Solstice Walk", date: plusDays(20), time: "08:00", capacity: 30, joined: 0, comingSoon: true },
  { key: "circle", label: "Circle meetup", title: "Circle Coffee Morning", date: sat, time: "12:00", capacity: 20, joined: 2, circle: true },
  { key: "new", label: "New", title: "Community Garden Morning", date: sun, time: "10:00", capacity: 12, joined: 1, createdDaysAgo: 2 },
  { key: "solo", label: "Solo friendly", title: "Board Game Cafe Night", date: sat, time: "19:00", capacity: 10, joined: 2, soloFriendly: true },
  { key: "plain", label: "(no label, date only)", title: "Community Badminton Night", date: sun, time: "20:00", capacity: 16, joined: 5, priceCents: 500 },
];

await clearEarlierRun();
const people = await fillers();
const viewers = (
  await Promise.all(viewerEmails.map(async (email) => (await db.prepare(`SELECT id, name, email FROM residents WHERE email = ?`).get(email)) as { id: string; name: string; email: string } | undefined))
).filter((v): v is { id: string; name: string; email: string } => !!v);
if (viewers.length === 0) console.warn(`No resident found for ${viewerEmails.join(", ")}: the "yours" labels won't be set up.`);

const centre = (await db.prepare(`SELECT id FROM centres WHERE status = 'approved' ORDER BY created_at LIMIT 1`).get()) as { id: string } | undefined;
const circle = (await db.prepare(`SELECT id, name FROM circles WHERE status = 'active' AND join_mode = 'open' ORDER BY created_at LIMIT 1`).get()) as { id: string; name: string } | undefined;
const images = ((await db.prepare(`SELECT DISTINCT image_url as url FROM games WHERE image_url IS NOT NULL AND image_url <> '' LIMIT 14`).all()) as { url: string }[]).map((r) => r.url);

for (const [i, s] of SPECS.entries()) {
  const id = `cardseed-${s.key}`;
  const createdAt = new Date(Date.now() - (s.createdDaysAgo ?? 30) * 24 * 3600 * 1000);
  await db
    .prepare(
      `INSERT INTO games (id, host_resident_id, activity_label, centre_id, location_text, date, time, capacity, status, min_participants, visibility,
                          image_url, duration_minutes, join_mode, lifecycle, booking_open_at, solo_friendly, circle_id, price_cents, created_at, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      people[9],
      s.title,
      centre?.id ?? null,
      centre ? "" : "Dublin",
      s.date,
      s.time,
      s.capacity,
      s.pending ? "pending_participants" : "open",
      s.minParticipants ?? null,
      images.length ? images[i % images.length] : null,
      s.durationMinutes ?? 90,
      s.joinMode ?? "open",
      s.comingSoon ? "coming_soon" : "active",
      s.comingSoon ? new Date(Date.now() + 10 * 24 * 3600 * 1000) : null,
      s.soloFriendly ? 1 : 0,
      s.circle ? circle?.id ?? null : null,
      s.priceCents ?? 0,
      createdAt,
      `Card label example: ${s.label}.`
    );
  // Places taken by other people (the viewer counts as one when joined).
  const others = s.joined - (s.viewer === "joined" ? viewers.length : 0);
  for (let p = 0; p < Math.max(0, others); p++) {
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status) VALUES (?, ?, ?, 'joined')`).run(id, people[p], `CARDSEED-${s.key}-${p}`.toUpperCase());
  }
  for (const v of viewers) {
    if (s.viewer === "joined") await db.prepare(`INSERT INTO game_participants (game_id, resident_id, ref, status) VALUES (?, ?, ?, 'joined')`).run(id, v.id, `CARDSEED-${s.key}-${v.id}`.toUpperCase().slice(0, 60));
    if (s.viewer === "waiting")
      await db
        .prepare(`INSERT INTO waitlist_entries (listing_type, listing_id, resident_id, client_id, name, email, status) VALUES ('game', ?, ?, 'cardseed', ?, ?, 'waiting')`)
        .run(id, v.id, v.name || "Guest", v.email);
    if (s.viewer === "requested")
      await db.prepare(`INSERT INTO game_join_requests (game_id, resident_id, status, message) VALUES (?, ?, 'requested', 'I run most mornings.')`).run(id, v.id);
  }
}

console.log(`Card label examples (today ${today}, weekend ${sat} / ${sun}):`);
for (const s of SPECS) console.log(`  ${s.label.padEnd(24)} ${s.title.padEnd(28)} ${s.date} ${s.time}${s.circle && circle ? `  (${circle.name})` : ""}`);
console.log(viewers.length ? `"Yours" labels set up for: ${viewers.map((v) => v.email).join(", ")}` : "");
process.exit(0);
