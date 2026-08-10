import { db } from "./index.js";
import { createUser, findUserByEmail } from "../auth.js";

interface SeedRoom {
  id: string;
  name: string;
  cap: number;
  rate: number;
  desc: string;
}

interface SeedCentre {
  id: string;
  name: string;
  area: string;
  county: string;
  rating: number;
  reviews: number;
  capacity: number;
  from: number;
  managedBy: string;
  ph: string;
  image: string;
  blurb: string;
  amenities: string[];
  rooms: SeedRoom[];
}

interface SeedClub {
  id: string;
  name: string;
  sport: string;
  area: string;
  county: string;
  ages: string;
  price: number;
  unit: string;
  trial: boolean;
  ph: string;
  image: string;
  blurb: string;
  includes: string[];
}

// Sample photos from Lorem Picsum, seeded per id so each place gets a stable,
// distinct placeholder photo instead of the flat gradient block.
const img = (seed: string) => `https://picsum.photos/seed/halla-${seed}/800/500`;
// A handful of extra angles per listing so the detail-page gallery has more
// than one photo to show — same approach, just more seeds per id.
const imgs = (seed: string) => [1, 2, 3, 4, 5].map((n) => `https://picsum.photos/seed/halla-${seed}-${n}/800/500`);

// Ported verbatim from CENTRES/CLUBS in reference/Halla.dc.html
// Trimmed to a 2-and-2 demo set — see resetDemoListings() below.
const CENTRES: SeedCentre[] = [
  { id: "c1", name: "St. Brigid's Community Hall", area: "Stoneybatter, Dublin 7", county: "Dublin", rating: 4.8, reviews: 126, capacity: 180, from: 22, managedBy: "Dublin City Council", ph: "repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)", image: img("c1"), blurb: "A bright, recently refurbished hall in the heart of Stoneybatter. Popular for birthday parties, community meetings and indoor sports, with a sprung timber floor, full kitchen and its own car park.", amenities: ["Wheelchair accessible", "Full kitchen", "Free parking (20 spaces)", "Fast Wi-Fi", "Stage & PA system", "Tables & chairs included"], rooms: [{ id: "r1", name: "Main Hall", cap: 180, rate: 65, desc: "Sprung floor, stage" }, { id: "r2", name: "Function Room", cap: 60, rate: 38, desc: "Carpeted, kitchen access" }, { id: "r3", name: "Meeting Room", cap: 20, rate: 22, desc: "Boardroom, screen" }] },
  { id: "c2", name: "Ballincollig Community Centre", area: "Ballincollig, Cork", county: "Cork", rating: 4.6, reviews: 89, capacity: 250, from: 18, managedBy: "Cork County Council", ph: "repeating-linear-gradient(135deg,#DEE6E9 0 14px,#E7EDEF 14px 28px)", image: img("c2"), blurb: "A large multi-purpose centre serving west Cork. The sports hall doubles as a function space for weddings and cultural events, with generous parking and step-free access throughout.", amenities: ["Wheelchair accessible", "Commercial kitchen", "Free parking (60 spaces)", "Wi-Fi", "Changing rooms", "Tables & chairs included"], rooms: [{ id: "r1", name: "Sports Hall", cap: 250, rate: 70, desc: "Full-size courts, high ceiling" }, { id: "r2", name: "Function Room", cap: 120, rate: 45, desc: "Bar area, dance floor" }, { id: "r3", name: "Small Room", cap: 15, rate: 18, desc: "Classes & workshops" }] },
];

const CLUBS: SeedClub[] = [
  { id: "s1", name: "Na Fianna GAA", sport: "GAA", area: "Glasnevin, Dublin", county: "Dublin", ages: "4–17", price: 120, unit: "year", trial: true, ph: "repeating-linear-gradient(135deg,#F5E1D3 0 14px,#FAEBE0 14px 28px)", image: img("s1"), blurb: "One of Dublin's largest GAA clubs, fielding Gaelic football, hurling and camogie teams from Under-6 up. A welcoming Nursery on Saturday mornings is the perfect first step.", includes: ["Weekly coached training", "Match-day fixtures", "Club gear discount", "Garda-vetted coaches"] },
  { id: "s2", name: "Cabra Celtic FC", sport: "Soccer", area: "Cabra, Dublin", county: "Dublin", ages: "5–16", price: 150, unit: "year", trial: true, ph: "repeating-linear-gradient(135deg,#F5E1D3 0 14px,#FAEBE0 14px 28px)", image: img("s2"), blurb: "A grassroots soccer club running boys' and girls' teams in the local schoolboy/girl leagues. Emphasis on fun, fundamentals and getting every child game time.", includes: ["Two sessions a week", "League matches", "Full kit included", "FAI-qualified coaches"] },
];

