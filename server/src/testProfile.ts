// HC-QA-092 — the guard every server unit-test process passes before any test
// (vitest.setup.ts) or test seeding (scripts/testDbSeed.ts) runs. Layered on
// purpose — a name pattern alone isn't trusted:
//   1. explicit profile marker + NODE_ENV=test (set only by testIsolated.ts),
//   2. database name must be hello_circle_test_<runid>; the production and
//      development names are refused outright,
//   3. loopback database host only,
//   4. no real provider credentials present (payments, email, media, auth),
//   5. a live check that the connected database carries the identity marker
//      row for THIS run id — proof it is the disposable database the runner
//      just created, not merely one with a matching name.
import mysql from "mysql2/promise";

const PROVIDER_VARS = [
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
  "SMTP_HOST", "SMTP_USER", "SMTP_PASS",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT",
  "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
  "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY",
];

export function isolatedServerTestProfileIssues(env: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  if (env.HC_SERVER_TEST_PROFILE !== "isolated") issues.push("HC_SERVER_TEST_PROFILE is not 'isolated' — run `npm test --workspace server` (scripts/testIsolated.ts)");
  if (env.NODE_ENV !== "test") issues.push("NODE_ENV must be 'test'");
  const runId = env.HC_SERVER_TEST_RUN_ID ?? "";
  if (!/^[a-f0-9]{12}$/.test(runId)) issues.push("HC_SERVER_TEST_RUN_ID missing or malformed");
  const db = env.DB_NAME ?? "";
  if (db === "hello_circle" || db === "hello_circle_dev") issues.push(`DB_NAME '${db}' is a production/development database`);
  if (db !== `hello_circle_test_${runId}`) issues.push("DB_NAME must be hello_circle_test_<HC_SERVER_TEST_RUN_ID>");
  if (!["127.0.0.1", "localhost", "::1"].includes(env.DB_HOST ?? "")) issues.push("DB_HOST must be loopback");
  if (env.HC_LIVE_PROVIDER_TESTS === "1" && !/(^|[-_.])(staging|stage|test|qa)([-_.]|$)/i.test(env.R2_BUCKET ?? "")) {
    issues.push("HC_LIVE_PROVIDER_TESTS=1 requires an R2_BUCKET name that is clearly staging/test/QA (never the production bucket)");
  }
  if (env.HC_LIVE_PROVIDER_TESTS !== "1") {
    const present = PROVIDER_VARS.filter((k) => (env[k] ?? "").trim() !== "");
    if (present.length) issues.push(`real provider configuration present: ${present.join(", ")} (values not shown)`);
  }
  return issues;
}

export async function assertIsolatedServerTestProfile(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const issues = isolatedServerTestProfileIssues(env);
  if (issues.length) throw new Error(`Refusing to run server tests:\n  - ${issues.join("\n  - ")}`);
  const conn = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT ?? 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  try {
    const [rows] = await conn.query("SELECT DATABASE() AS db, (SELECT run_id FROM hc_server_test_identity LIMIT 1) AS runId");
    const row = (rows as { db: string; runId: string | null }[])[0];
    if (row?.db !== env.DB_NAME || row?.runId !== env.HC_SERVER_TEST_RUN_ID) throw new Error("connected database is not this run's disposable test database");
  } catch (e) {
    throw new Error(`Refusing to run server tests: database identity check failed (${e instanceof Error ? e.message.split("\n")[0] : "unknown"})`);
  } finally {
    await conn.end();
  }
}
