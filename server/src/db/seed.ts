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
const CENTRES: SeedCentre[] = [
  { id: "c1", name: "St. Brigid's Community Hall", area: "Stoneybatter, Dublin 7", county: "Dublin", rating: 4.8, reviews: 126, capacity: 180, from: 22, managedBy: "Dublin City Council", ph: "repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)", image: img("c1"), blurb: "A bright, recently refurbished hall in the heart of Stoneybatter. Popular for birthday parties, community meetings and indoor sports, with a sprung timber floor, full kitchen and its own car park.", amenities: ["Wheelchair accessible", "Full kitchen", "Free parking (20 spaces)", "Fast Wi-Fi", "Stage & PA system", "Tables & chairs included"], rooms: [{ id: "r1", name: "Main Hall", cap: 180, rate: 65, desc: "Sprung floor, stage" }, { id: "r2", name: "Function Room", cap: 60, rate: 38, desc: "Carpeted, kitchen access" }, { id: "r3", name: "Meeting Room", cap: 20, rate: 22, desc: "Boardroom, screen" }] },
  { id: "c2", name: "Ballincollig Community Centre", area: "Ballincollig, Cork", county: "Cork", rating: 4.6, reviews: 89, capacity: 250, from: 18, managedBy: "Cork County Council", ph: "repeating-linear-gradient(135deg,#DEE6E9 0 14px,#E7EDEF 14px 28px)", image: img("c2"), blurb: "A large multi-purpose centre serving west Cork. The sports hall doubles as a function space for weddings and cultural events, with generous parking and step-free access throughout.", amenities: ["Wheelchair accessible", "Commercial kitchen", "Free parking (60 spaces)", "Wi-Fi", "Changing rooms", "Tables & chairs included"], rooms: [{ id: "r1", name: "Sports Hall", cap: 250, rate: 70, desc: "Full-size courts, high ceiling" }, { id: "r2", name: "Function Room", cap: 120, rate: 45, desc: "Bar area, dance floor" }, { id: "r3", name: "Small Room", cap: 15, rate: 18, desc: "Classes & workshops" }] },
  { id: "c3", name: "Salthill Community Hall", area: "Salthill, Galway", county: "Galway", rating: 4.9, reviews: 154, capacity: 140, from: 28, managedBy: "Galway City Council", ph: "repeating-linear-gradient(135deg,#DBE7E6 0 14px,#E5EDEC 14px 28px)", image: img("c3"), blurb: "Steps from the promenade, this seafront hall is a favourite for naming ceremonies and family functions, with big windows framing Galway Bay and a warm, welcoming committee.", amenities: ["Wheelchair accessible", "Kitchen facilities", "On-street parking", "Wi-Fi", "Sea-view windows", "Tables & chairs included"], rooms: [{ id: "r1", name: "Ocean Room", cap: 140, rate: 60, desc: "Bay views, wood floor" }, { id: "r2", name: "Studio", cap: 30, rate: 28, desc: "Mirrored, for dance & yoga" }] },
  { id: "c4", name: "Dooradoyle Parish Centre", area: "Dooradoyle, Limerick", county: "Limerick", rating: 4.5, reviews: 61, capacity: 200, from: 22, managedBy: "the local Parish", ph: "repeating-linear-gradient(135deg,#E4E3DA 0 14px,#EAE9E1 14px 28px)", image: img("c4"), blurb: "A dependable, spacious parish hall used for everything from First Communion parties to community development meetings. Simple, affordable and central to the southside.", amenities: ["Wheelchair accessible", "Kitchen facilities", "Free parking", "Wi-Fi", "Foldable staging", "Tables & chairs included"], rooms: [{ id: "r1", name: "Main Hall", cap: 200, rate: 55, desc: "Open span, PA available" }, { id: "r2", name: "Committee Room", cap: 25, rate: 22, desc: "Meetings & small groups" }] },
  { id: "c5", name: "Ferrybank Community Centre", area: "Ferrybank, Waterford", county: "Waterford", rating: 4.7, reviews: 73, capacity: 160, from: 26, managedBy: "a Community Development Group", ph: "repeating-linear-gradient(135deg,#E1E6DE 0 14px,#E9EDE6 14px 28px)", image: img("c5"), blurb: "Run by an energetic local development group, Ferrybank hosts everything from toddler groups to cultural nights. Flexible layouts and very friendly rates.", amenities: ["Wheelchair accessible", "Kitchen facilities", "Free parking", "Wi-Fi", "Projector & screen", "Tables & chairs included"], rooms: [{ id: "r1", name: "Main Hall", cap: 160, rate: 50, desc: "Multi-use, projector" }, { id: "r2", name: "Activity Room", cap: 35, rate: 26, desc: "Workshops & classes" }] },
  { id: "c6", name: "Phibsborough Community Hub", area: "Phibsborough, Dublin 7", county: "Dublin", rating: 4.8, reviews: 198, capacity: 120, from: 24, managedBy: "a Local Community Association", ph: "repeating-linear-gradient(135deg,#DDE8DA 0 14px,#E6EEE3 14px 28px)", image: img("c6"), blurb: "A stylish modern hub above the local library, ideal for workshops, cultural events and smaller functions. Excellent transport links and a bright, contemporary interior.", amenities: ["Wheelchair accessible", "Tea & coffee station", "Bike parking", "Fast Wi-Fi", "AV & screen", "Tables & chairs included"], rooms: [{ id: "r1", name: "Event Space", cap: 120, rate: 58, desc: "Floor-to-ceiling windows" }, { id: "r2", name: "Workshop Room", cap: 24, rate: 24, desc: "Flexible seating" }] },
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

export function seedIfEmpty() {
  const { count } = db.prepare("SELECT COUNT(*) as count FROM centres").get() as { count: number };

  if (count === 0) {
    const insertCentre = db.prepare(
      `INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, created_at)
       VALUES (@id, @name, @area, @county, @rating, @reviews, @capacity, @from, @managedBy, @ph, @image, @blurb, datetime('now'))`
    );
    const insertAmenity = db.prepare(
      `INSERT INTO centre_amenities (centre_id, amenity, sort_order) VALUES (?, ?, ?)`
    );
    const insertCentreImage = db.prepare(
      `INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`
    );
    const insertRoom = db.prepare(
      `INSERT INTO rooms (id, centre_id, name, cap, rate, desc, sort_order) VALUES (@id, @centreId, @name, @cap, @rate, @desc, @sortOrder)`
    );
    const insertClub = db.prepare(
      `INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, created_at)
       VALUES (@id, @name, @sport, @area, @county, @ages, @price, @unit, @trial, @ph, @image, @blurb, datetime('now'))`
    );
    const insertInclude = db.prepare(
      `INSERT INTO club_includes (club_id, item, sort_order) VALUES (?, ?, ?)`
    );
    const insertClubImage = db.prepare(
      `INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`
    );

    const tx = db.transaction(() => {
      for (const c of CENTRES) {
        insertCentre.run(c);
        c.amenities.forEach((a, i) => insertAmenity.run(c.id, a, i));
        c.rooms.forEach((r, i) => insertRoom.run({ ...r, centreId: c.id, sortOrder: i }));
        imgs(c.id).forEach((url, i) => insertCentreImage.run(c.id, url, i));
      }
      for (const c of CLUBS) {
        insertClub.run({ ...c, trial: c.trial ? 1 : 0 });
        c.includes.forEach((item, i) => insertInclude.run(c.id, item, i));
        imgs(c.id).forEach((url, i) => insertClubImage.run(c.id, url, i));
      }
    });
    tx();
    return;
  }

  // Database was seeded before image_url existed — backfill it in place.
  const backfillCentre = db.prepare(
    `UPDATE centres SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')`
  );
  const backfillClub = db.prepare(
    `UPDATE clubs SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')`
  );
  const tx = db.transaction(() => {
    for (const c of CENTRES) backfillCentre.run(c.image, c.id);
    for (const c of CLUBS) backfillClub.run(c.image, c.id);
  });
  tx();

  // Database was seeded before centre_images/club_images existed — backfill
  // a handful of extra gallery photos for each originally-seeded listing.
  const { count: centreImgCount } = db.prepare("SELECT COUNT(*) as count FROM centre_images").get() as {
    count: number;
  };
  if (centreImgCount === 0) {
    const insertCentreImage = db.prepare(`INSERT INTO centre_images (centre_id, url, sort_order) VALUES (?, ?, ?)`);
    const insertClubImage = db.prepare(`INSERT INTO club_images (club_id, url, sort_order) VALUES (?, ?, ?)`);
    const tx2 = db.transaction(() => {
      for (const c of CENTRES) imgs(c.id).forEach((url, i) => insertCentreImage.run(c.id, url, i));
      for (const c of CLUBS) imgs(c.id).forEach((url, i) => insertClubImage.run(c.id, url, i));
    });
    tx2();
  }
}

const ADMIN_EMAIL = process.env.HELLO_CIRCLE_ADMIN_EMAIL || "admin@hellocircle.ie";
const ADMIN_PASSWORD = process.env.HELLO_CIRCLE_ADMIN_PASSWORD || "changeme123";

/** Seeds a single admin account on first run. Prototype-only credential
 * source — swap for a real provisioning step before this ever goes live. */
export function seedAdminIfMissing() {
  if (findUserByEmail(ADMIN_EMAIL)) return;
  createUser(ADMIN_EMAIL, ADMIN_PASSWORD, "Hello Circle Admin", "admin", "approved");
  console.log(`Seeded admin account: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (set HELLO_CIRCLE_ADMIN_EMAIL/HELLO_CIRCLE_ADMIN_PASSWORD to change)`);
}
