import "dotenv/config";
import { initSchema } from "../db/index.js";
import { resetDemoListings } from "../db/seed.js";

await initSchema();
await resetDemoListings();
console.log("Demo listings reset: 2 community centres, 2 sports clubs seeded.");
process.exit(0);
