// Usage: npm exec --workspace server tsx src/scripts/backfillLegacySnapshots.ts [--apply] [--limit=500]
// Dry run unless --apply. Refuses the production database (hello_circle)
// unless APP_ENV=production AND --i-have-approval are both given.
import { initSchema } from "../db/index.js";
import { backfillLegacySnapshots } from "../commerce/backfill.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;
const dbName = process.env.DB_NAME ?? "hello_circle";
if (apply && dbName === "hello_circle" && !(process.env.APP_ENV === "production" && args.includes("--i-have-approval"))) {
  console.error("Refusing to write to the production database without APP_ENV=production and --i-have-approval.");
  process.exit(2);
}
await initSchema();
const report = await backfillLegacySnapshots({ dryRun: !apply, limit });
console.log(JSON.stringify({ database: dbName, ...report }, null, 2));
process.exit(0);
