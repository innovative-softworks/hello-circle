# HelloCircle — Staging environment safety checkpoint (Phase 11)

## Phase 13A — staging PROVISIONED on the shared production VPS (2026-10-04, current)

**The owner explicitly approved** hosting staging on the existing production VPS, with guardrails:
- no system-wide upgrade;
- no SSH changes;
- only additive nginx, database and service changes;
- no load testing.

This deliberately deviates from the Phase 11A "separate VPS" recommendation. A separate VPS is still recommended before public launch, because the shared host means shared CPU, memory and kernel.

| Item | Staging | Production (untouched except the firewall) |
|---|---|---|
| URL | https://staging.hellocircle.ie (DNS-only A record → VPS; HTTP Basic Auth; noindex) | https://hellocircle.ie (Cloudflare-proxied) |
| App | `/var/www/hellocircle-staging/app`, a git clone of `release/staging-phase11a` (HTTPS, public repo, no credential on disk) | `/opt/hello-circle` (not a git checkout) |
| Process | `hellocircle-staging.service`, user `hellocircle` (no login shell), `127.0.0.1:3002`, `MemoryMax=1G`, sandboxed, `Restart=on-failure` | `hello-circle.service`, user root, `*:3001` |
| Database | `hello_circle_staging`, user `hc_staging_app@localhost`; grants on that DB only, and reading `hello_circle` is denied (proven) | `hello_circle` / `hello_circle@localhost` |
| Config | `/var/www/hellocircle-staging/shared/server.env` (600, hellocircle), symlinked as `app/server/.env`; client build values in `app/client/.env.production.local` | `/opt/hello-circle/server/.env` |
| nginx | `/etc/nginx/sites-available/hellocircle-staging` (separate file) | `/etc/nginx/sites-available/hello-circle`, checksum verified unchanged |
| TLS | Let's Encrypt `staging.hellocircle.ie`, webroot `/var/www/letsencrypt`, renewal hook reloads nginx | `hellocircle.ie` certificate |
| Backups | `/usr/local/sbin/hellocircle-staging-backup` → `/var/backups/hellocircle-staging` (root 700); nightly at 03:15 (`/etc/cron.d/hellocircle-staging-backup`); 14-day retention; staging credentials only | not touched |
| Secrets | DB password, admin password and Basic Auth password generated on the server, never printed. The owner-readable copy is `/root/hellocircle-staging-admin.txt` (600) | n/a |

**Host-wide changes (approved):**
- `ufw` enabled: allow 22, 80 and 443 only. This closes HC-QA-103's public `:3001`, plus `:3002`.
- A 2 GB swapfile with `vm.swappiness=10`.
- No packages installed.

**Deploy (staging):**
1. `cd /var/www/hellocircle-staging/app`, then as `hellocircle`: `git fetch && git checkout <commit> && npm ci`.
2. `nice -n 19 npm run build`.
3. `/usr/local/sbin/hellocircle-staging-backup pre-<commit>`.
4. `npm run migrate --workspace server`. It must print `target database=hello_circle_staging`.
5. `systemctl restart hellocircle-staging`, then `curl http://127.0.0.1:3002/api/health`.
6. If several restarts are needed within 5 minutes, run `systemctl reset-failed hellocircle-staging` first (start limit 5/300 s).

**Restore (staging only; overwrites staging data):**
`gunzip -c /var/backups/hellocircle-staging/<file>.sql.gz | mysql --defaults-extra-file=/root/.hellocircle-staging-backup.cnf hello_circle_staging`. There's no down-migration, so restoring the pre-migration backup *is* the schema rollback.

**Rollback (application):** check out the previous commit, then build and restart (steps 1, 2 and 5). The HC-QA-090 recovery covers open tabs: exactly one reload was verified on staging.

**Not configured yet (Phase 13B):** Stripe TEST, SMTP, Firebase, R2/Cloudinary, Mapbox (`VITE_MAPBOX_ENABLED=false`) and GTM (`VITE_GTM_CONTAINER_ID=off`). The Stripe webhook's nginx location is prepared but **commented out** (it must bypass Basic Auth).


> **Phase 11A update (2026-10-03):** The approved architecture is a **separate staging VPS**. The full provisioning spec (host, DB users and grants, backups, nginx/TLS/noindex, proxy topology, deployment and rollback) is in **`QA_STAGING_PROVISIONING.md`**. Name-only environment templates are in `deploy/staging/`. Staging is still **NOT PROVISIONED**, and the owner actions listed there are outstanding. Analytics isolation now exists in code: `VITE_GTM_CONTAINER_ID=off` (HC-QA-093). The schema rollback limitation is unchanged: there is no down-migration, so rolling back the schema means restoring the pre-migration backup.

Date: 2026-10-03. This is an inventory and classification of what exists. Configured values were classified locally without being printed.

**Verdict: no isolated staging environment exists, so deployment to staging is BLOCKED.**

The only deployment target is the **production** VPS. The app, its nginx/TLS and the **production MySQL** (`hello_circle`) all run on the same host. A standing instruction for this repo also forbids pushing or deploying without an explicit per-instance instruction. Creating staging requires the decisions listed at the end. Nothing was deployed and nothing was pushed or committed.

