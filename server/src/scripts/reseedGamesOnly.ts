import "dotenv/config";
import { db, initSchema } from "../db/index.js";
import { seedBigDemoData } from "../db/seedBig.js";
import { backfillSlugs } from "../slugify.js";

// Scoped variant of seedBig.ts's own script - regenerates only what
// seedBigDemoData() itself owns (demo-prefixed residents/circles/games/club
// sessions/programs/experiences), without also calling resetDemoListings()
// first (which wipes centres/clubs/bookings/registrations/reviews/
// notifications too). Use this when only the games/circles/etc. layer needs
// regenerating - e.g. after changing GAME_PATTERNS or its assignment logic
// in seedBig.ts - without touching anything reset-demo/seed-big's centre
// and club reset would otherwise disturb.
await initSchema();
await seedBigDemoData();
await backfillSlugs();

const counts = await Promise.all(
  ["residents", "circles", "games", "club_sessions", "programs", "experiences"].map(async (table) => {
    const { count } = (await db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get()) as { count: number };
    return `${count} ${table}`;
  })
);
console.log(`Games-only reseed complete: ${counts.join(", ")}.`);
process.exit(0);
