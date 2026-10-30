// Read-only privacy review counts (docs/participation-expansion/18 §2).
//
//   npm run privacy-counts --workspace server                    # hello_circle_dev only
//   npm run privacy-counts --workspace server -- --allow-db=<name>  # any other database, named explicitly
//
// Prints counts only (never a note, answer, name, email or reference). The
// session and the transaction are READ ONLY, so the database itself refuses
// any write; the transaction is rolled back. Uses its own connection (the app's
// schema set-up never runs). Run it only with credentials you are authorised
// to use for that environment.
import "dotenv/config";
import mysql from "mysql2/promise";
import { privacyCounts } from "../privacyCounts.js";

const allow = process.argv.find((a) => a.startsWith("--allow-db="))?.slice("--allow-db=".length);
const dbName = process.env.DB_NAME ?? "hello_circle";
if (dbName !== "hello_circle_dev" && dbName !== allow) {
  console.error(`Refusing to read "${dbName}". Run on hello_circle_dev, or name another database explicitly with --allow-db=${dbName}.`);
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: dbName,
});
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  await conn.query("START TRANSACTION READ ONLY");
  const result = await privacyCounts(async (sql, params) => (await conn.query(sql, params ?? []))[0] as Record<string, unknown>[], dbName);
  await conn.query("ROLLBACK");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await conn.end();
}
