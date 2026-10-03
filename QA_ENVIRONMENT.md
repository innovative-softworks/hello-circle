# HelloCircle QA environment contract

## Recovery — 2026-10-02 (Phase 10, current environment)

Docker Desktop had stopped, so the tmpfs container `hellocircle-qa_7a01b2c0c87998f1` had exited (137) and its volatile database was gone. Because the guarded `qa:db:reset` needs a live connected preflight, the same Method B as the 2026-10-01 recovery was used:
- the manifest was moved (not deleted) to `.qa-data/qa_7a01b2c0c87998f1/retired-docker-stopped-manifest.json`;
- the stopped container and network were left in place;
- a fresh run was provisioned with the existing `npm run qa:db:setup` and seeded with `npm run qa:db:seed`.

The new database is `hello_circle_e2e_qa_91df0fb79128a998`, on the same loopback ports. No guard, assertion or credential source changed.

Phase 10 exploratory testing used a **separate** throwaway stack (labelled `ie.hellocircle.explore=1`): a tmpfs MySQL on 127.0.0.1:13307 and a Mailpit SMTP sink on 127.0.0.1:11025/18025. Its credentials lived in the session scratchpad. The backend ran on :4411 and Vite on :4478. These containers are disposable and are not part of the QA contract.

## Recovery — 2026-10-01 (current environment)

Fresh isolated run provisioned through the existing qa:db:setup after verifying and
retiring only the old QA container whose private configuration was missing.
Current database: `hello_circle_e2e_qa_7a01b2c0c87998f1`; restricted user
`hello_circle_qa@%`; loopback 127.0.0.1:13306; tmpfs data. New random QA-only
credentials, no borrowed credentials or guard changes. Offline configuration checks,
connected identity/grants/marker checks and deterministic seed all passed.
Root used only by existing provisioning; never by application/tests.

Both private files were generated with mode 0600 outside the repository. The
gitignored manifest points to their OS-temporary directory. Do not remove them
after test execution or copy them into source. Missing-file cause remains UNKNOWN.
See QA_ENVIRONMENT_RECOVERY.md for exact recovery boundaries and QA_REPORT.md for
current test/sign-off results. HC-QA-002..021 are fixed locally, not deployed;
older open-finding/environment statements below are historical.

## Phase 4 — verified local isolation (historical)

The local QA chain is now verified: **Chromium → real React/Vite → real Express routes/middleware → isolated MySQL**. Application API responses are not mocked in `qa:auth`. This section supersedes the historical Phase 2 status below; staging remains unverified and production/shared development remain forbidden.

**Latest security checkpoint:** Phase 4 adds real RBAC/ownership tests using the same disposable environment. HC-QA-002 remains fixed locally, historically P0, not deployed. HC-QA-003/004/005 are separate open findings; see `QA_REPORT.md` and `QA_AUTHORIZATION_MATRIX.md`. No production/development database or external provider was used.

| Component | Current QA configuration | Verification / limit |
|---|---|---|
| Frontend | `http://127.0.0.1:4178` | Dedicated Vite config; no application `.env`; real `/api` proxy |
| Backend | `http://127.0.0.1:4311` | Real application; no reuse of an existing listener; QA wrapper forces loopback |
| Database | `hello_circle_e2e_qa_91c6dd08741f075d` | Per-run naming follows existing QA contract; exact database/server UUID/marker checked |
| MySQL | Cached `mysql:8.0` image, pinned to inspected image ID per run | Dedicated labelled Docker container/network; not the machine's local MySQL |
| DB connection | `127.0.0.1:13306`, `hello_circle_qa` | Exact inspected loopback binding; no root credential in application/tests |
| Data lifetime | `/var/lib/mysql` in container tmpfs | Disposable; lost when container stops. Never treat as durable storage |
| Credentials | Generated per run in mode-0700 OS temporary directory; files mode 0600 | Passwords are not printed, committed, copied from development or written into repo fixtures |
| Authentication | Real bcrypt, resident/vendor sessions and full middleware | All four persona UI logins passed; no auth bypass or injected identity |
| Stripe / Firebase / cloud providers | Absent | All Stripe keys, including test keys, refused for this profile |
| Media | Local `.qa-data/<run-id>` | No production storage touched; media integration not exercised |
| Email | No SMTP configuration; application fallback logging suppressed | Probe creates a local verification token but sends no customer/provider email |
| Maps / other external requests | Disabled; external browser requests aborted | Backend socket boundary permits only QA MySQL; no external-service coverage |
| Safe scope | Guarded local auth/persona/security fixtures only | Does not approve staging, production, root `npm test`, payments or full IDOR |

