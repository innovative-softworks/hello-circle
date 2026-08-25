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

// Ported from CENTRES/CLUBS in reference/Halla.dc.html. c1/c2 and s1/s2 were
// the original trimmed 2-and-2 demo set; c3-c6/s3-s8 restore the rest of the
// reference set (more counties/sports for a richer dev browse experience),
// adapted to the current schema — a centre has exactly one room now (see the
// room-collapse migration in db/index.ts), so `from`/room `rate` use the
// reference's cheapest-room price rather than the old multi-room spread.
const CENTRES: SeedCentre[] = [
  { id: "c1", name: "St. Brigid's Community Hall", area: "Stoneybatter, Dublin 7", county: "Dublin", rating: 4.8, reviews: 126, capacity: 180, from: 22, managedBy: "Dublin City Council", ph: "repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)", image: img("c1"), blurb: "A bright, recently refurbished hall in the heart of Stoneybatter. Popular for birthday parties, community meetings and indoor sports, with a sprung timber floor, full kitchen and its own car park.", amenities: ["Wheelchair accessible", "Full kitchen", "Free parking (20 spaces)", "Fast Wi-Fi", "Stage & PA system", "Tables & chairs included"], rooms: [{ id: "r1", name: "Main Hall", cap: 180, rate: 65, desc: "Sprung floor, stage" }, { id: "r2", name: "Function Room", cap: 60, rate: 38, desc: "Carpeted, kitchen access" }, { id: "r3", name: "Meeting Room", cap: 20, rate: 22, desc: "Boardroom, screen" }] },
  { id: "c2", name: "Ballincollig Community Centre", area: "Ballincollig, Cork", county: "Cork", rating: 4.6, reviews: 89, capacity: 250, from: 18, managedBy: "Cork County Council", ph: "repeating-linear-gradient(135deg,#DEE6E9 0 14px,#E7EDEF 14px 28px)", image: img("c2"), blurb: "A large multi-purpose centre serving west Cork. The sports hall doubles as a function space for weddings and cultural events, with generous parking and step-free access throughout.", amenities: ["Wheelchair accessible", "Commercial kitchen", "Free parking (60 spaces)", "Wi-Fi", "Changing rooms", "Tables & chairs included"], rooms: [{ id: "r1", name: "Sports Hall", cap: 250, rate: 70, desc: "Full-size courts, high ceiling" }, { id: "r2", name: "Function Room", cap: 120, rate: 45, desc: "Bar area, dance floor" }, { id: "r3", name: "Small Room", cap: 15, rate: 18, desc: "Classes & workshops" }] },
  { id: "c3", name: "Salthill Community Hall", area: "Salthill, Galway", county: "Galway", rating: 4.9, reviews: 154, capacity: 140, from: 28, managedBy: "Galway City Council", ph: "repeating-linear-gradient(135deg,#DBE7E6 0 14px,#E5EDEC 14px 28px)", image: img("c3"), blurb: "Steps from the promenade, this seafront hall is a favourite for naming ceremonies and family functions, with big windows framing Galway Bay and a warm, welcoming committee.", amenities: ["Wheelchair accessible", "Kitchen facilities", "On-street parking", "Wi-Fi", "Sea-view windows", "Tables & chairs included"], rooms: [{ id: "r1", name: "Ocean Room", cap: 140, rate: 28, desc: "Bay views, wood floor" }] },
  { id: "c4", name: "Dooradoyle Parish Centre", area: "Dooradoyle, Limerick", county: "Limerick", rating: 4.5, reviews: 61, capacity: 200, from: 22, managedBy: "the local Parish", ph: "repeating-linear-gradient(135deg,#E4E3DA 0 14px,#EAE9E1 14px 28px)", image: img("c4"), blurb: "A dependable, spacious parish hall used for everything from First Communion parties to community development meetings. Simple, affordable and central to the southside.", amenities: ["Wheelchair accessible", "Kitchen facilities", "Free parking", "Wi-Fi", "Foldable staging", "Tables & chairs included"], rooms: [{ id: "r1", name: "Main Hall", cap: 200, rate: 22, desc: "Open span, PA available" }] },
  { id: "c5", name: "Ferrybank Community Centre", area: "Ferrybank, Waterford", county: "Waterford", rating: 4.7, reviews: 73, capacity: 160, from: 26, managedBy: "a Community Development Group", ph: "repeating-linear-gradient(135deg,#E1E6DE 0 14px,#E9EDE6 14px 28px)", image: img("c5"), blurb: "Run by an energetic local development group, Ferrybank hosts everything from toddler groups to cultural nights. Flexible layouts and very friendly rates.", amenities: ["Wheelchair accessible", "Kitchen facilities", "Free parking", "Wi-Fi", "Projector & screen", "Tables & chairs included"], rooms: [{ id: "r1", name: "Main Hall", cap: 160, rate: 26, desc: "Multi-use, projector" }] },
  { id: "c6", name: "Phibsborough Community Hub", area: "Phibsborough, Dublin 7", county: "Dublin", rating: 4.8, reviews: 198, capacity: 120, from: 24, managedBy: "a Local Community Association", ph: "repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)", image: img("c6"), blurb: "A stylish modern hub above the local library, ideal for workshops, cultural events and smaller functions. Excellent transport links and a bright, contemporary interior.", amenities: ["Wheelchair accessible", "Tea & coffee station", "Bike parking", "Fast Wi-Fi", "AV & screen", "Tables & chairs included"], rooms: [{ id: "r1", name: "Event Space", cap: 120, rate: 24, desc: "Floor-to-ceiling windows" }] },
];

