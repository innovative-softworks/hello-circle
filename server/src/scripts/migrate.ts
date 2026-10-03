// Explicit, idempotent schema migration (Phase 11 staging readiness).
//
// The app has always migrated implicitly: `initSchema()` runs at server
// startup (CREATE TABLE IF NOT EXISTS + additive ensureColumn backfills, no
// down-migrations). This script runs the SAME `initSchema()` as a separate,
// observable step — before a deploy restarts the app — and proves it:
//   1. prints the target database identity (never credentials),
//   2. refuses the production database name unless --allow-production,
//   3. fingerprints the schema before, after one run, and after a second run
//      (the second run must change nothing — idempotency),
//   4. lists the tables/columns the run added.
// It never seeds demo data or the admin account.
//
//   npm run migrate --workspace server                 # uses server/.env DB_*
//   npm run migrate --workspace server -- --dry-run    # identity + current fingerprint only
import "dotenv/config";
import crypto from "node:crypto";
import { db, initSchema } from "../db/index.js";

type Col = { table_name: string; column_name: string; column_type: string; is_nullable: string };

async function snapshot() {
  const cols = (await db
    .prepare(
      `SELECT table_name AS table_name, column_name AS column_name, column_type AS column_type, is_nullable AS is_nullable
       FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`
    )
    .all()) as Col[];
  const set = new Set(cols.map((c) => `${c.table_name}.${c.column_name} ${c.column_type} ${c.is_nullable}`));
  // Order-independent: an upgraded database appends new columns (ensureColumn)
  // where a fresh one declares them inline — same schema, different order.
  const fingerprint = crypto.createHash("sha256").update([...set].sort().join("\n")).digest("hex").slice(0, 16);
  const tables = new Set(cols.map((c) => c.table_name));
  return { set, fingerprint, tables, columns: cols.length };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const identity = (await db.prepare(`SELECT DATABASE() AS db, CURRENT_USER() AS account, VERSION() AS version`).get()) as { db: string; account: string; version: string };
  console.log(`[migrate] target database=${identity.db} account=${identity.account} server=${identity.version}`);
  if (!identity.db) throw new Error("No database selected (DB_NAME).");
  if (identity.db === "hello_circle" && !args.has("--allow-production")) {
    throw new Error("Refusing to migrate the production database name 'hello_circle' without --allow-production.");
  }
  const before = await snapshot();
  console.log(`[migrate] before: ${before.tables.size} tables, ${before.columns} columns, fingerprint ${before.fingerprint}`);
  if (args.has("--dry-run")) return;

  await initSchema();
  const after = await snapshot();
  const addedTables = [...after.tables].filter((t) => !before.tables.has(t));
  const addedColumns = [...after.set].filter((c) => !before.set.has(c) && !addedTables.includes(c.split(".")[0]));
  console.log(`[migrate] after:  ${after.tables.size} tables, ${after.columns} columns, fingerprint ${after.fingerprint}`);
  if (addedTables.length) console.log(`[migrate] added tables (${addedTables.length}): ${addedTables.join(", ")}`);
  if (addedColumns.length) console.log(`[migrate] added/changed columns (${addedColumns.length}):\n  ${addedColumns.join("\n  ")}`);

  await initSchema();
  const again = await snapshot();
  if (again.fingerprint !== after.fingerprint) throw new Error(`Not idempotent: fingerprint changed on a second run (${after.fingerprint} → ${again.fingerprint}).`);
  console.log(`[migrate] idempotency check: second run changed nothing (fingerprint ${again.fingerprint}).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`[migrate] FAILED: ${e instanceof Error ? e.message : "unknown error"}`);
    process.exit(1);
  });