### Isolation design and evidence

The repository uses raw `mysql2` with its own async query wrapper, not an ORM. `server/src/db/index.ts:initSchema` is the schema/migration mechanism; it is reused rather than duplicated. `createResidentWithPassword`, `createUser`, and production bcrypt cost are reused for persona seeding. The generic demo reset/seed routines are not run.

MySQL root is used **only for initial provisioning inside the newly created, identity-checked disposable container**, never by migrations, seeding, backend or tests. The runtime/migration account has SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER and INDEX on the **literal escaped QA schema only**, no global privileges beyond USAGE, no GRANT OPTION and no access to the protected databases. The connected guard checks actual grants and visible databases, not just environment strings.

Docker's internal-only network did not publish the loopback port in this installation; the guard rejected that first bootstrap before application schema/persona creation. Only that failed disposable container/network was removed. The working design uses a dedicated bridge and inspected loopback-only port publication. **The database network is not claimed to be an air gap.** Backend external connection denial is enforced by the test-only wrapper; browser external requests are blocked separately.

The connected read-only preflight checks configuration, Docker image/container IDs and labels, mounts, network and port, `DATABASE()`, `CURRENT_USER()`, `@@server_uuid`, grants, database visibility and the unique run marker. It reports schema presence separately. Backend startup additionally queries its actual application pool before schema startup, and each real test checks that identity through the frontend proxy. Attestation exists only in the test wrapper, not the production application.

One narrow application change in `server/src/index.ts` skips demo/default-admin seeding only when **both** `NODE_ENV=test` and `QA_E2E_ENABLED=true`. QA seeds explicit personas first. Normal development/production startup is unchanged; production authentication logic is unchanged. Schema initialization and normal startup backfills still run in QA, so backend startup remains mutation-capable and guarded.

### Lifecycle commands

Prerequisites: Docker Desktop running, cached MySQL 8.0 image, installed dependencies/Chromium, free ports 13306/4311/4178. Do not load `server/.env` into the shell. No Docker pull or system MySQL account changes are hidden in setup.

```sh
npm run qa:db:setup
npm run qa:preflight -- --current
npm run qa:preflight:connected
npm run qa:db:seed
npm run qa:auth
```

- `qa:db:setup`: refuses an existing run manifest; provisions only a new labelled container, restricted user and marker. Does not seed the application.
- `qa:preflight -- --current`: reads generated inputs **offline**. Exit 2 means configuration accepted but this command grants no connected/mutation approval; exit 1 means invalid configuration. Bare `qa:preflight` retains `.env.test`/shell behavior and currently refuses missing configuration.
- `qa:preflight:connected`: **read-only**, exit 0 on verified database/container/grants. It never seeds/resets and does not by itself prove a running backend's identity.
- `qa:db:seed`: independently rechecks connected isolation, verifies the real application's pool, reuses `initSchema`, creates/verifies personas. Repeatable without replacing IDs/passwords or globally deleting rows.
- `qa:auth`: rechecks isolation, starts sanitized fresh frontend/backend processes, uses one worker and zero retries. CLI accepts only `--list`, `--grep` and `--grep-invert`; callers cannot enable traces or replace safety configuration. Default includes the original unchanged, now-passing security regression. Four bounded batches (core, collisions, flows, recovery) each get a fresh backend; the production rate limiter is not disabled. A batch failure stops the command. Real Vite has a separate ignored optimizer cache to avoid colliding with mocked/dev Vite.
- `qa:db:reset`: independently checks isolation and other QA DB connections, disposes the exact verified container and its volatile DB/network, retains recovery metadata and provisions an empty new run. **All data in that QA container is irrecoverable; re-run seed afterward.** No DROP/TRUNCATE/global DELETE against a configured database. Reset was exercised before the final security reproduction; current evidence was not reset.

Seed/reset/auth use an exclusive `.qa-data/operation.lock`. Never clear a stale lock without checking the recorded process has exited and no QA backend/test is running. A stopped tmpfs container or incomplete bootstrap may fail identity verification by design; do not weaken the guard or substitute development credentials to recover. Inspect exact labelled resources before any manual cleanup.