## Dependency classification

| Dependency | What exists today | Classification for staging | Notes |
|---|---|---|---|
| Frontend host | Production VPS only (nginx serves the single-origin Node app) | **NOT CONFIGURED** (staging) / **UNSAFE** if reused naively | A staging app on the prod box shares the host, nginx, disk and MySQL server with production |
| Backend host | Same production VPS, Node on `127.0.0.1:3001` | **NOT CONFIGURED** | Port, process manager and `server/.env` would all need a separate staging copy |
| Database | Production `hello_circle` (prod VPS); local `hello_circle_dev`; isolated QA containers (local) | **NOT CONFIGURED** for staging; local QA = **STAGING ISOLATED (local only)** | A staging DB must be its own database with its own user and grants limited to it. Never `hello_circle` or `hello_circle_dev` |
| Domain / subdomain | `hellocircle.ie`, `www.hellocircle.ie` (GoDaddy DNS) | **NOT CONFIGURED** | No staging subdomain record. DNS access is with the owner (not available to QA) |
| HTTPS | Let's Encrypt via certbot on the prod VPS | **NOT CONFIGURED** for staging | A staging subdomain would need its own certificate |
| Storage (media) | One Cloudflare R2 bucket and one Cloudinary cloud, configured in `server/.env` (no environment marker) | **UNSAFE** (shared with dev/prod; R2 credentials also flagged rotate-pending in earlier sessions) | Staging must use a separate bucket and scoped API token, or local mode |
| Email | One Gmail SMTP account (dev and prod templates both use it) | **UNSAFE / SHARED** | A staging sender (or sandbox such as Mailtrap/Mailpit-equivalent) plus controlled QA recipients are needed. Local Mailpit = **STAGING ISOLATED (local only)** |
| Firebase / Google auth | One Firebase project referenced by both client and server config (no environment marker) | **UNSAFE / SHARED** (appears to be the production identity project) | A staging Firebase project (or at least a separate web app plus authorised domain) is needed; console access is owner-only |
| Stripe | TEST-mode key only (`sk_test`, local private file); no live key anywhere in the repo or env files inspected | **STAGING ISOLATED** (test mode) | A staging webhook endpoint (HTTPS) and its signing secret need a staging host. Stripe CLI available for real test-mode delivery to local |
| Mapbox | One public browser token in `client/.env` | **SHARED READ-ONLY** | Works for read-only map tiles; staging should use a URL-restricted token |
| Geocoding | Default public Nominatim (`GEOCODER_BASE_URL` unset) | **SHARED READ-ONLY** (public service, rate-limited by policy) | Conservative use only |
| Analytics (GTM) | Container ID in client code, loaded only after consent | **SHARED** | Staging events would land in the production container unless a staging container or GTM environment is used |

**Production-mutation check.**
- Deploying staging onto the production VPS without a separate DB user, bucket, SMTP sender and Firebase project **could mutate production data or identities**. Per the brief that is a STOP condition, so it wasn't attempted.
- Local QA environments (isolated MySQL containers, Mailpit, loopback-only, outbound blocked) cannot reach production.

## What was done instead (local, isolated)

- **Explicit migration step:** `npm run migrate --workspace server` (fresh, existing and idempotent paths verified) — see QA_REPORT.md Phase 11.
- **Production-build browser runs:** `QA_PROD_BUILD=1 npm run qa:browsers` against the real backend and an isolated DB.
- **Real Stripe-delivered TEST webhooks:** via the Stripe CLI to an isolated local production-build stack, not a public HTTPS endpoint.

## Decisions needed to create staging

1. **Where staging runs.**
   - (a) A separate small VPS or container host (recommended; full isolation).
   - (b) The existing VPS as a separate process with its own MySQL database and user, its own nginx server block and its own `server/.env`. This is only acceptable with grants limited to the staging database and no shared credentials, and it still shares the host with production.
2. **DNS:** a staging subdomain (e.g. `staging.hellocircle.ie`) pointed at the chosen host, plus HTTPS.
3. **Release artefact:** permission to commit the Phase 10/10A work to a release branch and push it (the runbook deploys `origin/<branch>` archives only; uncommitted state must not be deployed).
4. **Isolated credentials for staging:**
   - Stripe TEST webhook endpoint and secret, created for the staging URL.
   - A staging Firebase project or web app, with the staging domain authorised.
   - A separate R2 bucket and scoped token (and rotation of the previously exposed R2 credentials).
   - A staging SMTP sender or sandbox, plus a list of controlled QA recipient addresses.
   - A URL-restricted Mapbox token.
   - Optionally, a GTM staging environment.

## Schema migration plan (section 3)

**Mechanism.** The schema is created and changed by `initSchema()` (`server/src/db/index.ts`): `CREATE TABLE IF NOT EXISTS`, plus additive, idempotent `ensureColumn` and index helpers. There is no schema-version table and **no down-migration**.

