import { approximateCoords, db } from "./index.js";
import { createUser, findUserByEmail } from "../auth.js";
import { CLUBS } from "./seed.js";

// "Huge data" demo seed — a much larger, cross-cutting pass on top of
// resetDemoListings()'s narrower centres/clubs-only scope. Deliberately its
// own module/script rather than folded into resetDemoListings(), which
// documents on purpose that it "doesn't touch residents/games/circles...
// this app has never pre-seeded a resident identity anywhere" — that
// invariant matters for the normal reset-demo flow (fast, narrow, safe to
// run constantly while iterating on centre/club UI). This is the opposite:
// a slower, one-off pass meant to make every browse/discovery surface
// (Home, Explore, Games, Circles, Adventures, Experiences, Local Activity)
// look like a real, busy platform rather than a two-listing demo.
//
// Every id this seeds is prefixed "demo-" so re-running is idempotent — see
// wipeBigDemoData() below, which deletes by that prefix rather than
// truncating whole tables (so it never touches a real resident's own
// circles/games created by hand while testing).

function img(seed: string) {
  return `https://picsum.photos/seed/halla-${seed}/900/600`;
}
function imgs(seed: string, n: number) {
  return Array.from({ length: n }, (_, i) => `https://picsum.photos/seed/halla-${seed}-${i + 1}/900/600`);
}

/** Same picsum seed for every game/session of a given activity label — not
 * a real per-activity photo (picsum has no keyword search), but at least
 * visually *consistent*: every "Five-a-side Football" card looks the same
 * as every other one, rather than each game rolling an unrelated random
 * placeholder. */