### Personas and secrets

| Persona | Seeded model/state | Verified |
|---|---|---|
| QA_USER | Resident, verified email, completed onboarding, host status none | DB + real UI login + refresh/logout |
| QA_HOST | Separate resident, verified email/onboarding, host status verified | DB + real UI login + `/manage` |
| QA_VENDOR | Approved `users.role=vendor` | DB + real UI login + vendor API; normal schema startup supplies organisation linkage |
| QA_ADMIN | Approved `users.role=admin` | DB + real UI login + admin stats API; no destructive admin actions |
| Suspended control | Synthetic suspended vendor | Correct password rejected with 403; no vendor access |

QA_USER_B / QA_HOST_B / QA_VENDOR_B are now seeded and verified using the same generated-secret contract. The paired vendors have distinct non-null organisations, verified by the ownership test after real backend startup. The suspended control uses the generated QA_VENDOR_B password. A scenario-local approved vendor staff identity exercises the actual `read_only_analyst` role and is removed afterwards. Cross-owner tests use separate real login sessions, not injected authentication. The passwordless security probe remains unchanged.

`qa:authorization` shares the connected guard, run lock, network restrictions and fresh-backend batches with `qa:auth`. Exact test-created resource IDs scope fixture cleanup; connected identity is rechecked before cleanup. No global DELETE/reset is part of the suite. Booking fixtures are unpaid and authorization-only. External storage is disabled; media permission rejection is not upload/delivery coverage. The HC-QA-004 diagnostic imports only the email module in a separate process with a synthetic canary and a production-mode flag; it never starts a production backend or connects to any database/provider.

Required variables remain the application-native DB_* / PORT / CLIENT_URL / DATA_DIR and the existing QA/E2E variables in `.env.test.example`; no alternate database URL system was introduced. Generated credentials are passed as environment variables to sanitized child processes. The ignored `.qa-data/current.json` is a local run locator, not configuration for a deployment. Do not copy it or secret-directory files into CI artifacts. Authentication state stays in isolated in-memory contexts; no storageState credentials are persisted.

### Remaining limits and next decision

No Stripe/payment, booking mutations, media-provider, Firebase, email-delivery or full IDOR work. No broad server Vitest invocation against the shared database. No CI workflow was changed; existing mobile workflow compatibility remains unresolved. The narrow HC-QA-002 fix and unchanged original regression now pass; review the completed remediation before approving owner/outsider fixture expansion. Potential concurrent reset-token replay and non-SMTP secret-link logging remain separate hardening findings. HC-QA-001 remains P1/open and separate.

## Historical Phase 2 contract (superseded where noted above)

## Decision and scope

**Database isolation is not verified. No existing environment is approved for automated mutations.** Continue to use the fast mocked frontend suite. This checkpoint audits configuration, strengthens offline safety checks, and plans real authentication/authorization. It does not start the backend, connect to a database, seed/reset data, create accounts, or exercise external services. HC-QA-001 remains open; its UI fix is outside this execution's stop condition.

The audit read environment files locally and emitted only classifications (loopback/remote, test/live prefix, configured/unset). No credential, token, private key, actual customer address, or external storage identifier is included here. File configuration is evidence of intent, not proof of the running process, database grants, provider account ownership, or deployment settings.

## Environment inventory

