# HelloCircle — Staging provisioning specification (Phase 11A)

Status: **PREPARED, NOT PROVISIONED, NOT EXECUTED.** Nothing in this document was run against any server. Provisioning a host, changing DNS and creating provider resources need the owner's approval (see "Owner actions" at the end).

Architecture decision (approved): a **separate staging VPS**. It is NOT a second process on the production VPS. No staging component may hold a credential that can reach production data.

Templates referenced below live in `deploy/staging/`:
- `server.env.template` and `client.env.template`: variable names with REQUIRED / OPTIONAL / NOT USED classification, no values.
- `nginx-staging.conf.template`
- `hellocircle-staging.service.template` (systemd)
- `backup-db.sh`

## 1. Host

| Item | Specification (pilot/MVP, cost-conscious) |
|---|---|
| VPS size | 2 vCPU, 4 GB RAM, 40–60 GB SSD (the same class as production). This is enough for Node + MySQL + nginx at QA traffic. 2 GB RAM is possible but tight once `npm ci` + `vite build` run on the box |
| Provider | Any small KVM VPS, for example the same provider as production in a **separate** instance/account project. Single node, no Kubernetes, no managed DB |
| OS | Ubuntu 24.04 LTS (or the LTS the production box uses), unattended security upgrades on |
| Node.js | **22.x LTS** via NodeSource, to match production. Local development currently uses 25.x; the release must build and run on 22 |
| MySQL | **MySQL 8.0** (server package or the official apt repo). Bound to `127.0.0.1` only (`bind-address = 127.0.0.1`) |
| nginx | Distro package. One site: `deploy/staging/nginx-staging.conf.template` |
| TLS | Let's Encrypt via `certbot --nginx -d <staging-host>`, plus the `certbot.timer` auto-renew |
| Process | systemd unit `hellocircle-staging` (template provided), run as unprivileged user `hcstaging` |
| Time | UTC system clock. The app converts to Europe/Dublin itself |

### Firewall and ports

| Port | Exposure |
|---|---|
| 22/tcp | SSH, **key-only** (`PasswordAuthentication no`, `PermitRootLogin no`), ideally restricted to the owner's IPs |
| 80/tcp, 443/tcp | Public (nginx). 80 only redirects and serves ACME challenges |
| 3001/tcp (Node) | **Not exposed.** Bound/firewalled to loopback; reachable only from nginx |
| 3306/tcp (MySQL) | **Not exposed.** `bind-address = 127.0.0.1` and not opened in `ufw` |

`ufw default deny incoming; ufw allow OpenSSH; ufw allow 'Nginx Full'; ufw enable`

### Directories

```
/srv/hellocircle-staging/
  releases/<UTC-timestamp>-<git-sha>/   one checked-out, built release per deploy
  current -> releases/<…>               symlink switched atomically on deploy
  shared/server.env                     0600, staging-only values (from server.env.template)
  shared/client.env.production.local    staging build-time values (from client.env.template)
  shared/data/                          DATA_DIR: uploads/ + private-uploads/ (persist across releases)
  shared/backup.cnf                     0600, backup account option file
  backups/                              mysqldump archives (0700)
```

### Logs

| Source | Location |
|---|---|
| Application (stdout/stderr) | journald: `journalctl -u hellocircle-staging` |
| nginx access / error | `/var/log/nginx/hellocircle-staging.{access,error}.log` (logrotate default) |
| MySQL | `/var/log/mysql/error.log` |
| Backups | cron mail / `journalctl -t hc-backup` |

Retention: journald 14 days (`SystemMaxUse=500M`). No paid monitoring.

### Health checks

- `GET https://<staging-host>/api/health` → `{"ok":true}`. This is liveness; it bypasses nothing and goes through basic auth, so check with credentials or from the box itself: `curl -s http://127.0.0.1:3001/api/health`.
- A post-deploy smoke run (see §4). An external uptime check (free tier) is optional.

## 2. Domain, HTTPS, indexing, access

