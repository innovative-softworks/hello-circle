# HelloCircle — staging deployment checklist

_2026-10-17. For deploying the OG-01…OG-32 build to **staging.hellocircle.ie** only. Production is out of scope. Nothing here
has been run against staging yet. Every step that changes staging needs the owner's explicit go-ahead. Secrets are never
pasted into chat, tickets or git._

Staging layout (from `QA_STAGING_ENVIRONMENT.md` and the 2026-10-04/08 setup):
- **Host:** staging runs on the production VPS.
- **App:** `/var/www/hellocircle-staging/app`, user `hellocircle`, tracking the `staging` branch.
- **Service:** `hellocircle-staging.service` on `127.0.0.1:3002`.
- **Database:** `hello_circle_staging`, user `hc_staging_app`, which can't read production.
- **Config:** `/var/www/hellocircle-staging/shared/server.env` (600).
- **Backups:** `/usr/local/sbin/hellocircle-staging-backup`.
- **Protection:** the tester gate (nginx Basic Auth was removed 2026-10-08).

Production (`/opt/hello-circle`, `hello-circle.service`, DB `hello_circle`) must not be touched.

## 0. Before anyone logs in to the server

- [ ] Owner approves the commit plan; commits are made locally.
- [ ] Push the branch, then a PR into `staging`. The repo's ruleset needs a PR plus the `checks` CI job (build, client
  and server tests).
- [ ] Once CI is green, merge. Note the merge commit `<sha>`.
- [ ] Read `git log staging` to confirm `<sha>` is what will be deployed (no uncommitted state is ever deployed).

## 1. Pre-flight on the VPS (read-only)

```bash
ssh root@<vps>                      # key auth only
systemctl is-active hello-circle hellocircle-staging
df -h / /var ; free -m
sha256sum /etc/nginx/sites-available/hello-circle | cut -c1-64 ; cat /root/.prod-nginx-site.sha256   # must match
cut -d= -f1 /var/www/hellocircle-staging/shared/server.env | sort      # names only, never values
```

- [ ] Both services active, disk >2 GB free, production nginx checksum unchanged.
- [ ] `server.env` names include `NODE_ENV`, `APP_ENV`, `DB_*`, `CLIENT_URL`, `PUBLIC_ORIGINS`, `HOST`,
  `HELLO_CIRCLE_ADMIN_PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_*`, `MAIL_FROM`.
- [ ] Values: `NODE_ENV=production`, `APP_ENV=staging`, `HOST=127.0.0.1`. Check these with
  `grep -E '^(NODE_ENV|APP_ENV|HOST)=' …`; they aren't secrets.

## 2. Environment secrets

| Secret | Status | Action |
|---|---|---|
| `HELLO_CIRCLE_MFA_KEY` | **New, required** | See below |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Set since 2026-10-11 (TEST) | Keep. Live keys are refused outside production by code |
| `SMTP_*`, `MAIL_FROM` | Set (gmail:465) | Keep; verify delivery in §6 |
| `HELLO_CIRCLE_ADMIN_PASSWORD` | Set | Keep (boot warns if it were the default) |
| R2 / Cloudinary / Mapbox / GTM | Unverified on staging | Unchanged by this build. If `MEDIA_PROVIDER=r2` is set, all R2 vars are required, or production-mode boot refuses to start |

**Add the MFA key — safe provisioning:**
- **Who:** the owner, in their own Terminal over `ssh -t`. Not through an assistant session; nothing here is typed into
  chat.
- **One key per environment:** staging gets its own; never reuse production's, and never copy staging's to
  production.
- **Never shown:** the commands below create the key on the server and append it to the env file. It isn't echoed and
  never touches shell history as a literal.
- **Never replaced by accident:** if a key already exists, stop. Replacing it makes every stored two-step set-up
  unreadable.

```bash
ssh -t root@<vps>
umask 077
F=/var/www/hellocircle-staging/shared/server.env
grep -q '^HELLO_CIRCLE_MFA_KEY=' "$F" && echo "already set — do not replace" || printf 'HELLO_CIRCLE_MFA_KEY=%s\n' "$(openssl rand -base64 32)" >> "$F"
chown hellocircle:hellocircle "$F"; chmod 600 "$F"
```