async function insertSeedListings() {
  await db.transaction(async (tx) => {
    const insertCentre = tx.prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, created_at)
       VALUES (@id, @name, @area, @county, @rating, @reviews, @capacity, @from, @managedBy, @ph, @image, @blurb, NOW())`
    );
    const insertAmenity = tx.prepare(
      `INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`
    );
    const insertCentreImage = tx.prepare(
      `INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`
    );
    const insertRoom = tx.prepare(
      `INSERT INTO rooms (id, centre_id, name, cap, rate, \`desc\`, sort_order) VALUES (@id, @centreId, @name, @cap, @rate, @desc, @sortOrder)`
    );
    const insertClub = tx.prepare(
      `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, created_at)
       VALUES (@id, @name, @sport, @area, @county, @ages, @price, @unit, @trial, @ph, @image, @blurb, NOW())`
    );
    const insertInclude = tx.prepare(
      `INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`
    );
    const insertClubImage = tx.prepare(
      `INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`
    );

    for (const c of CENTRES) {
      await insertCentre.run(c);
      for (const [i, a] of c.amenities.entries()) await insertAmenity.run(c.id, a, i);
      for (const [i, r] of c.rooms.entries()) await insertRoom.run({ ...r, centreId: c.id, sortOrder: i });
      for (const [i, url] of imgs(c.id).entries()) await insertCentreImage.run(c.id, url, i);
    }
    for (const c of CLUBS) {
      await insertClub.run({ ...c, trial: c.trial ? 1 : 0 });
      for (const [i, item] of c.includes.entries()) await insertInclude.run(c.id, item, i);
      for (const [i, url] of imgs(c.id).entries()) await insertClubImage.run(c.id, url, i);
    }
  });
}

/** Wipes every centre/club listing plus everything that references one —
 * rooms, amenities, images, bookings, registrations, reviews, notifications,
 * room blocks — then reseeds just the CENTRES/CLUBS demo set above. Leaves
 * users, sessions and coupons untouched. Run once via `npm run reset-demo`. */
export async function resetDemoListings() {
  await db.transaction(async (tx) => {
    for (const table of [
      "bookings",
      "room_blocks",
      "rooms",
      "centre_images",
      "centre_amenities",
      "registrations",
      "club_images",
      "club_includes",
      "reviews",
      "notifications",
      "centres",
      "clubs",
    ]) {
      await tx.prepare(`DELETE FROM ${table}`).run();
    }
  });
  await insertSeedListings();
}

export async function seedIfEmpty() {
  const { count } = (await db.prepare("SELECT COUNT(*) as count FROM centres").get()) as { count: number };

  if (count === 0) {
    await insertSeedListings();
    return;
  }

  // Database was seeded before image_url existed — backfill it in place.
  await db.transaction(async (tx) => {
    const backfillCentre = tx.prepare(
      `UPDATE centres SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')`
    );
    const backfillClub = tx.prepare(
      `UPDATE clubs SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')`
    );
    for (const c of CENTRES) await backfillCentre.run(c.image, c.id);
    for (const c of CLUBS) await backfillClub.run(c.image, c.id);
  });

  // Database was seeded before centre_images/club_images existed — backfill
  // a handful of extra gallery photos for each originally-seeded listing.
  const { count: centreImgCount } = (await db.prepare("SELECT COUNT(*) as count FROM centre_images").get()) as {
    count: number;
  };
  if (centreImgCount === 0) {
    await db.transaction(async (tx) => {
      const insertCentreImage = tx.prepare(`INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`);
      const insertClubImage = tx.prepare(`INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`);
      for (const c of CENTRES) for (const [i, url] of imgs(c.id).entries()) await insertCentreImage.run(c.id, url, i);
      for (const c of CLUBS) for (const [i, url] of imgs(c.id).entries()) await insertClubImage.run(c.id, url, i);
    });
  }
}

const ADMIN_EMAIL = process.env.HELLO_CIRCLE_ADMIN_EMAIL || "admin@hellocircle.ie";
const ADMIN_PASSWORD = process.env.HELLO_CIRCLE_ADMIN_PASSWORD || "changeme123";

/** Seeds a single admin account on first run. Prototype-only credential
 * source — swap for a real provisioning step before this ever goes live. */
export async function seedAdminIfMissing() {
  if (await findUserByEmail(ADMIN_EMAIL)) return;
  await createUser(ADMIN_EMAIL, ADMIN_PASSWORD, "Hello Circle Admin", "admin", "approved");
  console.log(`Seeded admin account: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (set HELLO_CIRCLE_ADMIN_EMAIL/HELLO_CIRCLE_ADMIN_PASSWORD to change)`);
}