| Environment | Frontend URL | Backend URL | Database | Authentication | Stripe mode | Storage | Email | Maps / external services | Safe for automated tests? |
|---|---|---|---|---|---|---|---|---|---|
| Current local development (`server/.env`, `client/.env`) | Normally `http://localhost:5173` | Normally `http://localhost:3001`; Vite proxies `/api` and `/uploads` | Loopback, `hello_circle_dev`, root DB user; password unset in file | Real vendor/admin and resident sessions; Firebase server/client configuration present | `sk_test_` prefix observed; account/webhook pairing unverified | R2 selected, R2 and Cloudinary credentials present; no isolated `DATA_DIR` | SMTP configuration present; can send outside Vitest | Mapbox token and Firebase client config present; default public Nominatim geocoder | **NO for mutation integration.** Shared development DB plus external credentials; no isolation proof |
| Development template (`server/.env.development`) | Loopback `CLIENT_URL` | Default port 3001 unless process overrides | `hello_circle_dev`, root DB user | Real cookie sessions when started | Unset | Default local `server/uploads`; shared directory | SMTP configuration present | Server Firebase/R2 absent in this file, but client `.env` independently enables providers | **NO**; not a dedicated QA environment |
| Staging | No verified origin found | No verified deployment found | Unknown | Unknown | Unknown | Unknown | Unknown | `DEPLOY.md` mentions staging/preview launch gating, not isolated resources | **UNVERIFIED / BLOCKED** |
| Production-intent file (`server/.env.production`) | Remote origin configured; value intentionally omitted | Single-origin deployment documented | Loopback `hello_circle`, root DB user in file | Same session implementation; deployed `NODE_ENV` controls secure cookies | Unset in file; deployed value unknown | Default local storage in file; deployed value unknown | SMTP configuration present | Server launch mode public; deployed provider settings unknown | **NEVER a mutation target** |
| Current mocked QA (`npm run qa:smoke`) | `http://127.0.0.1:4177` | None; API calls intercepted, no Vite proxy | None | Synthetic anonymous API responses | None | No uploads; local/stub images | None | Firebase/Mapbox disabled, external images/styles stubbed | **YES for mocked browser tests only** |
| Existing server Vitest | No application browser | Per-test HTTP servers | Loads `server/.env`; blocks only absent DB name or literal `hello_circle` | Many suites inject `req.user`/`req.resident`; selected tests use real cookies | Depends on test stubs/env | Depends on test stubs/env | `VITEST` explicitly suppresses SMTP sending | Not a global egress sandbox | **Not approved in this checkpoint**; shared DB writes/cleanup remain |
| Proposed local real QA | `http://127.0.0.1:4178` | `http://127.0.0.1:4311` | Separate disposable MySQL instance on `127.0.0.1:13306`; database `hello_circle_e2e_<run-id>` | Real bcrypt + real cookies + real middleware; per-run synthetic personas | Disabled for initial auth/security checkpoint, including test keys | `MEDIA_PROVIDER=local`; dedicated `.qa-data/<run-id>`; cloud credentials absent | Disabled/log-only for password login; isolated sink in a later mail checkpoint | Firebase/push off; Mapbox off; local geocoder stub; external egress denied | **PROPOSED, NOT PROVISIONED** |

`NODE_ENV` was not set to a recognized value in the inspected server env files. It may be injected by a launcher/deployment. A filename `.env.production` does not set it automatically. Likewise, `NODE_ENV=test` alone does not make email, Stripe, Firebase, R2 or the database safe.

## Source-backed wiring and startup behavior

- `client/src/api/core.ts` fetches relative `/api...` with cookies and `X-Client-Id`. There is no general frontend API-origin env variable in this client. `client/vite.config.ts` proxies `/api` and `/uploads` to `http://localhost:3001`.
- `server/src/index.ts` imports `dotenv/config`, then initializes schema, seeds demo listings/admin, backfills slugs and starts the waitlist sweep before/around listening. **Starting the backend is a write operation.** It listens on `PORT` (default 3001) without an explicit bind host, so network isolation must also constrain the process/container.
- `server/src/db/index.ts` creates a MySQL pool at import time. Defaults: loopback:3306, user root, database **`hello_circle`**. Validate before dynamically importing this module; never import first and check later.
- `switch-db.sh` copies a development/production file over `server/.env`. QA must not use it or replace the developer's active configuration.
- Production is documented as Express serving built client files from `client/dist`, with a reverse proxy. A QA Vite config will need a separate proxy to port 4311; do not change the normal developer proxy or consume a previously built client containing environment-specific provider settings.
- `client/capacitor.config.ts` currently has a local WebView override at `http://localhost:3001`. Native testing is a separate target; this is not staging evidence.
- `server/src/stripe.ts` accepts any configured secret key and builds a client; it does not enforce test mode. `CLIENT_URL` drives email and Checkout URLs. Disable Stripe entirely for initial auth/security work.
- `server/src/email.ts` sends when SMTP host/user/password are configured except under `VITEST`. **Playwright does not set that flag for the backend.** Missing SMTP means log-only (logs may contain reset/magic-link tokens and need private retention). An unauthenticated mail sink is not plug-and-play because current code requires SMTP credentials to create a transport; defer mail flows until a sink-compatible setup is validated.
- `server/src/media/config.ts` supports local/R2 and optional Cloudinary editorial storage. R2 requested with missing settings falls back locally outside production. Both provider credentials and `DATA_DIR` must be explicitly controlled; choosing local does not itself erase Cloudinary credentials.
- `server/src/firebaseApp.ts` initializes Firebase Admin from project/email/private-key configuration; Google verification and push share it. `server/src/push.ts` can send and prune push tokens. Disable Firebase and start with no device tokens.
- `client/src/googleSignIn.ts` uses Firebase popup, redirect fallback and `getRedirectResult`, then sends ID tokens to HelloCircle APIs. There is no generic server OAuth redirect callback to invent.
- `server/src/routes/geocode.ts` defaults to public Nominatim. `GEOCODER_BASE_URL` is configurable. Mapbox additionally depends on build-time client settings and `/api/config`'s DB-backed kill switch. Seed `maps_enabled=false` and block provider egress.
- `client/src/analytics.ts` loads Google Tag Manager only after consent. QA must intercept/block telemetry even when testing cookie acceptance; do not emit QA traffic to real analytics.
- `server/src/routes/ask.ts` is rule-based search over the database; no external LLM service is used on that path. It does not require a new AI test credential.