function activityImg(label: string): string {
  return img(`activity-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
}

function isoOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Next date (>= today) that falls on `targetDow` (JS convention: 0=Sun..6=Sat) —
 * same convention club_sessions.day_of_week / queries.ts's nextOccurrence use. */
function nextDow(targetDow: number): string {
  const now = new Date();
  const diff = (targetDow - now.getUTCDay() + 7) % 7;
  return isoOffset(diff);
}

const RESIDENT_NAMES = [
  "Aoife Byrne", "Cian Murphy", "Saoirse Kelly", "Oisin Walsh", "Niamh O'Brien",
  "Conor Ryan", "Roisin Doyle", "Sean McCarthy", "Ciara Gallagher", "Darragh Fitzgerald",
  "Aisling Nolan", "Eoin Brennan", "Grainne Connolly", "Fionn Duffy", "Orla Kavanagh",
  "Cathal Maguire", "Sadhbh Boyle", "Ruairi Hayes", "Aine Whelan", "Tadhg Molloy",
];

const COUNTY_CENTRES: Record<string, string> = {
  Dublin: "c1", Cork: "c2", Galway: "c3", Limerick: "c4", Waterford: "c5",
  Kilkenny: "c7", Kerry: "c8", Sligo: "c9", Mayo: "c10", Wexford: "c11",
  Meath: "c12", Louth: "c13", Clare: "c14", Westmeath: "c15", Laois: "c16",
};
const COUNTIES = Object.keys(COUNTY_CENTRES);

// Informal/pickup activity labels — deliberately distinct from the formal
// club sports above (Games are ad hoc, not club membership), but a few
// deliberately overlap with common club sports (badminton, tennis) so
// mood-keyword filtering (server/src/routes/discover.ts's MOOD_KEYWORDS)
// still buckets them sensibly.
const ACTIVITY_POOL = [
  "Five-a-side Football", "Badminton Doubles", "Saturday Parkrun", "Couch to 5k Running Group",
  "Pickup Basketball", "Tennis Doubles", "Padel", "Yoga in the Park",
  "Board Games Night", "Coffee & Chat Meetup", "Hiking Group Walk", "Evening Cycling Spin",
  "Swimming Squad Session", "Chess Club Meetup", "Photography Walk", "Book Club Discussion",
];

// Game Detail redesign — per-activity plan content (About/What to bring/
// Good to know/Location/Cancellation). Keyed by activity label, same
// "consistent per activity, not per game" spirit as activityImg() above —
// every "Evening Cycling Spin" game shows the same realistic detail rather
// than each one rolling independent (and inconsistent) demo copy. A field
// left out here stays null on the seeded row, and the redesigned detail
// page simply omits that section — same as it would for a host-created
// game that skipped the optional field.
const ACTIVITY_DETAILS: Record<
  string,
  { description: string; equipmentNeeded?: string; durationMinutes?: number; minAge?: number; surfaceType?: string; indoorOutdoor?: "indoor" | "outdoor" | "mixed"; meetingInstructions?: string; cancellationPolicy?: string }
> = {
  "Five-a-side Football": {
    description: "A casual 5-a-side kickabout, mixed ability — we rotate teams every game.",
    equipmentNeeded: "Boots and shin pads if you have them — bibs provided.",
    durationMinutes: 60,
    surfaceType: "Astro turf",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet pitch-side at the 5-a-side cage.",
    cancellationPolicy: "Free to cancel any time before kickoff — just let the group know if you drop out.",
  },
  "Badminton Doubles": {
    description: "Friendly doubles, mixed ability — we rotate partners between games.",
    equipmentNeeded: "Bring your own racket if you have one; a few spares available.",
    durationMinutes: 60,
    surfaceType: "Indoor court",
    indoorOutdoor: "indoor",
    meetingInstructions: "Meet at the sports hall reception.",
    cancellationPolicy: "Cancel up to 2 hours before — court costs are split among whoever shows.",
  },
  "Saturday Parkrun": {
    description: "A free, timed 5k — walk, jog or run at your own pace, everyone welcome.",
    equipmentNeeded: "Runners, and a barcode if you're registered with parkrun.",
    durationMinutes: 30,
    surfaceType: "Path & trail",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet at the start line 10 minutes early for the briefing.",
    cancellationPolicy: "Weather-dependent — check the parkrun page on the morning if in doubt.",
  },
  "Couch to 5k Running Group": {
    description: "A beginner-friendly running group following a gradual walk/run plan.",
    equipmentNeeded: "Comfortable runners and water.",
    durationMinutes: 40,
    surfaceType: "Path",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet at the park's main entrance.",
    cancellationPolicy: "Let the host know if you can't make it — we run rain or shine unless it's unsafe.",
  },
  "Pickup Basketball": {
    description: "Casual half-court games with rotating teams — all levels welcome.",
    equipmentNeeded: "Basketball shoes — a couple of spare balls provided.",
    durationMinutes: 60,
    surfaceType: "Indoor court",
    indoorOutdoor: "indoor",
    meetingInstructions: "Meet at the court entrance.",
    cancellationPolicy: "Free to cancel any time before the session.",
  },
  "Tennis Doubles": {
    description: "Social doubles for intermediate players.",
    equipmentNeeded: "Racket if you have one — a few spares available on request.",
    durationMinutes: 60,
    surfaceType: "Hard court",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet at the clubhouse.",
    cancellationPolicy: "Cancel up to 4 hours before so we've time to find a sub.",
  },
  Padel: {
    description: "Fast-paced doubles padel — beginners genuinely welcome.",
    equipmentNeeded: "Padel racket provided if you don't have one.",
    durationMinutes: 60,
    surfaceType: "Padel court",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet at the padel courts reception.",
    cancellationPolicy: "Cancel up to 24 hours before — court booking isn't refundable after that.",
  },
  "Yoga in the Park": {
    description: "A gentle, all-levels flow ending with a short relaxation.",
    equipmentNeeded: "A mat or towel, and a water bottle.",
    durationMinutes: 45,
    surfaceType: "Grass",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet by the bandstand.",
    cancellationPolicy: "Weather-dependent — we move indoors nearby if it's raining.",
  },
  "Board Games Night": {
    description: "A relaxed evening of board and card games — bring a favourite or just show up.",
    equipmentNeeded: "Nothing needed — a few games provided, bring your own if you'd like.",
    durationMinutes: 120,
    indoorOutdoor: "indoor",
    meetingInstructions: "Meet in the community room.",
    cancellationPolicy: "Free to cancel any time — just let the host know.",
  },
  "Coffee & Chat Meetup": {
    description: "A casual meetup over coffee — no agenda, just good company.",
    durationMinutes: 60,
    indoorOutdoor: "indoor",
    meetingInstructions: "Meet inside — we'll grab a table near the window.",
    cancellationPolicy: "No need to cancel in advance — just come along if you're free.",
  },
  "Hiking Group Walk": {
    description: "A relaxed, social walk at an easy-to-moderate pace, taking in the local trails.",
    equipmentNeeded: "Comfortable walking shoes, water, and a rain jacket just in case.",
    durationMinutes: 90,
    surfaceType: "Trail",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet at the main car park.",
    cancellationPolicy: "Weather-dependent — check for updates on the morning if conditions look rough.",
  },
  "Evening Cycling Spin": {
    description: "An easy-paced evening cycle at a social pace — we stick together as a group.",
    equipmentNeeded: "Your bike, helmet, water bottle and lights if you have them.",
    durationMinutes: 60,
    surfaceType: "Road & trail",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet at the car park, ready to roll out on time.",
    cancellationPolicy: "Free to cancel any time before the ride — weather calls are made on the day.",
  },
  "Swimming Squad Session": {
    description: "A structured lane-swimming session for confident swimmers.",
    equipmentNeeded: "Swimwear, goggles and a towel.",
    durationMinutes: 45,
    minAge: 16,
    indoorOutdoor: "indoor",
    meetingInstructions: "Meet at the pool reception 10 minutes before.",
    cancellationPolicy: "Cancel up to 2 hours before — pool entry isn't refunded after that.",
  },
  "Chess Club Meetup": {
    description: "Casual games and a bit of coaching for newer players.",
    equipmentNeeded: "Nothing needed — boards and clocks provided.",
    durationMinutes: 90,
    indoorOutdoor: "indoor",
    meetingInstructions: "Meet in the community room.",
    cancellationPolicy: "Free to cancel any time.",
  },
  "Photography Walk": {
    description: "A relaxed walk around scenic spots, swapping tips as we go — all skill levels.",
    equipmentNeeded: "A camera or phone, and comfortable shoes.",
    durationMinutes: 90,
    surfaceType: "Path",
    indoorOutdoor: "outdoor",
    meetingInstructions: "Meet at the main entrance.",
    cancellationPolicy: "Weather-dependent — we'll message the group if it's called off.",
  },
  "Book Club Discussion": {
    description: "A monthly discussion of the group's current read — new members always welcome.",
    equipmentNeeded: "Just bring the book (or your thoughts, even if you didn't finish it).",
    durationMinutes: 75,
    indoorOutdoor: "indoor",
    meetingInstructions: "Meet in the community room.",
    cancellationPolicy: "Free to cancel any time.",
  },
};

// A handful of these become Circles below — persistent, not one-off.
const CIRCLE_ACTIVITIES = [
  "Five-a-side Football", "Saturday Parkrun", "Badminton Doubles", "Hiking Group Walk",
  "Board Games Night", "Coffee & Chat Meetup", "Evening Cycling Spin", "Yoga in the Park",
  "Chess Club Meetup", "Book Club Discussion",
];

// Circle Detail redesign — structured "About our community" content
// (Mission comes from the circle's own `about` text, generated above these
// three); same "consistent per activity, keyed by label" spirit as
// ACTIVITY_DETAILS. A host creating a real Circle through the app fills
// these in themselves via Circles.tsx's own "Add more detail" form — this
// is only backfilling realistic demo content for the ten seeded Circles.
const CIRCLE_ACTIVITY_DETAILS: Record<string, { whatWeDo: string; whoCanJoin: string; values: string }> = {
  "Five-a-side Football": {
    whatWeDo: "Weekly kickabouts, the occasional friendly against another local circle, and a chat after the final whistle.",
    whoCanJoin: "Anyone who enjoys football and wants a regular game — no trials, no tryouts.",
    values: "Fair play, encouragement, and everyone gets a game.",
  },
  "Saturday Parkrun": {
    whatWeDo: "A shared Saturday morning parkrun, plus coffee afterwards for whoever's up for it.",
    whoCanJoin: "Walkers, joggers and runners of any pace — we finish together, not first.",
    values: "Consistency, encouragement, and no one finishes alone.",
  },
  "Badminton Doubles": {
    whatWeDo: "Social doubles sessions with rotating partners, so everyone plays with everyone over time.",
    whoCanJoin: "Intermediate players who want a regular hit — spares and rackets available.",
    values: "Friendly competition and good sportsmanship.",
  },
  "Hiking Group Walk": {
    whatWeDo: "Regular walks around local trails, at a pace that keeps the group together.",
    whoCanJoin: "Anyone reasonably fit who enjoys the outdoors — dogs welcome on lead.",
    values: "Nobody gets left behind, and we respect the trails we walk.",
  },
  "Board Games Night": {
    whatWeDo: "A relaxed evening of board and card games, with a rotating pick of what's on the table.",
    whoCanJoin: "New and experienced players alike — games are explained on the night.",
    values: "Patience, good humour, and no sore losers.",
  },
  "Coffee & Chat Meetup": {
    whatWeDo: "A casual sit-down over coffee — no set agenda, just good conversation.",
    whoCanJoin: "Anyone local looking to meet new people in a low-key setting.",
    values: "Openness and a genuine welcome for newcomers.",
  },
  "Evening Cycling Spin": {
    whatWeDo: "Social evening cycles at a pace the group sets together, with regular regroup stops.",
    whoCanJoin: "Cyclists comfortable riding in a group — lights required after dark.",
    values: "Safety first, and we ride at the pace of our slowest rider.",
  },
  "Yoga in the Park": {
    whatWeDo: "A gentle outdoor flow session, weather permitting, followed by a few minutes of relaxation.",
    whoCanJoin: "All levels — mats not required, just bring a towel if you have one.",
    values: "Inclusivity and a judgement-free space to move.",
  },
  "Chess Club Meetup": {
    whatWeDo: "Casual games, some light coaching for newer players, and the occasional informal tournament.",
    whoCanJoin: "Anyone from complete beginners to experienced players.",
    values: "Patience, respect for the game, and helping newer players improve.",
  },
  "Book Club Discussion": {
    whatWeDo: "A monthly discussion of the group's current read, picked together the month before.",
    whoCanJoin: "Anyone who enjoys reading and discussing books — new members always welcome, even mid-book.",
    values: "Open-mindedness and respectful disagreement.",
  },
};

// Games spread across a cycle of capacity/joined combinations so Home's
// "They just need a few more people" (spotsLeft <= 3 or pending) and the
// ordinary discovery feeds both get real variety — not every game is
// almost-full, and not every game needs it spelled out.
const GAME_PATTERNS: { capacity: number; joined: number; minParticipants?: number }[] = [
  { capacity: 4, joined: 3 }, // 1 needed
  { capacity: 10, joined: 8 }, // 2 spots left
  { capacity: 8, joined: 5 }, // 3 spots left
  { capacity: 6, joined: 2, minParticipants: 5 }, // pending_participants
  { capacity: 12, joined: 12 }, // full
  { capacity: 8, joined: 3 }, // plenty of room
];

// Day offsets per county-batch of 3 games: today, the next Saturday, the
// next Sunday — guarantees every county contributes to both "Happening
// today" and "This weekend" (discover.ts's own bucketing), not just an
// arbitrary future date.
function gameOffsets(): number[] {
  const now = new Date();
  const dow = now.getUTCDay();
  const satOffset = (6 - dow + 7) % 7 || 7;
  const sunOffset = (0 - dow + 7) % 7 || 7;
  return [0, satOffset, sunOffset];
}

// distance/elevation are only meaningful for on-foot outings — a kayaking/
// surfing/coasteering trip legitimately has neither, so those entries leave
// them undefined rather than a fabricated number (ExperienceDetail only
// renders the "What to expect"/"Details" fields that are actually set).
const ADVENTURES = [
  { title: "Wicklow Way Guided Hike", area: "Roundwood", county: "Wicklow", difficulty: "moderate", duration: 300, price: 3500, capacity: 10, distanceKm: 16, elevationGainM: 550, terrainType: "Trail & mountain" },
  { title: "Cliffs of Moher Coastal Walk", area: "Doolin", county: "Clare", difficulty: "easy", duration: 180, price: 2500, capacity: 14, distanceKm: 8, elevationGainM: 150, terrainType: "Coastal path" },
  { title: "Killarney Lakes Kayaking", area: "Killarney", county: "Kerry", difficulty: "moderate", duration: 210, price: 4500, capacity: 8, distanceKm: 12, terrainType: "Lake" },
  { title: "Glendalough Sunrise Trek", area: "Glendalough", county: "Wicklow", difficulty: "hard", duration: 360, price: 4000, capacity: 8, distanceKm: 18, elevationGainM: 700, terrainType: "Mountain trail" },
  { title: "Connemara Mountain Scramble", area: "Clifden", county: "Galway", difficulty: "hard", duration: 330, price: 4800, capacity: 6, distanceKm: 14, elevationGainM: 850, terrainType: "Rocky mountain" },
  { title: "Dingle Peninsula Surf Lesson", area: "Dingle", county: "Kerry", difficulty: "easy", duration: 150, price: 3000, capacity: 10, terrainType: "Beach" },
  { title: "Donegal Sea Cliffs Coasteering", area: "Malin Head", county: "Donegal", difficulty: "moderate", duration: 200, price: 5000, capacity: 8, terrainType: "Sea cliffs" },
  { title: "Comeragh Mountains Night Hike", area: "Dungarvan", county: "Waterford", difficulty: "moderate", duration: 240, price: 3200, capacity: 12, distanceKm: 12, elevationGainM: 500, terrainType: "Mountain trail" },
];

const EXPERIENCES = [
  { title: "Dublin Food Market Tasting Tour", area: "Temple Bar", county: "Dublin", price: 4500, capacity: 12 },
  { title: "Cork Pottery Wheel Workshop", area: "Cork City", county: "Cork", price: 5500, capacity: 8 },
  { title: "Galway Trad Music Session Night", area: "Galway City", county: "Galway", price: 2000, capacity: 20 },
  { title: "Limerick Sourdough Baking Class", area: "Limerick City", county: "Limerick", price: 6000, capacity: 8 },
  { title: "Waterford Crystal Engraving Taster", area: "Waterford City", county: "Waterford", price: 4000, capacity: 10 },
  { title: "Kilkenny Medieval Walking Tour", area: "Kilkenny City", county: "Kilkenny", price: 1800, capacity: 15 },
  { title: "Sligo Photography Golden Hour Walk", area: "Sligo Town", county: "Sligo", price: 3000, capacity: 10 },
  { title: "Dublin Rooftop Yoga & Brunch", area: "Docklands", county: "Dublin", price: 3800, capacity: 14 },
];

const PROGRAMS_ON_CENTRES: { title: string; centreId: string; price: number; capacity: number; ageRange: string }[] = [
  { title: "After-School Multi-Sport Camp", centreId: "c1", price: 6000, capacity: 20, ageRange: "6-12" },
  { title: "Toddler Sensory Play Sessions", centreId: "c2", price: 800, capacity: 12, ageRange: "1-3" },
  { title: "Beginner Pottery Workshop Series", centreId: "c6", price: 12000, capacity: 10, ageRange: "16+" },
  { title: "Community First Aid Course", centreId: "c8", price: 4500, capacity: 16, ageRange: "18+" },
];

const PROGRAMS_ON_CLUBS: { title: string; clubId: string; price: number; capacity: number; ageRange: string }[] = [
  { title: "Na Fianna Summer Camp", clubId: "s1", price: 8000, capacity: 30, ageRange: "6-12" },
  { title: "Cabra Celtic Adult Beginners", clubId: "s2", price: 5000, capacity: 18, ageRange: "18+" },
  { title: "Galway Dolphins Intensive Squad", clubId: "s3", price: 15000, capacity: 12, ageRange: "10-16" },
  { title: "Cork Harlequins Skills Academy", clubId: "s4", price: 9000, capacity: 20, ageRange: "8-14" },
];

const DEMO_VENDORS = [
  { email: "demo-vendor-adventures@hellocircle-demo.ie", name: "Wild Atlantic Adventures" },
  { email: "demo-vendor-experiences@hellocircle-demo.ie", name: "Dublin Experience Co" },
];

async function findOrCreateVendor(email: string, name: string): Promise<string> {
  const existing = await findUserByEmail(email);
  if (existing) return existing.id;
  const user = await createUser(email, "demo-password-123", name, "vendor", "approved", {
    vendorType: "community",
    businessName: name,
    address: "",
    county: "Dublin",
    mobile: "",
    description: `${name} — seeded demo vendor account.`,
  });
  return user.id;
}

/** Deletes every row this module seeds, by its "demo-" id prefix (or, for
 * child tables with their own non-prefixed ids, by the parent id prefix) —
 * never a blanket TRUNCATE, so re-running this alongside real hand-tested
 * data (a resident's own Circle, a game created through the UI) is safe. */
async function wipeBigDemoData() {
  await db.transaction(async (tx) => {
    await tx.prepare(`DELETE FROM game_updates WHERE game_id LIKE 'demo-game-%'`).run();
    await tx.prepare(`DELETE FROM game_participants WHERE game_id LIKE 'demo-game-%'`).run();
    await tx.prepare(`DELETE FROM games WHERE id LIKE 'demo-game-%'`).run();
    await tx.prepare(`DELETE FROM circle_members WHERE circle_id LIKE 'demo-circle-%'`).run();
    await tx.prepare(`DELETE FROM circles WHERE id LIKE 'demo-circle-%'`).run();
    await tx.prepare(`DELETE FROM club_sessions WHERE id LIKE 'demo-club-session-%'`).run();
    await tx.prepare(`DELETE FROM program_sessions WHERE id LIKE 'demo-program-session-%'`).run();
    await tx.prepare(`DELETE FROM programs WHERE id LIKE 'demo-program-%'`).run();
    await tx.prepare(`DELETE FROM experience_sessions WHERE id LIKE 'demo-experience-session-%'`).run();
    await tx.prepare(`DELETE FROM experience_images WHERE experience_id LIKE 'demo-experience-%'`).run();
    await tx.prepare(`DELETE FROM experiences WHERE id LIKE 'demo-experience-%'`).run();
    await tx.prepare(`DELETE FROM residents WHERE id LIKE 'demo-resident-%'`).run();
  });
}

async function seedResidents(): Promise<string[]> {
  const insert = db.prepare(
    `INSERT INTO residents (id, email, name, home_county, onboarding_completed, host_status) VALUES (?, ?, ?, ?, 1, ?)`
  );
  const ids: string[] = [];
  for (const [i, name] of RESIDENT_NAMES.entries()) {
    const id = `demo-resident-${i + 1}`;
    const county = COUNTIES[i % COUNTIES.length];
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}.${i + 1}@hellocircle-demo.ie`;
    // Every 5th resident is a "verified host" — enough to show the badge in
    // a few game cards without every single game host having one.
    await insert.run(id, email, name, county, i % 5 === 0 ? "verified" : "none");
    ids.push(id);
  }
  return ids;
}

