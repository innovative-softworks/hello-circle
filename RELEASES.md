# Releases and version numbers

Hello Circle uses **semantic versioning**: `MAJOR.MINOR.PATCH`, stored as `"version"` in the root
`package.json`. The running version and the exact code build are shown at the bottom of the staging
login screen (`v0.9.0 · build 2ff445c`, from `server/src/appVersion.ts`).

| Change | Bump | Example |
|---|---|---|
| Bug fix only | PATCH | `1.2.0` → `1.2.1` |
| New feature, nothing breaks | MINOR | `1.2.1` → `1.3.0` |
| Big change (redesign, breaking change) | MAJOR | `1.3.0` → `2.0.0` |

Before the public launch the version stays at `0.x` (`0.9.0` now). The public launch is **`1.0.0`**.

## Branches

```
feature/... fix/... chore/...  →  staging  →  main
                                  (staging site)  (live site)
```

- New work: a branch from `staging`, then a pull request **into `staging`**.
- Release: a pull request **from `staging` into `main`**.
- Urgent live fix: `hotfix/...` from `main` → PR into `main` → then merge `main` back into `staging`.

## Doing a release

1. **On a `chore/release-vX.Y.Z` branch from `staging`:** set `"version"` in the root `package.json`
   to the new number and add an entry at the top of the changelog below. PR it into `staging`.
2. **Deploy that commit to staging and test it** (the login screen footer shows the version and build,
   so testers can report exactly what they tested).
3. **PR `staging` → `main`** titled `release: vX.Y.Z`, and merge it once Web CI is green.
4. **Tag the release** on the merged `main` commit and push the tag:
   `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`
5. **Back up production first:** `ssh root@<server> hellocircle-prod-backup pre-vX.Y.Z`, then
   **deploy exactly that tag to production**, never a newer commit. Set `APP_COMMIT` to the tag's
   short commit in production's `server/.env`, because production is not a git checkout.
6. If something breaks, roll back by redeploying the previous tag. If the deploy changed the database,
   also restore the `pre-vX.Y.Z` backup (there are no down-migrations, so the backup *is* the rollback).

## Production backups

- **Nightly at 03:00 UTC**: database `hello_circle` plus the `uploads` folder, kept for 14 days in
  `/var/backups/hellocircle-prod` on the server (`/usr/local/sbin/hellocircle-prod-backup`, cron
  `/etc/cron.d/hellocircle-prod-backup`, errors in `/var/log/hellocircle-prod-backup.log`).
- Uses a **read-only** MySQL account (`hc_backup`), so a backup can never change live data.
- **Restore** (overwrites the live database, so only on purpose, with the site stopped):
  `systemctl stop hello-circle && gunzip -c /var/backups/hellocircle-prod/db-<stamp>.sql.gz | mysql hello_circle && systemctl start hello-circle`
- **Restore drill**: load a backup into a throwaway database and compare table and row counts with live.
  The first drill (2026-10-08) matched exactly: 68 tables, 406 rows.

## Changelog

### 0.9.0 (staging, not yet released)
- Staging environment with Stripe test payments, email, Google sign-in and demo data.
- iSoftworks-branded tester login screen with per-role tester accounts (`npm run tester`).
- Web CI (build + tests) required on every pull request into `staging` and `main`.
