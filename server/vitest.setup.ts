import "dotenv/config";

// CRITICAL safety guard (added after an incident during this same hardening
// pass: running `vitest` directly, without going through `npm run dev`,
// never loads server/.env on its own — only server/src/index.ts does
// `import "dotenv/config"` at its very top. Without this setup file, tests
// silently fell back to db/index.ts's own hardcoded default `DB_NAME`,
// which is "hello_circle" — the PROD database, per CLAUDE.md's "Dev vs.
// prod database" section — and wrote/deleted real rows there.
//
// This setup file (a) loads .env exactly like the real server does, so
// tests run against the same hello_circle_dev the rest of local dev uses,
// and (b) hard-fails immediately, before any test can run, if the resolved
// database name is ever the literal prod name — a second, enforced line of
// defense in case .env itself is ever missing or misconfigured.
const dbName = process.env.DB_NAME;
if (!dbName || dbName === "hello_circle") {
  throw new Error(
    `Refusing to run tests: DB_NAME resolved to "${dbName ?? "(unset, defaults to hello_circle)"}", which is the PROD database. ` +
      `Tests must run against hello_circle_dev — check that server/.env exists and sets DB_NAME=hello_circle_dev.`
  );
}