async function seedCircles(residentIds: string[]) {
  const insertCircle = db.prepare(
    `INSERT INTO circles (id, name, activity_label, area, county, about, centre_id, created_by_resident_id, status, image_url, what_we_do, who_can_join, circle_values)
     VALUES (@id, @name, @activityLabel, @area, @county, @about, @centreId, @creator, 'active', @image, @whatWeDo, @whoCanJoin, @values)`
  );
  const insertMember = db.prepare(
    `INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, ?)`
  );
  for (const [i, activity] of CIRCLE_ACTIVITIES.entries()) {
    const county = COUNTIES[i % COUNTIES.length];
    const centreId = COUNTY_CENTRES[county];
    const id = `demo-circle-${i + 1}`;
    const creator = residentIds[i % residentIds.length];
    const details = CIRCLE_ACTIVITY_DETAILS[activity];
    await insertCircle.run({
      id,
      name: `${county} ${activity} Circle`,
      activityLabel: activity,
      area: county === "Dublin" ? "Dublin City" : county,
      county,
      about: `A regular group for ${activity.toLowerCase()} in ${county} — new members always welcome.`,
      centreId,
      creator,
      image: img(id),
      whatWeDo: details?.whatWeDo ?? null,
      whoCanJoin: details?.whoCanJoin ?? null,
      values: details?.values ?? null,
    });
    // Real bug fix while touching this insert: circle_members.role must be
    // 'organiser' to match what routes/circles.ts actually checks
    // (isOrganiser(), the members-preview sort order) — this previously
    // inserted 'owner', which silently meant no seeded circle's creator
    // was ever recognized as its organiser (no Close/Invite panel, no
    // "You organise this Circle" state, wrong avatar sort order).
    await insertMember.run(id, creator, "organiser");
    const memberCount = 4 + (i % 5); // 4-8 additional members
    for (let m = 0; m < memberCount; m++) {
      const resident = residentIds[(i + m + 1) % residentIds.length];
      if (resident === creator) continue;
      await insertMember.run(id, resident, "member").catch(() => {});
    }
  }
}