## Safety layers

### Implemented in this checkpoint

The existing Playwright foundation remains intact. Strengthen its configuration/request guard to reject production process mode, production hostname aliases, credentials and non-allowlisted API spellings. Error messages use `QA ABORTED` and never echo supplied values.

Add an **offline configuration preflight** for the proposed local auth profile. It checks an explicit QA flag/profile, `NODE_ENV=test`, reserved loopback URLs/ports, a run-specific QA DB name, restricted QA username/non-empty password, exact local upload directory, disabled cloud/email/payment credentials and disabled client providers. It reads only `.env.test` plus explicit process overrides, never `server/.env` or `client/.env`.

Preflight is a necessary configuration check, **not verification of actual DB isolation**. It must never report the environment ready to mutate. Exit 1 means invalid/unsafe configuration; exit 2 means configuration checks passed but provisioning/runtime isolation is still unverified. It performs no network calls or writes. `qa:e2e` continues to reject any mutation/integration mode.

### Required before any future integration mutation

1. Create a separate disposable MySQL instance with no production volume, network route or credential. A new schema on the shared root-access server is a weaker fallback and is not selected here. Docker and MySQL executables are installed; daemon availability, image availability, engine version and privileges have not been checked.
2. Provision with a one-shot administrator identity confined to that instance. The API and test fixtures use a dedicated user restricted to the one run database; no global grants, `FILE`, `SUPER`, grant option or cross-schema access. Do not reuse production/dev root credentials.
3. Before migrations or imports, compare configuration against the run manifest. After connecting with the scoped user, read `SELECT DATABASE()`, `CURRENT_USER()`, engine identity and grants; reject unexpected databases/accounts/privileges. Enumerate visible application schemas and confirm canonical/development schemas are absent from the isolated instance. No such query was executed here.
4. Bind the API to an isolated network/loopback forwarding boundary. Start from an allowlisted child-process environment; never inherit a complete parent env or allow implicit `dotenv/config` to load `server/.env`. Pin its dotenv path to the isolated QA file and verify precedence before importing application code.
5. Bind an unguessable run nonce to the provisioned instance and API process. Proposed QA-only runtime attestation should report run identity, database identity and disabled service modes from the actual pool/process, be accessible only to the harness, and be unavailable in production. Flags supplied by the runner are not independent proof. This attestation and launcher are **not implemented** yet.
6. Resolve `DATA_DIR` with `realpath`, verify it belongs to the run directory (no symlinks into production), and verify no production mounts/buckets exist. Enforce outbound network denial at the process/container boundary; browser routing alone cannot stop backend SMTP/cloud calls.
7. Verify persona login resolves to the seeded IDs/orgs; only then run account/resource mutations. Require the same manifest checks before cleanup. Unknown, failed or stale proof aborts the run.

Do not relax these checks to accept the currently configured local backend. Initial auth profile rejects **all** Stripe keys; a future reviewed sandbox profile must additionally verify provider account identity and test/livemode on returned objects, not merely a key prefix.

## Database strategy, schema reuse and cleanup

Use a fresh disposable instance/database **per run**, initially one worker. This avoids residue after crashes and races between fixtures. Reuse `initSchema()` and actual domain helpers after preflight/provisioning checks; do not create a second schema or manually omit additive migrations/backfills.

