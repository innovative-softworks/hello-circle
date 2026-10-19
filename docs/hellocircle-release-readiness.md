# HelloCircle release readiness — OG-01 … OG-32

_2026-10-17 (final QA pass; updated the same day with the Option A security fix, deployment verification, commit plan and
staging checklist). Supersedes the 2026-10-16 version._

## Where this work is

| Environment | State |
|---|---|
| **Local** (`feature/commerce-engine` at `1ba8c7b`, working tree) | All work. **Not committed.** |
| GitHub | Nothing pushed |
| Staging (`staging.hellocircle.ie`) | Untouched; none of this is deployed |
| Production (`hellocircle.ie`) | Untouched; no data read or changed |
| Stripe | TEST mode only; no live keys used, no live or dashboard settings changed |

The working tree also contains earlier uncommitted work from previous sessions (admin/partner/host workspace redesign,
header and homepage, D-01/D-02/D-03/D-08/D-10/D-11). They ship together unless split into separate commits.

## Security fix: partner customer data by role (Option A, decided by the owner 2026-10-17)

**What changed:**
- **Order records:** All orders, hall bookings, registrations and a booking's proposed changes are limited to
  managers and finance.
- **Listing rosters:** experience bookings, programme enrolments, club participants and the club waitlist are limited
  to the two manager roles.
- **Customers directory:** managers, finance and communications.
- **Read-only analyst:** no customer names or emails anywhere. The Overview shows bookings without names, and the CSV
  export comes without contact columns.

Owners are unrestricted, and the organisation scoping is unchanged. On screen, communications staff see Customers
bookings as plain text, and the CSV button shows only where the server serves it.

**Evidence (executed):**

| Test | Result |
|---|---|
| `vendorPiiRoles.test.ts` | 13/13 |
| `PII-ROLES` (real stack; 11 endpoints × 6 roles + CSV + Overview + another organisation per endpoint) | passed |
| `PII-UI` (browser; analyst, communications and finance, records opened directly by URL) | passed |
| `qa:authorization` | 83, 39/39 batches |
| booking / lifecycle / product | 38 / 52 / 68 |
| `qa:validation` (uninterrupted) | 25/25 batches, 49 tests |
| `qa:revenue` (uninterrupted) | 9/9 batches, 38 tests |
| smoke | 14 |
| unit tests | server 1027 / 23 skipped, client 281, `qa:check` 97 |
| `qa:stripe` (complete, fresh throwaway QA database) | 19/19 batches, 51/51 tests |

**Left open:** two small items in `hellocircle-remaining-decisions.md` (notifications to a listing creator after a
role change; CSV access for managers).

## Deployability (verified locally 2026-10-17, production mode)

The production build (`npm run build`) passes. The built server ran as staging would (`NODE_ENV=production`,
`APP_ENV=staging`, `HOST=127.0.0.1`) on a throwaway MySQL container, with no provider credentials and no `.env` loaded:

| Check | Result |
|---|---|
| Migration on an empty database | 146 tables; idempotent on a second run |
| Pages | health 200; SPA, deep links and hashed assets served |
| Admin pages signed out | 401; unknown API route 404 |
| Session cookie | Secure + HttpOnly |
| Admin two-step | admin pages refused (403) until set-up; set-up and 10 recovery codes work; then 200 |
| Without `HELLO_CIRCLE_MFA_KEY` | boot logs `[mfa] … missing` and the site stays up; two-step returns a clear 503; admin pages stay closed |
| Stripe and SMTP unset | only the expected warnings; nothing fails at boot |
| Rollback | the previous release `1ba8c7b` boots on the migrated schema and serves the site and admin pages. While rolled back, admin two-step isn't enforced (that build predates it) |

Production-only rules worth knowing:
- `MEDIA_PROVIDER=r2` with any R2 variable missing refuses to start.
- The default admin password is warned about at boot.
- Live Stripe keys are refused unless `NODE_ENV=production` and `APP_ENV` is unset or `production`.
- Session cookies are Secure, so the site must be served over HTTPS (it is, behind nginx).

## Commit plan and staging steps

- `hellocircle-commit-plan.md` — seven commits, each verified to type-check, with the full file lists.
- `hellocircle-staging-deployment-checklist.md` — exact staging steps covering secrets, backup, migration, Stripe
  TEST webhooks, SMTP, MFA enrolment and recovery, end-to-end checks and rollback.

## Recommendation