const CLUBS: SeedClub[] = [
  { id: "s1", name: "Na Fianna GAA", sport: "GAA", area: "Glasnevin, Dublin", county: "Dublin", ages: "4–17", price: 120, unit: "year", trial: true, ph: "repeating-linear-gradient(135deg,#F5E1D3 0 14px,#FAEBE0 14px 28px)", image: img("s1"), blurb: "One of Dublin's largest GAA clubs, fielding Gaelic football, hurling and camogie teams from Under-6 up. A welcoming Nursery on Saturday mornings is the perfect first step.", includes: ["Weekly coached training", "Match-day fixtures", "Club gear discount", "Garda-vetted coaches"] },
  { id: "s2", name: "Cabra Celtic FC", sport: "Soccer", area: "Cabra, Dublin", county: "Dublin", ages: "5–16", price: 150, unit: "year", trial: true, ph: "repeating-linear-gradient(135deg,#F5E1D3 0 14px,#FAEBE0 14px 28px)", image: img("s2"), blurb: "A grassroots soccer club running boys' and girls' teams in the local schoolboy/girl leagues. Emphasis on fun, fundamentals and getting every child game time.", includes: ["Two sessions a week", "League matches", "Full kit included", "FAI-qualified coaches"] },
  { id: "s3", name: "Galway Dolphins Swimming", sport: "Swimming", area: "Salthill, Galway", county: "Galway", ages: "5–14", price: 15, unit: "lesson", trial: true, ph: "repeating-linear-gradient(135deg,#D9E6EC 0 14px,#E4EDF1 14px 28px)", image: img("s3"), blurb: "Learn-to-swim and squad programmes at the Salthill pool. Small groups by ability, from first splashes to competitive galas.", includes: ["Small-group lessons", "Ability-based levels", "Progress badges", "Swim Ireland affiliated"] },
  { id: "s4", name: "Cork Harlequins RFC", sport: "Rugby", area: "Farmers Cross, Cork", county: "Cork", ages: "6–17", price: 180, unit: "year", trial: true, ph: "repeating-linear-gradient(135deg,#F5E1D3 0 14px,#FAEBE0 14px 28px)", image: img("s4"), blurb: "Mini and youth rugby in a safe, tag-first environment. Sunday-morning minis are hugely popular with families new to the area.", includes: ["Sunday minis", "Age-grade teams", "Club jersey", "IRFU-accredited coaches"] },
  { id: "s5", name: "Limerick Gymnastics Club", sport: "Gymnastics", area: "Dooradoyle, Limerick", county: "Limerick", ages: "4–14", price: 150, unit: "term", trial: false, ph: "repeating-linear-gradient(135deg,#EDE0EC 0 14px,#F2E9F1 14px 28px)", image: img("s5"), blurb: "Recreational and development gymnastics in a fully-equipped gym. Builds strength, balance and confidence through structured, playful classes.", includes: ["Weekly classes", "Full apparatus", "Badge assessments", "Gymnastics Ireland affiliated"] },
  { id: "s6", name: "Waterford Tennis Academy", sport: "Tennis", area: "Ferrybank, Waterford", county: "Waterford", ages: "5–16", price: 12, unit: "session", trial: true, ph: "repeating-linear-gradient(135deg,#E1EBD9 0 14px,#EAF0E4 14px 28px)", image: img("s6"), blurb: "Junior tennis coaching on all-weather courts. Red, orange and green ball stages take players from first rallies to junior competition.", includes: ["Stage-based coaching", "Rackets provided", "Holiday camps", "Tennis Ireland coaches"] },
  { id: "s7", name: "Northside Athletics", sport: "Athletics", area: "Santry, Dublin", county: "Dublin", ages: "6–17", price: 90, unit: "year", trial: true, ph: "repeating-linear-gradient(135deg,#E1EBD9 0 14px,#EAF0E4 14px 28px)", image: img("s7"), blurb: "Track and field for juniors at Morton Stadium. Sprints, jumps, throws and cross-country — great all-round fitness and a brilliant club community.", includes: ["Track training", "Cross-country league", "Club singlet", "Athletics Ireland coaches"] },
  { id: "s8", name: "Shotokan Kids Martial Arts", sport: "Martial Arts", area: "Ballincollig, Cork", county: "Cork", ages: "5–15", price: 110, unit: "term", trial: true, ph: "repeating-linear-gradient(135deg,#EDE0EC 0 14px,#F2E9F1 14px 28px)", image: img("s8"), blurb: "Traditional karate for children focused on discipline, respect and confidence. A structured belt system gives kids clear goals to work towards.", includes: ["Twice-weekly classes", "Grading & belts", "Starter gi included", "Insured, vetted instructors"] },
];