**New explicit step.** `npm run migrate --workspace server` (`server/src/scripts/migrate.ts`) runs the same `initSchema()` as an observable step *before* the app restarts, so the deploy no longer depends on startup migration silently. The script:
- prints the target DB, account and server version (never credentials);
- refuses the DB name `hello_circle` unless `--allow-production` is passed;
- supports `--dry-run`, which prints identity and the current fingerprint only;
- lists added tables and columns;
- runs a second time and fails if anything changes, proving idempotency.

It never seeds data or the admin account. The schema fingerprint is order-independent: an upgraded DB appends columns at the end, while a fresh DB declares them inline.

| Verification (isolated throwaway MySQL) | Result |
|---|---|
| Fresh empty DB | 0 → 76 tables / 777 columns. Second run unchanged. Exit 0 |
| Existing DB at the last documented production commit `e816b56` (schema built with that commit's own `initSchema` in a temporary git worktree, then seeded with synthetic residents, games, participants and Circle members) | 68 tables / 650 columns → 76 / 777. Added 8 tables (`app_settings`, `chat_reads`, `circle_plans`, `invitations`, `listing_attributes`, `media_assets`, `notify_me_subscriptions`, `resident_signup_tokens`) and 61 columns plus indexes. Second run unchanged. Exit 0 |
| Fresh vs upgraded schema | **Identical:** 0 differing columns on name, type and nullability. Same fingerprint `b2c8cc9049ad664b` |
| Data preservation | All synthetic rows present after the upgrade. The new `game_participants.total_cents` column was added as NULL on the 2 existing rows, as expected for historical rows |
| Production-name guard | `DB_NAME=hello_circle` → refused (tested in the throwaway container only) |

The only schema change not yet committed is `game_participants.total_cents`.

**Rollback.** There is no down path, so rollback means **restore from a pre-migration backup** (`mysqldump --single-transaction` of the target DB) and redeploy the previous build. Every change is additive, so the *previous* app version keeps working against the *migrated* schema; this was not exercised here and is worth checking once on staging. A dump must therefore be taken immediately before every staging or production migrate.

**Deploy order for staging:**
1. Commit and push a release branch.
2. Export the archive on the host.
3. `npm ci`.
4. Take a DB backup.
5. `npm run migrate --workspace server` (staging DB name).
6. `npm run build`.
7. **Restart** the Node process. This is required: the server caches `index.html` in memory, so serving a new `dist` without a restart breaks every page (see HC-QA-090).
8. Run the health check and smoke test.

## Required staging configuration (when a host exists)

- **`NODE_ENV=production`**, which makes the webhook *require* `STRIPE_WEBHOOK_SECRET`.
- **`STRIPE_SECRET_KEY`:** test key only.
- **`STRIPE_WEBHOOK_SECRET`:** from a staging endpoint created in the Stripe TEST Dashboard.
- **`TRUST_PROXY_HOPS=1`** behind nginx. Without it, every visitor shares one rate-limit bucket (`req.ip` becomes 127.0.0.1), so 10 password logins per 15 minutes would apply site-wide. The private runbook covers it, but the local `server/.env.production` template does **not** set it.
- **`CLIENT_URL` / `PUBLIC_ORIGINS`:** the staging origin, so email links and CORS point at staging.
- **`DATA_DIR`:** a staging-only directory.
- **`DB_*`:** a staging-only database and user.
- **`MEDIA_PROVIDER` / R2:** a staging bucket, or `local`.
- **SMTP:** a staging sender or sandbox.
- **Firebase:** a staging project.
- **Mapbox:** a URL-restricted token.
- **`HELLO_CIRCLE_ADMIN_*`:** non-default credentials.
- **Search engines:** add `X-Robots-Tag: noindex` at nginx for the staging host, in addition to the app's own robots meta.

## Observability and limits (review, no tooling purchased)

| Area | Current state | Staging readiness |
|---|---|---|
| Health | `GET /api/health` → `{ok:true}`. It is a liveness check only: no DB check | Use it for uptime checks. A readiness check that pings the DB would be better (P3) |
| Logs | stdout `console.*` with prefixes (`[payments]`, `[stripe]`, `[notifications]`, `[email]`, `[media]`), plus a process-wide `unhandledRejection` logger. No structured logger and no error tracker (no Sentry etc.) | PM2 log files suffice for staging. Secret scan of every Phase 11 backend log: **0 hits** |
| Payment anomalies | Late payment after the hold expired is logged as `[payments] … marked cancelled/paid for refund`. Refund failures are logged with Stripe's message | Must be watched manually. No alerting |
| Rate limits | In-memory, per process, keyed on `req.ip`. Lookup and cancel: 10 / 15 min. Magic link: 5 / 15 min. Password login: 10 / 15 min. Google: 30 / 15 min. Launch signup: 5 / 15 min. Geocode: 20 / min. The Stripe webhook is not limited (correct) | It resets on restart and is single-instance only, as documented. It needs `TRUST_PROXY_HOPS` behind a proxy |
| Static assets | Hashed assets served with `Cache-Control: public, max-age=0` (revalidated every time). Missing assets return `200 text/html` (HC-QA-090) | Immutable caching for `/assets/*` would help performance (P3) |