`initSchema()` is not a read-only migration inventory: it performs DDL and backfills. The normal server also calls `seedIfEmpty()` and `seedAdminIfMissing()`. Before the next implementation, choose an explicit QA bootstrap that initializes schema and seeds a small dataset before starting the normal server. The actual seed predicate checks `centres` count; even with a centre present, it seeds `place_suggestions` if empty and performs image backfills. Account for these writes in the minimal fixture manifest, or add a narrowly scoped QA bootstrap seam in that next checkpoint. Supply `HELLO_CIRCLE_ADMIN_*` from QA persona inputs to prevent a default admin being created. Do not reuse the demo reset: `resetDemoListings()` contains table-wide DELETE statements.

Future seed data uses actual schema fields and APIs:

| Entity | Existing model/helpers | Minimum initial data |
|---|---|---|
| Resident/user/host | `residents`: `id`, unique `email`, `name`; migrations add `password_hash`, `terms_accepted_at`, `terms_version`, `marketing_consent`, `onboarding_completed`, `host_status`; `createResidentWithPassword` + `hashPassword` | Ordinary user A/B and host A/B, no real email/device/payment data; terms recorded; completed onboarding for auth tests and separate incomplete user when onboarding begins |
| Vendor/admin | `users`: `id`, `email`, `password_hash`, `role`, `status`, `name`; `org_id`, `platform_role`, `invited_staff` added by migration; existing `createUser` | Approved vendor A/B in **different organisations**, one admin; pending/suspended vendor and staff-role variants added when tested |
| Organisation | `organisations`, with vendor `users.org_id` relation | One organisation per owner; staff cases deliberately share only their owner's organisation |
| Place | `centres`/`clubs`, supporting rooms and child rows; vendor listing API | One minimal centre/club baseline if required to suppress demo seeding; two owned centres for vendor IDOR cases |
| Activity/session | `games`: `host_resident_id`, `activity_label`, `location_text` or `centre_id`, `date`, `time`, `capacity`, `price_cents`, `visibility`, `status`; `lifecycle` migration | One free game owned by each host; do not invent a universal activity/session table. Vendor program/experience sessions belong to different concrete models |
| Circle | `circles`: `created_by_resident_id`, `name`, `about`, `join_mode`, etc.; `circle_members`: `circle_id`, `resident_id`, `role` | One open and one invite/approval Circle; organiser A, member and non-member identities; restricted fields contain synthetic sentinel text |
| Booking | `bookings` for centre bookings; `game_participants` for game joins | Not required for first login/RBAC milestone; add owner-specific records only for booking authorization, initially free/non-Stripe where supported |

Seed once per run, create scenario-specific mutable resources per test using a unique run/test suffix, and preserve IDs in a run manifest. Do not keep a shared once-ever seed. Passwords come from env/secrets or are generated ephemerally by the future harness; never hard-code or log them. Emails must use reserved `example.test` addresses and remain unique across personas.

Do not use an outer SQL transaction for browser cleanup: HTTP requests use pooled independent connections and commit outside that transaction. Do not run global DELETE/TRUNCATE or `reset-demo`. Preferred teardown stops the API and disposes only the exact labelled QA container/ephemeral volume named in the manifest, after revalidating identity. Crash cleanup inventories only those labels/IDs, never wildcard names or production locations. Inside a long-lived QA instance, a reviewed fallback may delete exact manifest-owned IDs in dependency order, including notifications, sessions, media, analytics and audit side effects; no broad `LIKE 'test-%'` deletion on shared data.

Repeatability acceptance: two runs get different run IDs, both start from fresh DBs, create the same logical fixtures, complete with zero cross-run access, and leave no mounted QA data or cloud/email side effects after validated teardown. This is a future acceptance criterion, not an executed result.

## Persona strategy

| Persona | Actual identity | Scope |
|---|---|---|
| `QA_USER` / `QA_USER_B` | Separate `residents` rows, guest-session cookie | Own profile and participation; outsider/member scenarios |
| `QA_HOST` / `QA_HOST_B` | Separate residents owning `games.host_resident_id` and/or Circle organiser memberships | There is no global Host role. Ordinary residents can create games/Circles; ownership protects management |
| `QA_VENDOR` / `QA_VENDOR_B` | `users.role='vendor'`, approved, different `org_id` | Cross-organisation listing/operations checks |
| `QA_ADMIN` | `users.role='admin'` | Admin-only endpoints; never a substitute for ordinary auth setup |
| Staff variants (later) | Vendor with `invited_staff=1`, one of actual `platform_role` values | `centre_manager`, `facility_manager`, `finance`, `communications`, `read_only_analyst`; distinguish same-org access from cross-owner IDOR |