// Community-contributed places (master-prompt punch list #4) — demo rows
// for the admin review queue. Deliberately anonymous (client_id only, no
// resident_id) since that's the one piece of this batch that doesn't
// require a signed-in resident identity — see the "seed data for phases
// 3/5" comment on resetDemoListings() below for why game/host reviews and
// search alerts aren't seeded the same way.
const PLACE_SUGGESTIONS = [
  {
    id: "demo-place-1",
    clientId: "demo-seed-client",
    suggestedName: "Ranelagh Multi Sports Club",
    category: "club" as const,
    area: "Ranelagh",
    county: "Dublin",
    description: "Astro pitch behind the church hall — five-a-side and junior camogie on weekends. Not on HelloCircle yet as far as I can tell!",
    contactInfo: "ranelaghmultisports@example.ie",
  },
  {
    id: "demo-place-2",
    clientId: "demo-seed-client",
    suggestedName: "Tramore Seafront Pavilion",
    category: "centre" as const,
    area: "Tramore",
    county: "Waterford",
    description: "Small function room right on the promenade, used for the local drama group and toddler groups.",
    contactInfo: "",
  },
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

async function insertSeedPlaceSuggestions() {
  const insert = db.prepare(
    `INSERT INTO place_suggestions (id, client_id, suggested_name, category, area, county, description, contact_info)
     VALUES (@id, @clientId, @suggestedName, @category, @area, @county, @description, @contactInfo)`
  );
  for (const s of PLACE_SUGGESTIONS) await insert.run(s);
}

/** Wipes every centre/club listing plus everything that references one —
 * rooms, amenities, images, bookings, registrations, reviews, notifications,
 * room blocks — then reseeds just the CENTRES/CLUBS demo set above. Leaves
 * users, sessions and coupons untouched. Run once via `npm run reset-demo`.
 *
 * Doesn't touch residents/games/circles/search_alerts or game/host reviews
 * (master-prompt punch list #3/#5) — those are resident-scoped by design,
 * and this app has never pre-seeded a resident identity anywhere (they're
 * always find-or-created live via the magic-link flow, same as routines/
 * favourites/passes/circles today). Community place suggestions (#4) are
 * the one addition here that genuinely doesn't need a resident — anonymous
 * client-id submission is native to that table. */
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
      "place_suggestions",
    ]) {
      await tx.prepare(`DELETE FROM ${table}`).run();
    }
  });
  await insertSeedListings();
  await insertSeedPlaceSuggestions();
}

export async function seedIfEmpty() {
  const { count } = (await db.prepare("SELECT COUNT(*) as count FROM centres").get()) as { count: number };

  if (count === 0) {
    await insertSeedListings();
    await insertSeedPlaceSuggestions();
    return;
  }

  const { count: placeSuggestionCount } = (await db.prepare("SELECT COUNT(*) as count FROM place_suggestions").get()) as { count: number };
  if (placeSuggestionCount === 0) await insertSeedPlaceSuggestions();

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
