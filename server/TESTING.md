# Server tests

```bash
npm run test --workspace server
```

Minimal Vitest suite added in the post-audit hardening pass, targeting the audit's stated priorities only (not broad coverage):

- `src/capacity.test.ts` — pure unit tests, no DB.
- `src/routes/games.test.ts` — real-DB concurrency test for the `POST /:id/join` row lock.
- `src/routes/registrations.test.ts` — real-DB concurrency + unlimited-capacity tests for the session-level lock.
- `src/routes/stripeWebhook.test.ts` — real-DB idempotency test for the `confirm*` webhook handlers (exported from `stripeWebhook.ts` specifically so tests can call them directly, without reconstructing a signed Stripe event).

## Runs only in the isolated test profile (HC-QA-092)

`npm run test --workspace server` runs `src/scripts/testIsolated.ts`, which needs **Docker** and the cached `mysql:8.0` image. It:
- starts a disposable MySQL container (tmpfs, loopback-only random port);
- creates `hello_circle_test_<runid>` plus a user scoped to it and an identity marker;
- loads the schema, demo seed and fixed fixtures (`src/scripts/testDbSeed.ts`);
- runs Vitest with a scrubbed environment;
- removes the container afterwards.

Row-lock/concurrency behaviour (`SELECT ... FOR UPDATE`) still runs against a real MySQL, just never a shared one.

**`vitest.setup.ts` does NOT load `server/.env`.** It calls `src/testProfile.ts`, which refuses to run unless all of these hold:
- the isolated profile markers are set and `NODE_ENV=test`;
- the DB name is `hello_circle_test_<runid>`; `hello_circle` and `hello_circle_dev` are refused by name;
- the DB host is loopback;
- no Stripe, SMTP, R2, Cloudinary or Firebase credentials are present;
- the connected database carries this run's identity marker row.

Running `npx vitest` directly is therefore refused. Pass a file filter through the runner instead: `npm run test --workspace server -- src/routes/games.test.ts`.

**Live-provider tests** (real R2/Cloudinary in `media`, `adminMedia`, `residents`) are skipped unless `HC_LIVE_PROVIDER_TESTS=1` is set together with provider credentials for a bucket whose name clearly identifies staging/test/QA. Never point them at production.

Test data is namespaced with a `test-`/`test-*-<uuid>` id prefix and cleaned up in each file's `afterAll`. The whole database is discarded with the container after every run, so leftovers never accumulate.

Known minor gap: `registrations.ts`'s checkout handler fires its booking/registration notification without `await`ing it (a deliberate fast-response design choice, not a bug) — occasionally that insert lands in the `notifications` table a moment after `registrations.test.ts`'s `afterAll` has already run its cleanup delete, leaving one stray row. Harmless and dev-only; not worth an artificial delay in the test to close.