Initial states are not implicitly linked across resident/vendor identities. Exercise `manage` account linking separately. Storage state should be generated by real API login per run/worker, validated against `/api/guest/me` + `/api/residents/me` or `/api/auth/me`, then stored only in ignored `playwright/.auth/<run-id>/`. Fresh browser contexts per test; no unrelated role cookies. Tests that log out, expire sessions or change passwords require their own session/account and must not invalidate shared storage state.

## Real password authentication plan

| Case | Actual route/behavior | Assertions |
|---|---|---|
| Full resident browser login | `/signin` → `POST /api/guest/login` | Browser is unmocked for first-party APIs; returned resident/email matches seeded user; session cookie present; destination loads real data |
| Full vendor browser login | `/login` → `POST /api/auth/login` | Approved vendor opens vendor area; no resident/admin privilege inferred |
| Wrong password / unknown account | Resident login returns 401 `Invalid email or password`; missing fields 400 | Same public error for unknown/wrong account, no new session; do not assert nonexistent validation/status rules |
| Session persistence | `hello_circle_guest_session` in `guest_sessions`; `hello_circle_session` in `sessions` | Refresh and new context from storage state retain correct identity; unrelated personas remain separate |
| Logout | `POST /api/guest/logout`, `POST /api/auth/logout` | Cookie cleared and exact token no longer authenticates; back/refresh cannot recover protected data |
| Invalid/expired token | Real middleware checks expiry against DB time | Inject invalid cookie; expire only that test's session row through the verified fixture connection; no sleeps or broad updates |
| Cookie attributes | Both cookies HTTP-only, SameSite=Lax, secure only when `NODE_ENV=production` | Local `NODE_ENV=test` does not cover production Secure/TLS behavior; add HTTPS staging coverage separately |
| Role state | Pending vendor may log in but vendor guard returns 403; admin and vendor are distinct | Assert current guard contract and rejected side effects, not a generic “all roles use one dashboard” assumption |
| Reset/signup follow-up | Signup can send verification email; reset uses email tokens | Defer until sink is verified; include existing passwordless-account collision/ownership proof cases around `createResidentWithPassword` |

Use real `attachUser → attachGuestEmail → attachResident` and router guards. Several existing DB route tests inject identities, so they are reusable examples of data setup/assertions but do not replace this full stack. Login failures are rate-limited: use a fresh isolated process/run, a bounded set of negative cases and initially one worker; never disable production rate limiting globally.

## Authorization and IDOR plan

For each resource: A creates it via real API, B logs in independently, B sends a **valid** payload to the actual endpoint, expected rejection occurs, then A/DB confirms the record, owner and side-effect counts are unchanged. Invalid payloads that produce 400 before ownership checks are not proof of authorization. A positive owner control must also pass. There is no requirement that every resource expose GET/PUT/DELETE; use the actual action route.