- **Hostname:** to be confirmed by the owner (example: `staging.hellocircle.ie`). It is **not assumed to exist**: no DNS change was made.
- **DNS:** one `A` (and optionally `AAAA`) record for the staging host pointing at the staging VPS.
- **HTTPS:** certbot, HSTS header in the template.
- **noindex:**
  - `X-Robots-Tag: noindex, nofollow, noarchive` on every response;
  - staging `robots.txt` = `Disallow: /`;
  - `/sitemap.xml` returns 404 on staging, so it never appears in the production sitemap, which is generated from production `CLIENT_URL` only.
- **No customer traffic:** nginx basic auth on everything except `/api/stripe/webhook`, which is protected by Stripe's signature in `NODE_ENV=production`. Share credentials only with QA.
- **Data:** synthetic/test data only. Never import a production dump.

## 3. Database design

| Item | Value |
|---|---|
| Database | `hello_circle_staging` (utf8mb4 / utf8mb4_unicode_ci) |
| App user | `hc_staging_app@localhost`: `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON hello_circle_staging.*` (CREATE/ALTER/INDEX are needed by the explicit migration step). **No global privileges, no other schema** |
| Migration | Run as `hc_staging_app` via `npm run migrate --workspace server` (it refuses the name `hello_circle` without `--allow-production`) |
| Backup user | `hc_staging_backup@localhost`: `SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER, PROCESS ON hello_circle_staging.*` (PROCESS is global, needed by `mysqldump --single-transaction` on 8.0) |
| Root | Local socket auth only; never used by the app |

**Cross-environment isolation:**
- The staging users exist only on the staging MySQL instance and are scoped to `hello_circle_staging.*`.
- Production credentials are never copied to the staging host.
- Staging passwords are unique.
- Even if the two hosts became network-reachable, no staging credential authenticates against production MySQL, and production's MySQL is itself loopback-bound.

```sql
CREATE DATABASE hello_circle_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hc_staging_app'@'localhost' IDENTIFIED BY '<generated>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON hello_circle_staging.* TO 'hc_staging_app'@'localhost';
CREATE USER 'hc_staging_backup'@'localhost' IDENTIFIED BY '<generated>';
GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER ON hello_circle_staging.* TO 'hc_staging_backup'@'localhost';
GRANT PROCESS ON *.* TO 'hc_staging_backup'@'localhost';
```

**Backup:**
- `deploy/staging/backup-db.sh`: `mysqldump --single-transaction`, gzip, integrity test, 14-day retention, refuses non-staging names.
- It runs nightly (cron `15 3 * * *`) and **immediately before every migration**.

**Restore (procedure — not yet rehearsed; rehearse once on staging, never on production):**
```bash
systemctl stop hellocircle-staging
mysql -e "DROP DATABASE hello_circle_staging; CREATE DATABASE hello_circle_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
gunzip -c /srv/hellocircle-staging/backups/hello_circle_staging-<stamp>.sql.gz | mysql hello_circle_staging
# re-point `current` at the release that matches this backup's schema, then:
systemctl start hellocircle-staging && curl -s http://127.0.0.1:3001/api/health
```

## 4. Deployment procedure (prepared — NOT executed)

Prerequisites:
- The approved release branch has been pushed.
- `shared/server.env` and `shared/client.env.production.local` are filled with staging values.
- The staging DB and users exist.

```bash
set -euo pipefail
REL=/srv/hellocircle-staging/releases/$(date -u +%Y%m%dT%H%M%SZ)-<sha>

# 1. Backup (always, even when no schema change is expected)
/srv/hellocircle-staging/shared/backup-db.sh

# 2. Fetch the approved branch (exact commit, no local edits)
git clone --depth 1 --branch <release-branch> <repo-url> "$REL"
git -C "$REL" rev-parse HEAD            # must equal the approved <sha>

# 3. Install locked dependencies
cd "$REL" && npm ci

# 4. Build (client gets staging build-time values; never client/.env)
cp /srv/hellocircle-staging/shared/client.env.production.local client/.env.production.local
npm run build

# 5. Migrate explicitly (before the app restarts) — prints target DB, proves idempotency
set -a; . /srv/hellocircle-staging/shared/server.env; set +a
npm run migrate --workspace server -- --dry-run
npm run migrate --workspace server

# 6. Switch + restart (restart is mandatory: new build)
ln -sfn "$REL" /srv/hellocircle-staging/current
systemctl restart hellocircle-staging

# 7. Health check
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3001/api/health && break; sleep 2; done

# 8. Smoke test
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/assets/does-not-exist.js   # expect 404 (HC-QA-090)
curl -fsS -I http://127.0.0.1:3001/ | grep -i "cache-control: no-cache"
# then: QA smoke against https://<staging-host> (production-build browser smoke, Stripe test webhook ping)
```