async function seedGames(residentIds: string[]) {
  const insertGame = db.prepare(
    `INSERT INTO games (id, host_resident_id, activity_label, centre_id, location_text, date, time, capacity, status, min_participants, visibility, image_url,
                         description, equipment_needed, duration_minutes, min_age, surface_type, indoor_outdoor, meeting_instructions, cancellation_policy)
     VALUES (@id, @hostResidentId, @activityLabel, @centreId, '', @date, @time, @capacity, @status, @minParticipants, 'public', @image,
             @description, @equipmentNeeded, @durationMinutes, @minAge, @surfaceType, @indoorOutdoor, @meetingInstructions, @cancellationPolicy)`
  );
  const insertParticipant = db.prepare(
    `INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`
  );

  const offsets = gameOffsets();
  const times = ["09:00", "11:00", "13:00", "17:30", "18:30", "19:30", "20:00"];
  let gameIndex = 0;

  for (const [countyIndex, county] of COUNTIES.entries()) {
    const centreId = COUNTY_CENTRES[county];
    for (const offset of offsets) {
      // Pattern index is phased by county, not just gameIndex - gameIndex
      // alone advances in lockstep with `offset`'s position (0/1/2 within
      // every county's loop), so every county's "today" game always landed
      // on the same 1-2 patterns out of 6, every "this Saturday" game on the
      // next 1-2, and so on. That made almost every near-term game show the
      // same "needs people" CTA (all the actually-available patterns only
      // ever fell on Sunday) - the `+ countyIndex` phase shift breaks that
      // correlation so each date gets a real mix of states across counties.
      const pattern = GAME_PATTERNS[(gameIndex + countyIndex) % GAME_PATTERNS.length];
      const activity = ACTIVITY_POOL[gameIndex % ACTIVITY_POOL.length];
      const id = `demo-game-${gameIndex + 1}`;
      const host = residentIds[gameIndex % residentIds.length];
      const status = pattern.minParticipants && pattern.joined < pattern.minParticipants ? "pending_participants" : "open";
      const details = ACTIVITY_DETAILS[activity];

      await insertGame.run({
        id,
        hostResidentId: host,
        activityLabel: activity,
        centreId,
        date: isoOffset(offset),
        time: times[(gameIndex + countyIndex) % times.length],
        capacity: pattern.capacity,
        status,
        minParticipants: pattern.minParticipants ?? null,
        image: activityImg(activity),
        description: details?.description ?? null,
        equipmentNeeded: details?.equipmentNeeded ?? null,
        durationMinutes: details?.durationMinutes ?? null,
        minAge: details?.minAge ?? null,
        surfaceType: details?.surfaceType ?? "",
        indoorOutdoor: details?.indoorOutdoor ?? "",
        meetingInstructions: details?.meetingInstructions ?? null,
        cancellationPolicy: details?.cancellationPolicy ?? null,
      });

      // Host always counts as one of the joined participants — same
      // real-world semantics as routes/games.ts's own create-game flow.
      const participants = new Set<string>([host]);
      let p = 0;
      while (participants.size < pattern.joined) {
        participants.add(residentIds[(gameIndex + p) % residentIds.length]);
        p++;
        if (p > residentIds.length * 2) break; // safety valve, never expected to trigger
      }
      for (const residentId of participants) {
        await insertParticipant.run(id, residentId);
      }

      gameIndex++;
    }
  }
}

