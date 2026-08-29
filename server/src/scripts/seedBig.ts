import "dotenv/config";
import { backfillCentreClubCoords, db, initSchema } from "../db/index.js";
import { resetDemoListings } from "../db/seed.js";
import { seedBigDemoData } from "../db/seedBig.js";
import { backfillSlugs } from "../slugify.js";

// "Huge data" demo seed (see db/seedBig.ts's own comment for the full
// rationale) — resets centres/clubs to the now-larger CENTRES/CLUBS list in
// db/seed.ts, then layers residents/circles/games/club-sessions/programs/
// experiences on top so every browse/discovery surface has real volume to
// show, not just the original 2-and-2 demo set.
await initSchema();
await resetDemoListings();
await seedBigDemoData();
// Same reasoning as resetDemo.ts: slugs/coords are normally backfilled once
// at server boot, which already ran before this script wiped/reinserted
// these rows — re-run both here so this always leaves a fully-backfilled
// dataset without needing a server restart first.
await backfillSlugs();
await backfillCentreClubCoords();

const counts = await Promise.all(
  [
    "centres",
    "clubs",
    "residents",
    "circles",
    "games",
    "club_sessions",
    "programs",
    "experiences",
  ].map(async (table) => {
    const { count } = (await db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get()) as { count: number };
    return `${count} ${table}`;
  })
);
console.log(`Big demo seed complete: ${counts.join(", ")}.`);
process.exit(0);