**Go for owner review, commit and a staging deploy. No-go for production until the blockers below are cleared.**

The local evidence is now complete for this build:
- **Unit tests:** server 1014 (23 skipped), client 281, `qa:check` 97, all three type-checks clean.
- **Stripe TEST mode:** two uninterrupted complete runs, each on a freshly provisioned QA database (the second on the
  final code), 19/19 batches and 51/51 tests each time, including SANDBOX-SPLIT and SANDBOX-RECONCILE.
- **Validation:** one uninterrupted run, 23/23 batches.
- **Revenue and regression suites:** `qa:revenue` 9/9 batches, smoke 14, authorization 83, booking 38, lifecycle 52 and
  product 68 all passed on the final code, with no retries.
- **Dedicated browser tests:** OG-01, OG-13, OG-15, OG-19 and OG-24 each have one.
- **Isolation:** cross-organisation and cross-account checks refuse every attempt and change nothing.

What remains is deployment work, decisions only the owner can make, and checks only staging can run.

## Blockers before production (explicit)

| # | Blocker | Owner | How to clear |
|---|---|---|---|
| B1 | **Owner review and commit split** — the tree mixes this pass with earlier uncommitted sessions | Owner | Decide the commit split; explicit word to commit and push |
| B2 | **`HELLO_CIRCLE_MFA_KEY` not yet provisioned** on staging/production. Without it every admin is refused at two-step set-up | Owner / ops | Provision per the section below; boot log must show no `[mfa]` line |
| B3 | **Staging deploy + click-through not done** (steps: `hellocircle-staging-deployment-checklist.md`) (nothing in this pass has run on a real server, real SMTP or real Stripe webhooks) | Owner (deploy word) | Deploy to staging; click through: admin invitation + two-step set-up and recovery code, privacy erasure request (stays open), partner block time with a booking, proposed time change accept/decline, join-approval activity, weekly series, experience departure move, Vendors/All listings paging |
| B4 | **Stripe webhook endpoint on staging** must list `payout.failed` / `payout.*` (Connect) and the subscription events the OG-05 notices rely on | Owner (Stripe dashboard, TEST first) | Confirm the endpoint's event list; no change was made from here |
| B5 | **Owner decisions still open**: D-04 VAT, D-05 listing re-approval, D-06 staff claims, D-07 resident suspension/deletion, D-09 commercial model, DEC-14 retention periods | Owner / legal | Until decided: no VAT invoices, no resident restrictions, no data deletion (erasure requests stay open) — all enforced in code |
| B6 | ~~Partner staff of any role could read customer names/emails~~ | — | **Cleared 2026-10-17:** Option A implemented and tested (above) |
| B7 | Company identity / legal publication / email sender checklist (pre-existing, from memory) | Owner | Before public launch |

Not blockers, but known: OG-08 restrictions are off (D-07). OG-30 request-to-book is not built (DEC-15). OG-25
statements are not VAT invoices (D-04). OG-15 exceptions have no assign/resolve state (no approved operating policy).

## Admin two-step key (`HELLO_CIRCLE_MFA_KEY`) — provisioning, protection, backup, recovery

Verified 2026-10-17 in the isolated test database (`adminMfaKey.test.ts`, 3/3, a fresh random key per run, never printed or
logged): secrets are stored AES-256-GCM-encrypted (never in clear); enrolment and sign-in work with a real key; a deployed
server (`NODE_ENV=production` or `APP_ENV=staging`) with no key refuses two-step set-up (503) instead of falling back to the
development key; a wrong-length key is refused; a changed key now fails with a clear message (it used to be a raw crypto
error); recovery codes still work after a key change; a super-admin reset lets the admin enrol again under the new key.
The server now logs `[mfa] …` at boot when the key is missing or malformed on a deployed server — the problem, never the key.

**Provision (once per environment; staging and production get different keys).**
1. On a trusted machine: `openssl rand -base64 32` (44 characters ending in `=`). Don't paste it into chat, tickets or git.
2. Put it in the server's environment only: on the VPS, the gitignored env file the service loads (same place as
   `STRIPE_SECRET_KEY`), owner-readable only (`chmod 600`). Never in `server/.env.production` in the repo, never in
   `DEPLOYMENT.md`, never in CI variables that print.
3. Restart the service and check the boot log has **no** `[mfa]` line. Then sign in as an admin: you should be asked to
   set up two-step sign-in. Save the 10 recovery codes.