Open tabs from the previous release recover by themselves: one automatic reload, or "HelloCircle has been updated — Refresh to continue" (HC-QA-090).

### Rollback

- **Application:**
  1. `ln -sfn /srv/hellocircle-staging/releases/<previous> /srv/hellocircle-staging/current`
  2. `systemctl restart hellocircle-staging`
  3. Health check.

  Keep the last 3 releases.
- **Database:** **there is no down-migration.** Schema changes are additive (`CREATE TABLE IF NOT EXISTS` / `ensureColumn`), so the previous release normally runs against the migrated schema. That is expected but **unverified** — verify it on staging once. If a schema rollback is required, the **only** path is restoring the pre-migration backup taken in step 1 (§3 Restore). Any data written after that backup is lost.

## 5. Proxy topology and `TRUST_PROXY_HOPS=1`

Verify these on the box **before** enabling:
1. `ss -ltnp | grep 3001` shows Node listening on `127.0.0.1:3001` only.
2. `ufw status` has no rule for 3001.
3. nginx is the only client of 3001.
4. The nginx template **overwrites** `X-Forwarded-For` with `$remote_addr`, so a client-supplied header cannot be used.

With exactly one trusted hop, Express's `req.ip` equals nginx's view of the client, which is what the in-memory rate limiters key on. Without `TRUST_PROXY_HOPS`, every visitor shares one bucket (127.0.0.1). If a CDN or load balancer is ever placed in front, recount the hops. Do not raise the value blindly.

## 6. Provider isolation requirements

| Provider | Staging requirement | Owner action |
|---|---|---|
| **Stripe** | TEST mode only (`sk_test`/`rk_test`). A dedicated webhook endpoint `https://<staging-host>/api/stripe/webhook` created in the TEST dashboard, with events `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` (optionally `charge.refunded` for monitoring). Its own `whsec_`. No publishable key is needed | Create the endpoint and provide the secret in `server.env` on the box |
| **Firebase** | A **separate staging Firebase project**, preferred, with a web app config plus a service account; Google provider enabled; the staging host added to authorised domains. Without it, Google sign-in degrades gracefully | Create the project / web app / service account |
| **R2** | A **separate staging bucket** (name contains `staging`) plus an API token scoped to that bucket only. The **previously exposed R2 credentials must be rotated and never reused**. Until then: `MEDIA_PROVIDER=local` | Rotate the old keys; create the bucket and scoped token |
| **Email** | A staging sender or sandbox inbox, distinct from the production Gmail sender, plus a list of **controlled QA recipient addresses**. Staging must never email customers (synthetic data only) | Choose the sandbox/sender; list QA recipients |
| **Mapbox** | A separate public token **URL-restricted** to `https://<staging-host>` (Mapbox supports URL restrictions) | Create the token |
| **Analytics** | `VITE_GTM_CONTAINER_ID=off` (recommended) or a dedicated staging GTM container/environment. Never the production container (HC-QA-093) | Decide off vs staging container |
| **Geocoding** | Public Nominatim at low volume is acceptable, or a self-hosted/paid endpoint via `GEOCODER_BASE_URL` | None required |

## Owner actions (approvals and resources — no credential values requested here)

1. Approve and provision the staging VPS (size above); give QA SSH key access.
2. Confirm the staging hostname; create its DNS record.
3. Create the Stripe TEST webhook endpoint for that hostname.
4. Create the staging Firebase project/app/service account (or accept Google sign-in disabled on staging).
5. Rotate the exposed R2 credentials; create the staging bucket and scoped token (or accept `MEDIA_PROVIDER=local`).
6. Provide a staging email sender/sandbox and a list of QA recipient addresses.
7. Create the URL-restricted Mapbox token (or accept maps off).
8. Decide analytics: `off` or a staging GTM container.
9. Explicitly authorise pushing the release branch (see QA_REPORT, Phase 11A — the push was not performed).
