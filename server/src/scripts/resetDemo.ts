import "dotenv/config";
import { db, initSchema } from "../db/index.js";
import { resetDemoListings } from "../db/seed.js";

await initSchema();
await resetDemoListings();
const { count: centres } = (await db.prepare("SELECT COUNT(*) as count FROM centres").get()) as { count: number };
const { count: clubs } = (await db.prepare("SELECT COUNT(*) as count FROM clubs").get()) as { count: number };
console.log(`Demo listings reset: ${centres} community centres, ${clubs} sports clubs seeded.`);
process.exit(0);
