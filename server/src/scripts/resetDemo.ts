import "dotenv/config";
import { backfillCentreClubCoords, db, initSchema } from "../db/index.js";
import { resetDemoListings } from "../db/seed.js";
import { backfillSlugs } from "../slugify.js";

await initSchema();
await resetDemoListings();
// resetDemoListings() re-inserts centres/clubs with no slug/lat/lng — both
// are normally backfilled once at server boot (index.ts/initSchema()),
// which already ran *before* the reset above wiped and reinserted these
// rows. Re-run both here so a reset always leaves the demo set fully
// backfilled, not just after the next full server restart.
await backfillSlugs();
await backfillCentreClubCoords();
const { count: centres } = (await db.prepare("SELECT COUNT(*) as count FROM centres").get()) as { count: number };
const { count: clubs } = (await db.prepare("SELECT COUNT(*) as count FROM clubs").get()) as { count: number };
console.log(`Demo listings reset: ${centres} community centres, ${clubs} sports clubs seeded.`);
process.exit(0);