// A handful of games get a demo "Latest update" (Game Detail redesign §25)
// so that module has something real to show rather than only ever being
// exercised by hand — the vast majority of games still have none, same as
// a real host who hasn't needed to post one.
async function seedGameUpdates() {
  const insert = db.prepare(`INSERT INTO game_updates (game_id, message) VALUES (?, ?)`);
  await insert.run("demo-game-1", "Meeting point changed — we'll meet by the north gate instead of the main entrance.");
  await insert.run("demo-game-12", "Starting 15 minutes later than listed — see you at the later time.");
}

async function seedClubSessions() {
  const insert = db.prepare(
    `INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, active, image_url) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  );
  const times = ["17:00", "17:30", "18:00", "18:30", "19:00"];
  for (const [i, club] of CLUBS.entries()) {
    await insert.run(`demo-club-session-${club.id}`, club.id, i % 7, times[i % times.length], null, `${club.sport} Training`, activityImg(club.sport));
  }
}

async function seedPrograms() {
  const insertProgram = db.prepare(
    `INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, age_range, price_cents, capacity, status, image_url)
     VALUES (@id, @listingType, @listingId, @vendorId, @title, @description, @ageRange, @price, @capacity, 'published', @image)`
  );
  const insertSession = db.prepare(
    `INSERT INTO program_sessions (id, program_id, date, time, duration_minutes, status) VALUES (?, ?, ?, ?, ?, 'scheduled')`
  );
  const offsets = gameOffsets();
  const vendorId = await findOrCreateVendor(DEMO_VENDORS[1].email, DEMO_VENDORS[1].name);

  let i = 0;
  for (const p of PROGRAMS_ON_CENTRES) {
    const id = `demo-program-${i + 1}`;
    await insertProgram.run({
      id,
      listingType: "centre",
      listingId: p.centreId,
      vendorId,
      title: p.title,
      description: `${p.title} — a seeded demo program for local dev/browse testing.`,
      ageRange: p.ageRange,
      price: p.price,
      capacity: p.capacity,
      image: img(id),
    });
    await insertSession.run(`demo-program-session-${id}-1`, id, isoOffset(offsets[0]), "16:00", 60);
    await insertSession.run(`demo-program-session-${id}-2`, id, isoOffset(offsets[1]), "10:00", 90);
    i++;
  }
  for (const p of PROGRAMS_ON_CLUBS) {
    const id = `demo-program-${i + 1}`;
    await insertProgram.run({
      id,
      listingType: "club",
      listingId: p.clubId,
      vendorId,
      title: p.title,
      description: `${p.title} — a seeded demo program for local dev/browse testing.`,
      ageRange: p.ageRange,
      price: p.price,
      capacity: p.capacity,
      image: img(id),
    });
    await insertSession.run(`demo-program-session-${id}-1`, id, isoOffset(offsets[0]), "16:30", 60);
    await insertSession.run(`demo-program-session-${id}-2`, id, isoOffset(offsets[2]), "11:00", 90);
    i++;
  }
}

async function seedExperiences() {
  const insertExperience = db.prepare(
    `INSERT INTO experiences (id, vendor_id, kind, title, area, county, lat, lng, meeting_point, blurb, description, difficulty, duration_minutes,
       distance_km, elevation_gain_m, terrain_type,
       fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms,
       price_cents, capacity, image_url, status)
     VALUES (@id, @vendorId, @kind, @title, @area, @county, @lat, @lng, @meetingPoint, @blurb, @description, @difficulty, @duration,
       @distanceKm, @elevationGainM, @terrainType,
       '', '', '', '', '', '', '', '', 'Free cancellation up to 48 hours before.', @price, @capacity, @image, 'approved')`
  );
  const insertImage = db.prepare(`INSERT INTO experience_images (experience_id, url, sort_order) VALUES (?, ?, ?)`);
  const insertSession = db.prepare(
    `INSERT INTO experience_sessions (id, experience_id, date, time, capacity, status) VALUES (?, ?, ?, ?, ?, 'scheduled')`
  );

  const offsets = gameOffsets();
  const adventureVendor = await findOrCreateVendor(DEMO_VENDORS[0].email, DEMO_VENDORS[0].name);
  const experienceVendor = await findOrCreateVendor(DEMO_VENDORS[1].email, DEMO_VENDORS[1].name);

  let n = 0;
  for (const a of ADVENTURES) {
    const id = `demo-experience-${n + 1}`;
    const { lat, lng } = approximateCoords(a.county, id);
    await insertExperience.run({
      id,
      vendorId: adventureVendor,
      kind: "adventure",
      title: a.title,
      area: a.area,
      county: a.county,
      lat,
      lng,
      meetingPoint: `${a.area} trailhead car park`,
      blurb: `${a.title} — a guided ${a.difficulty}-difficulty outing near ${a.area}.`,
      description: `Join a small guided group for ${a.title.toLowerCase()}. Suitable for a ${a.difficulty} fitness level, all safety equipment briefed on the day.`,
      difficulty: a.difficulty,
      duration: a.duration,
      distanceKm: a.distanceKm ?? null,
      elevationGainM: a.elevationGainM ?? null,
      terrainType: a.terrainType ?? "",
      price: a.price,
      capacity: a.capacity,
      image: img(id),
    });
    for (const [i, url] of imgs(id, 4).entries()) await insertImage.run(id, url, i);
    await insertSession.run(`demo-experience-session-${id}-1`, id, isoOffset(offsets[1]), "09:00", a.capacity);
    await insertSession.run(`demo-experience-session-${id}-2`, id, isoOffset(offsets[1] + 7), "09:00", a.capacity);
    n++;
  }
  for (const e of EXPERIENCES) {
    const id = `demo-experience-${n + 1}`;
    const { lat, lng } = approximateCoords(e.county, id);
    await insertExperience.run({
      id,
      vendorId: experienceVendor,
      kind: "experience",
      title: e.title,
      area: e.area,
      county: e.county,
      lat,
      lng,
      meetingPoint: `${e.area} — exact address on booking confirmation`,
      blurb: `${e.title} — a small-group experience in ${e.area}.`,
      description: `${e.title}, run in small groups so everyone gets proper attention. No experience necessary — just bring yourself.`,
      difficulty: "",
      duration: 120,
      distanceKm: null,
      elevationGainM: null,
      terrainType: "",
      price: e.price,
      capacity: e.capacity,
      image: img(id),
    });
    for (const [i, url] of imgs(id, 4).entries()) await insertImage.run(id, url, i);
    await insertSession.run(`demo-experience-session-${id}-1`, id, isoOffset(offsets[0]), "18:00", e.capacity);
    await insertSession.run(`demo-experience-session-${id}-2`, id, isoOffset(offsets[2]), "14:00", e.capacity);
    n++;
  }
}

/** The big, cross-cutting demo data pass — residents, circles, games,
 * club sessions, programs and experiences/adventures, on top of whatever
 * centres/clubs already exist (run resetDemoListings() first if those also
 * need refreshing — this function doesn't touch centres/clubs itself).
 * Safe to re-run: wipes its own "demo-" prefixed rows first. */
export async function seedBigDemoData() {
  await wipeBigDemoData();
  const residentIds = await seedResidents();
  await seedCircles(residentIds);
  await seedGames(residentIds);
  await seedGameUpdates();
  await seedClubSessions();
  await seedPrograms();
  await seedExperiences();
}
