# Server tests

```bash
npm run test --workspace server
```

Minimal Vitest suite added in the post-audit hardening pass, targeting the audit's stated priorities only (not broad coverage):

- `src/capacity.test.ts` — pure unit tests, no DB.
- `src/routes/games.test.ts` — real-DB concurrency test for the `POST /:id/join` row lock.
- `src/routes/registrations.test.ts` — real-DB concurrency + unlimited-capacity tests for the session-level lock.
- `src/routes/stripeWebhook.test.ts` — real-DB idempotency test for the `confirm*` webhook handlers (exported from `stripeWebhook.ts` specifically so tests can call them directly, without reconstructing a signed Stripe event).

## Requires a running MySQL pointed at `hello_circle_dev`

Row-lock/concurrency behavior (`SELECT ... FOR UPDATE`) can't be meaningfully tested against a mock — these tests run against a real database, using the exact same connection env vars as normal dev (`server/.env`: `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`).

**`vitest.setup.ts` loads `.env` and hard-fails immediately if `DB_NAME` isn't set, or resolves to the literal prod database name (`hello_circle`).** This exists because `db/index.ts`'s own hardcoded fallback *is* `hello_circle` — running `vitest` directly (bypassing `npm run dev`, which is the only place `dotenv/config` normally gets loaded) silently connects to prod otherwise. This actually happened once while writing this suite; see the setup file's own comment.

If you ever need to point tests at a specific test database instead of your regular dev one, set `DB_NAME` before running (e.g. `DB_NAME=hello_circle_test npm run test --workspace server` — just never the literal prod name).

Test data is namespaced with a `test-`/`test-*-<uuid>` id prefix and cleaned up in each file's `afterAll`. If a run crashes before `afterAll` completes, look for leftover `test-%` rows (residents/games/clubs/etc — grep each test file's `beforeAll` for the exact ids) and remove them by hand.

Known minor gap: `registrations.ts`'s checkout handler fires its booking/registration notification without `await`ing it (a deliberate fast-response design choice, not a bug) — occasionally that insert lands in the `notifications` table a moment after `registrations.test.ts`'s `afterAll` has already run its cleanup delete, leaving one stray row. Harmless and dev-only; not worth an artificial delay in the test to close.