| Resource/action | Real endpoints | A/B/guest checks |
|---|---|---|
| Guest/resident/vendor/admin boundaries | `/api/admin/stats`, `/api/vendor/listings`, resident protected routes | Guest and resident denied vendor/admin; a vendor identity alone does not establish a resident; follow actual 401/403 contract |
| Profile | `GET/PUT /api/residents/me`, avatar routes, `/me/export` | `/me` is session-scoped, not `/profiles/:id`; payload ID/email tampering must not update B from A's session; public `/:id/host-profile` has intentional public fields |
| Host activity | `PUT /api/games/:id`, `POST /:id/cancel`, `POST /:id/lifecycle`, participant/check-in actions | Host B / ordinary resident cannot manage A's game; public detail GET may legitimately succeed. Test private visibility separately. No invented DELETE game endpoint |
| Vendor listing | `GET/PUT/DELETE /api/vendor/centres/:id`, analogous clubs; publish/pause/room routes | Different organisations must reject B; same-org access may be intended. Keep admin checks distinct from `requireVendor` |
| Circle privacy | `GET /api/circles/:id`, `/members`, `/plan-ideas`, `/polls`, `/upcoming`; private chat | Unauthorized detail may return a **200 redacted teaser**; compare allowed fields and assert sentinel private data absent. Subresources reject outsiders, including invited-but-not-joined users |
| Circle management | `PUT /api/circles/:id`, `PUT /:id/status`, member removal and organiser actions | Member/outsider cannot edit A's settings; test remaining organiser rules. `DELETE /:id/join` is leaving membership, not deleting the Circle |
| Booking | `/api/bookings/status/:ref`, `/bookings`, `POST /:ref/cancel`, `POST /:ref/reschedule` | Owner B cannot view protected details/cancel/reschedule A; exercise both resident cookie and anonymous `X-Client-Id` paths. No invented generic booking DELETE |
| Media (later isolated storage) | `/api/media/authorize`, `/finalize`, `/release`, `/upload`, `/circles/:id/cover`; resident avatar | B cannot bind/release A's asset; restricted cover checks membership before storage delivery. No-cover 404 alone does not prove authorization: seed a cover reference to reach the guard |
| Staff roles | Vendor listing and operational routes | Use actual role names; confirm broad org reads with product policy rather than inventing a forbidden-read rule |

Never equate “user cannot access host-only resources” with forbidding all residents from hosting. The protected boundary is ownership/organiser membership. Pair metadata/API response assertions with DB side-effect checks; test unauthorized requests cannot produce audit/notification/payment/media mutations. Expand method/status coverage only where the implementation supports those methods.

## Google OAuth boundary

- Frontend initiation: popup first; closed/cancelled popup is a non-error cancellation; blocked popup falls back to redirect; `getRedirectResult` resumes after return. Test these UI branches with SDK/provider stubs and label them MOCKED.
- Server contract: Firebase Admin verifies signature and checks provider `google.com`, verified email and UID. `POST /api/guest/google`, `/google/complete`, `/api/auth/google` and explicit linking routes already have route tests. Reuse/extend those in the isolated DB; verification stubs do not constitute live Firebase coverage.
- Existing linked account may sign in; first-time resident requires explicit completion; email-only collision cannot auto-link; vendor Google login does not create an account. Verify DB rows and real HelloCircle session creation after validated identity.
- Manual/external sandbox: account chooser, real provider consent, popup/redirect behavior on browsers/native shells, authorized domains, and a dedicated Firebase project's token verification. No Google UI automation or real project credentials in initial auth QA.

## Variables and command boundaries

`.env.test.example` distinguishes current runnable mock/read-only settings from **future local auth-profile preflight inputs**. `QA_USER_*` is the canonical ordinary-resident naming for new work (older documentation proposed `QA_RESIDENT_*`, which was never consumed). No passwords or QA accounts are created in this checkpoint.

Required planned inputs: `NODE_ENV=test`, `QA_E2E_ENABLED=true`, `QA_PROFILE=auth`, `QA_RUN_ID`, frontend/API origins, `PORT`, `CLIENT_URL`, exact CORS origin, `DB_HOST/PORT/NAME/USER/PASSWORD`, run-local `DATA_DIR`, provider-disable settings, and each persona's email/password. External-service credentials must be absent, including test Stripe keys for the auth-only profile. `QA_*` flags are harness policy; production application code currently does not read them.

Keep existing `qa:smoke`, `qa:check`, `qa:e2e`, `qa:report`. Add only `qa:preflight` (offline, no mutation). Do not add aliases implying real `qa:api`/`qa:all` coverage until those suites and isolation exist. Root `npm test` still includes DB-writing server tests and is not a safe substitute for `qa:check`.

## CI recommendation and readiness

The only existing workflow is `mobile-ci.yml`, referencing `apps/mobile`; the root workspaces list no such workspace. Do not extend it blindly. After fixing HC-QA-001, a separate PR web job can run client/unit safety tests and mocked smoke. API integration requires an isolated MySQL job and fresh personas; critical E2E belongs on an explicitly identified QA/staging target. Release/provider sandbox tests are separate. No workflow changes now.

**Blocking evidence:** no `.env.test`, QA DB or run manifest; current local root DB user; live-capable SMTP/cloud/Firebase configuration; no verified staging origin/resources; no runtime identity attestation/egress boundary; no isolated seed/reset launcher. DB server/grants/version were not queried. This phase completes the environment/guard/plans checkpoint and stops for review before provisioning.