**Protect.** Treat it like the database password: same access list, not shown in logs (the app never prints it), not in
backups of the repo. Rotating it is not routine: changing it makes every stored two-step secret unreadable.

**Back up.** Keep one copy in the owner's password manager (or an offline sealed copy) labelled per environment. The
nightly DB backups contain only the encrypted secrets — useless without this key, and the key is useless without them.
Restoring a DB backup needs the key that was live when that backup was taken.

**Recover.**
- *Key lost or changed by mistake:* restore the previous key if any copy exists (nothing else needed). Otherwise each admin
  signs in with one of their recovery codes, and another super admin resets their two-step sign-in (Admin → Settings → two-step card, "Reset…");
  they enrol again under the new key. Recovery codes and resets don't depend on the key.
- *An admin lost their phone and codes:* another super admin resets them (audited; their sessions end).
- *The last super admin is locked out:* no in-app path by design (a super admin can't reset themselves). Break-glass is a
  database operator clearing that one account's `mfa_*` columns and recovery codes, with the owner's approval, recorded in
  the audit notes — not automated.


## Database

All schema changes are additive and idempotent in `initSchema()` and run on first boot: 7 new tables and new nullable /
defaulted columns (listed in `hellocircle-implementation-summary.md`). This final pass added no schema. No
down-migration exists (project convention). Back up before the first boot of the new build (nightly backups already
run on the VPS).

## Rollback and its MFA security implications

**Mechanics.** Redeploy the previous build (no migrate). The new tables and columns are unused by the old code and can
stay; verified locally on 2026-10-17 (the previous release `1ba8c7b` boots and serves the site and admin pages on the
migrated schema).

**What a rollback does to admin security.** The previous release predates OG-07. While it runs:
- **Two-step sign-in is not enforced.** Any admin signs in with a password alone, and there is no 30-minute step-up on
  money, suspension, settings or deletion actions. Admin security drops to its 2026-10-15 level.
- **Super-admin invitations (OG-06) don't exist**, but `admin_invites` rows stay in the database. A pending invite link
  does nothing until you roll forward; then it works again until its 72 h expiry.
- **Existing two-step set-ups are kept** (encrypted in `users.mfa_*`) and start working again on roll-forward —
  **only if `HELLO_CIRCLE_MFA_KEY` is unchanged**. Never remove or regenerate the key as part of a rollback.
- **Sessions:** a session verified under the new build carries `mfa_verified_at`. The old build ignores it; after
  roll-forward, a session older than the step-up window is asked for a code again, as designed.
- Audit rows written by the new build stay. The old build doesn't show the new action types, but nothing is lost.

**So, during any rollback window:**
1. Keep it short, and treat it as an incident: tell the admins, and don't invite or create admin accounts.
2. If it lasts more than a few hours, or an admin password may be exposed, rotate admin passwords before the
   rollback, and again after roll-forward.
3. Prefer rolling forward with a fix over a long rollback. Restoring a pre-deploy database backup also removes every
   admin's two-step set-up made since then; they enrol again at their next sign-in.
4. Afterwards, check the audit log for admin sign-ins during the window.

## Known risks (2026-10-17)

| Risk | Detail | Status |
|---|---|---|
| **Intermittent field-help editor failure** (`REV-ADMIN-B-HELP-desktop`) | Admin → Settings → Field help → Edit. Once in about five runs of this test, the saved version had the *previous* example text, not the one just typed. The server stores what the browser sends, so the typed value was lost in the browser before Save. Seen once on 2026-10-16 (as a timeout) and once on 2026-10-17. It then passed 4 times in a row and in the full uninterrupted revenue run. No partner, payment or permission code is involved. | **Open, cause unknown.** The spec now asserts the dialog still holds the typed text after typing and just before Save, so the next occurrence shows which step loses it. Full Playwright traces stay off, because they would record QA credentials. Impact if real: an admin's help-text edit could save stale wording. It's versioned, so an admin can save it again. Workaround: check the new version's text after saving |
| Rollback removes admin two-step | See above | Procedure documented |
| Single MFA key per environment | Losing it makes stored two-step set-ups unreadable; recovery codes and super-admin reset still work | Backup procedure in the key section above |
| Booking notifications to a listing creator after a role change | See `hellocircle-remaining-decisions.md` | Owner decision |
| Staging shares the production VPS | One bad nginx reload or a heavy build can affect production | Existing guardrails: `nice` builds, nginx checksum check |