- [ ] Check it without displaying it:
  `sed -n 's/^HELLO_CIRCLE_MFA_KEY=//p' "$F" | tr -d '\n' | wc -c` prints **44**, and
  `sed -n 's/^HELLO_CIRCLE_MFA_KEY=//p' "$F" | base64 -d | wc -c` prints **32**. (Don't use `awk -F=`: it drops the
  key's trailing `=` padding and reports 43.)
- [ ] Back it up: open the file in an editor on the server (not `cat`, not in a shared or recorded session) and copy
  the value into the owner's password manager, labelled "HelloCircle staging — HELLO_CIRCLE_MFA_KEY". Keep no other
  copy: not in DEPLOYMENT.md, git, CI variables, tickets or chat.
- [ ] After the restart in §5, the journal must show **no** `[mfa]` line. The app reports a missing or malformed key
  there, and never prints the key itself.
- [ ] If the key is ever exposed: generate a new one the same way. Every admin then signs in with a recovery code, and
  another super admin resets their two-step sign-in, so they enrol again under the new key.

## 3. Database backup (before any code changes)

```bash
/usr/local/sbin/hellocircle-staging-backup pre-<sha>
ls -lh /var/backups/hellocircle-staging/ | tail -3          # new file, non-zero size
```

- [ ] Backup file present and non-empty. Without a down-migration, this file *is* the schema rollback.
- [ ] Also copy the uploads directory if the staging backup script doesn't cover it:
  `tar czf /var/backups/hellocircle-staging/uploads-pre-<sha>.tgz -C /var/www/hellocircle-staging/shared uploads`
  (only if that path exists).

## 4. Code, build and additive schema migration

```bash
sudo -u hellocircle -H bash -lc 'cd /var/www/hellocircle-staging/app && git fetch && git checkout <sha> && npm ci && nice -n 19 npm run build'
sudo -u hellocircle -H bash -lc 'cd /var/www/hellocircle-staging/app && npm run migrate --workspace server'
```

- [ ] `migrate` prints `target database=hello_circle_staging` (stop if it names anything else).
- [ ] Added tables are only the 7 new ones: `admin_invites`, `admin_mfa_recovery_codes`, `booking_change_proposals`,
  `resident_restrictions`, `privacy_requests`, `game_series`, `game_join_requests`. New columns are nullable or
  defaulted; nothing is dropped or renamed.
- [ ] The last line reads `idempotency check: second run changed nothing`.

Verified locally 2026-10-17: on an empty production-mode database the migration created 146 tables, and a second run
changed nothing.

## 5. Restart and smoke check

```bash
systemctl reset-failed hellocircle-staging; systemctl restart hellocircle-staging; sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/api/health        # 200
journalctl -u hellocircle-staging -n 80 --no-pager | grep -E '\[mfa\]|\[media\]|\[stripe\]|\[seed\]|Error'
```

- [ ] Health 200.
- [ ] **No `[mfa]` line**: a line there means the key is missing or malformed. Fix it before continuing; every
  admin is refused until then.
- [ ] No `[media] … refusing to start`, no `[stripe] REFUSED`, no `[seed]` default-password warning.
- [ ] `https://staging.hellocircle.ie/` shows the tester gate; after the gate the home page loads.

## 6. Stripe TEST webhooks and SMTP

- [ ] **Webhook endpoints (Stripe Dashboard, TEST mode):**
  - `https://staging.hellocircle.ie/api/stripe/webhook` (snapshot events; also "Events on Connected accounts" for
    `account.*`, `capability.updated`, `payout.*`);
  - `https://staging.hellocircle.ie/api/stripe/webhook/v2` (thin `v2.core.account*` events, if Accounts v2 is used).
- [ ] **Events the code handles:**
  - checkout: `checkout.session.completed`, `.expired`, `.async_payment_succeeded`, `.async_payment_failed`;
  - charges: `charge.refunded`, `charge.dispute.created`, `.updated`, `.closed`;
  - Connect: `account.updated`, `account.external_account.updated`, `capability.updated`, `transfer.reversed`;
  - payouts: `payout.created`, `.updated`, `.paid`, `.failed`, `.canceled`;
  - subscriptions: `customer.subscription.updated`, `.deleted`, `invoice.paid`, `invoice.payment_failed`.

  The OG-05 partner notices need `payout.failed` / `payout.canceled` and `invoice.payment_failed`.
- [ ] The nginx location for `/api/stripe/webhook*` bypasses the tester gate (enabled 2026-10-08). Check it with the
  Dashboard's "Send test event" → 200 (a signed test event is stored in `webhook_events`).
- [ ] **SMTP:** request a magic-link sign-in to an owner-controlled inbox, then an admin invitation (§7). Both arrive;
  `journalctl … | grep '\[email\]'` shows no failures.

## 7. MFA enrolment and recovery (owner)

- [ ] Sign in at `/admin` as the staging admin and set up two-step sign-in with an authenticator app. Save the 10
  recovery codes in the password manager.
- [ ] In a private window: sign in again, use **one recovery code**, and confirm it works once only (reusing it is
  refused).
- [ ] Invite a second admin (Settings → Invitations; 72 h single-use link, role super). They accept, set a password
  and set up two-step.
- [ ] From the second super admin: reset the first admin's two-step (Settings → two-step card, "Reset…"). The first
  admin's sessions end, and they set up again at next sign-in.
- [ ] A money or settings action after 30 minutes asks for a fresh code (step-up).

## 8. End-to-end browser verification (staging, TEST data only)

| # | Journey | Expected |
|---|---|---|
| 1 | Partner owner: block time over an existing booking | Covered bookings listed; must choose keep or cancel+refund |
| 2 | Partner: propose a new time; customer accepts from the email link; a second proposal is declined | Booking moves only on accept |
| 3 | Partner: experience departures — weekly ×3 with a cut-off, edit capacity, move a booking ("customer asked") | As in `OG-19-DEPARTURES` |
| 4 | Partner: All orders filters; monthly statement CSV ("Not a VAT invoice") | As in `OG-13-ORDERS` |
| 5 | **Option A**: invite one staff member per role (centre manager, facility manager, finance, communications, read-only analyst) | Finance sees orders but not rosters; communications sees Customers but can't open order records; the analyst sees no customer names or emails anywhere (Overview, CSV export without contact columns) |
| 6 | Host: join-approval activity; weekly series, then cancel remaining dates | Request takes no seat until approved; remaining dates cancelled |
| 7 | Resident: privacy erasure request | Admin can only "Send reply, keep open" or decline; resident sees "In progress · nothing deleted yet" |
| 8 | Admin: Vendors and All listings paging (counts, filters, page 2, open record, Back) | As in `OG-24-PAGING` |
| 9 | Admin: Exceptions inbox, after a TEST payout failure or a failed webhook | Listed; Open → Finance record |
| 10 | Paid TEST checkout (4242…), then refund | Confirmed once; refund recorded; no duplicate on webhook retry |
| 11 | Phone width (390 px) on each workspace | No sideways scroll |

## 9. Rollback

- **Application only (schema kept):** `git checkout <previous-sha> && npm ci && nice -n 19 npm run build`, then restart
  (no migrate). Verified locally 2026-10-17: the previous release `1ba8c7b` boots and serves the site and admin pages
  on the migrated schema. **Security note:** the previous build has no admin two-step, step-up or invitations, so admins sign in with a
  password alone until you roll forward again. Keep the rollback short, tell the admins, and don't create admin
  accounts during it. Keep `HELLO_CIRCLE_MFA_KEY` unchanged in the env, so roll-forward can read the stored set-ups.
  Details: `hellocircle-release-readiness.md`, "Rollback and its MFA security implications".
- **Data or schema problem:** stop the service, restore the §3 backup with
  `gunzip -c /var/backups/hellocircle-staging/<file>.sql.gz | mysql --defaults-extra-file=/root/.hellocircle-staging-backup.cnf hello_circle_staging`,
  then deploy the previous sha. This overwrites staging data created after the backup.
- Start-limit: run `systemctl reset-failed hellocircle-staging` before repeated restarts.

## 10. Sign-off

- [ ] §5–§8 all ticked, with the journal clean for an hour.
- [ ] Record the deployed sha, the backup file name and the results in `hellocircle-release-readiness.md`.
- [ ] Production stays a separate decision (B1–B7 there).
