# Staging release package: free participation (2026-10-11)

Prepared for review. **Nothing has been committed, pushed or deployed.** Production was not
touched. The staging checks were read-only: HTTPS probes, env var *names* and key *prefixes*
only, and SELECT counts on `hello_circle_staging`.

## 0. The scope question to settle first

The booking UX work is uncommitted on `feature/commerce-engine`. That branch is already
**36 local commits ahead of `origin/staging`**: Commerce Engine Phases 0–3 and Revenue/Connect
Stages 1–5f. Together they change 224 files, add about 29k lines, and none of them are pushed.

The booking work depends on those commits. It uses `refundPaidOnce`, `paymentProvider()`,
`processProviderOutcome`, `commerceSwitch` and the policy CMS for the terms version, all of
which come from them. **Shipping the booking work to staging therefore ships all 36 commits
with it.** Every commerce feature in them is behind a `commerce.*` switch that defaults to off
(see §4), but it is still about 30k lines of payment-adjacent code reaching staging for the
first time.

The alternative is cherry-picking the booking UX onto `staging` alone. That would mean
re-porting it onto the pre-commerce payment code, which is a rewrite, not a release.

**Recommendation:** release as one unit on `feature/commerce-engine`, through a PR into
`staging`, with the gating decision in §4 made first.

## 1. Files ready for commit (63 entries; all were validated in the readiness run)

Proposed as four commits on `feature/commerce-engine`:

**a. `feat: booking UX — server` (22)**
- New: `server/src/orderAcknowledgements.ts`, `server/src/providerCancelRefund.ts`,
  `server/src/routes/checkoutAbandon.ts`.
- Modified: `server/src/analytics.ts`, `checkoutService.ts`, `commerce/catalog.ts`,
  `db/index.ts`, `db/queries.ts`, `index.ts`, `selfCancel.ts`.
- Modified routes: `routes/availability.ts`, `bookings.ts`, `circles.ts`, `experiences.ts`,
  `games.ts`, `makeItHappen.ts`, `programs.ts`, `registrations.ts`, `vendorExperiences.ts`,
  `vendorOperations.ts`, `vendorPrograms.ts`.
- Modified shared types: `packages/types/src/index.ts`.

**b. `feat: booking UX — client` (38)**
- New: `client/src/components/booking/*` (14 files, including 3 tests),
  `components/VendorActionNeeded.tsx`, `pages/BookingKitPreview.tsx` (routed only when
  `import.meta.env.DEV`).
- Modified: `App.tsx`; `api/public.ts`, `api/resident.ts`, `api/vendor.ts`;
  `components/CircleJoinCard.tsx`, `CookieNotice.tsx`, `DiscoverRow.tsx`, `GameJoinCard.tsx`,
  `VendorBookings.tsx`; `gameCta.ts`.
- Modified pages: `pages/BookingFlow.tsx`, `CentreDetail.tsx`, `CircleDetail.tsx`,
  `ExperienceDetail.tsx`, `Games.tsx`, `Home.tsx`, `HostGamePage.tsx`, `ManageCircle.tsx`,
  `MyBookings.tsx`, `PaymentCancel.tsx`, `PaymentSuccess.tsx`, `ProgramDetail.tsx`,
  `RegistrationFlow.tsx`.

**c. `test: booking UX — server tests and updated browser specs` (12)**
- New: `server/src/routes/bookingAuditPhase0.test.ts`, `bookingUxPhase4.test.ts`,
  `bookingUxPhase5.test.ts`, `bookingUxPhase6.test.ts`, `checkoutAbandon.test.ts`.
- Modified specs: `tests/integration/specs/booking-ui`, `lifecycle-ui-bottom-chrome`,
  `revenue-credit`, `revenue-resident`, `stage-b-visibility-2`, `stripe-browser`,
  `stripe-refund` (`.spec.ts`).

**d. `docs: booking audit, UX plan, release readiness, staging package` (4)**
- `docs/booking-checkout-audit-2026-10-11.md`
- `docs/booking-ux-implementation-plan-2026-10-11.md`
- `docs/booking-release-readiness-2026-10-11.md`
- this file

**Hygiene checks**
- Secrets: no Stripe key, webhook secret, AWS/GitHub/Google key, private key or real
  password. The scan covered the working diff, untracked files and the 36 commits.
  - The only matches are Stripe *sandbox* account ids (`acct_1U…`) in
    `docs/revenue-connect/adr-accounts-v2.md` and `rollout.md`. These are identifiers, not
    credentials, but the repo is public. Redact them before pushing if you'd rather not
    publish the sandbox platform id.
- Ignored correctly: `.qa-data/`, `test-results/`, `playwright-report/`, `server/.env*`,
  `DEPLOYMENT.md`, `uploads/`, `dist/`.
- No database files, build output or QA artefacts are staged.
- No dependency changes: `package-lock.json` is unchanged, so `npm ci` is identical on the
  server.
- Unrelated changes: none in the working tree. The 36 commits do include 32 JPEG screenshots
  under `docs/revenue-connect/evidence/stage5f/` (already committed).

## 2. Migration impact (staging DB `hello_circle_staging`, now at `544e663`)

- **Strictly additive.** The schema has no `DROP`, `RENAME`, `MODIFY` or `CHANGE COLUMN`, and
  no destructive `ALTER`. This session's work adds:
  - three nullable columns: `circles.join_questions`, `circle_invites.note`,
    `circle_invites.answers`;
  - two new tables: `order_acknowledgements`, `experience_booking_participants`;
  - 12 new indexes, created through the idempotent `ensureIndex`.
- The 36 commits add 59 `CREATE TABLE IF NOT EXISTS` blocks and 88
  `ensureColumn`/`ensureIndex` calls, plus four idempotent backfills:
  - partner-created coupons are marked partner-funded;
  - superseded system pricing drafts are marked `discarded` (kept, not deleted);
  - existing admins get `admin_role='super'`;
  - the privacy policy is set to acknowledge-only.
- The old boot backfill that set pending rows to `paid` is now **narrower**: it only touches
  rows created before 2026-07-24. That is a safety fix (audit R8).
- Index builds on staging's small tables (0 bookings, 16 centres, 18 clubs) take well under
  a second.
- **There is no down-migration.** The schema rollback is restoring the `pre-<commit>` backup
  taken in deploy step 3. The old code ignores the extra tables and columns, so an
  application-only rollback also works without a restore.

## 3. Staging configuration checklist (verified read-only on 2026-10-11)

| Item | State | Status |
|---|---|---|
| HTTPS | Let's Encrypt `CN=staging.hellocircle.ie`, expires 2027-01-02; HTTP 301 → HTTPS; HSTS 1y | ✅ |
| Indexing | `X-Robots-Tag: noindex, nofollow` | ✅ |
| Access | Tester gate (`/__gate/login`); `STAGING_GATE_SECRET` is 64 chars; users file set | ✅ |
| Health | `GET /api/health` → 200 `{ok:true}` | ✅ |
| Process | `hellocircle-staging` active on `127.0.0.1:3002`; `NODE_ENV=production`, `APP_ENV=staging` | ✅ |
| Isolation | `DB_NAME=hello_circle_staging`; env file mode 600, owned by `hellocircle` | ✅ |
| Email | `SMTP_HOST=smtp.gmail.com:465`, user and password set; `MAIL_FROM` says "(staging)" | ⚠ configured, **not send-tested** (a test send is outward, so it needs your go-ahead) |
| Auth | Magic link uses SMTP; `FIREBASE_PROJECT_ID` set (keyless Google sign-in) | ⚠ Google needs a browser click-through by you |
| Notifications | In-app `notifications` table plus email; email failure never blocks an order | ✅ code; ⚠ email per row above |
| Stripe | `STRIPE_SECRET_KEY` = **`sk_test_`**; `STRIPE_WEBHOOK_SECRET` set | ⚠ see §4: paid checkout is reachable in test mode |
| Commerce switches | `app_settings` is **empty**, so every switch is at its catalog default (off) | ✅ |
| Host load | load 0.26; 42 GB disk free; about 2.5 GB RAM available | ✅ |
| Backups | Nightly, plus `pre-544e663` from the last deploy | ✅ |

`QA_STAGING_ENVIRONMENT.md` §"Not configured yet (Phase 13B)" is out of date: Stripe TEST,
SMTP and Firebase are now set. That doc needs a one-line update; I haven't changed it.

## 4. Gating: paid participation, Open Booking, Make It Happen

**Commerce switches, catalog defaults:**
- **Off:** `engine_v2`, `engine_v2_experience`, `shadow_pricing`, `coupons_v2`,
  `settlement_ledger`, `connect_v1`, `circle_credits`, `pro_subscriptions`,
  `customer_credits`, `boost_vouchers`, `venue_host_split_payout`, `open_booking`,
  `require_second_approver`.
- **On:** only `paid_games_require_verified_host`, which is protective.
- Staging has no overrides.

**Open Booking and Make It Happen stay disabled.**
- `openBookingAvailable()` requires the global `commerce.open_booking` switch *and* the org
  flag. The org flag defaults to true, so the global switch is the gate.
- `/api/make-it-happen/search` and `/confirm` return 503 `{paused:true}` while it's off.
- Covered by `bookingAuditPhase0.test.ts`, test B6.

**Paid checkout is NOT disabled on staging.** There is no "paid launch" switch in the code.
The only server gate is whether a payment provider is configured.

- Without a provider, every online checkout returns **503 and deletes its pending row**. That
  covers venue booking, club registration, programme, experience, paid game and pass.
- The QA stub provider can't turn on in staging: it requires `NODE_ENV=test`.
- **But staging has a Stripe TEST key**, so a direct API call can create a test-mode Checkout
  session and a pending order. No real money can move, because the key is `sk_test_`.
- **Pay-at-venue rooms and clubs** don't use a provider at all. They confirm immediately with a
  price "due in cash on arrival", and that total still includes the 23% VAT and 5% fee lines
  (audit P0). Staging currently has 0 active cash rooms.

**Decision needed (pick one before deploying):**
1. **Config only (recommended for this release).** Unset the two `STRIPE_*` keys in staging's
   `shared/server.env` (you run `hellocircle-staging-set-secret` or edit the file), and leave
   cash rooms off.
   - Every online paid endpoint then returns 503 server-side, with no code change and no
     pricing change.
   - The cost: the staging Stripe webhook test, an open paid-launch prerequisite, has to wait.
2. **Code gate.** Add a `commerce.paid_checkout` switch, default off, checked in
   `createCheckoutSession()` and on the cash path, with a 503 and tests.
   - This is a small change, but it is a new code change after validation, and production's
     existing paid flows would need the switch turned on when this reaches `main`.
   - I have not built it.
3. **Accept test-mode payments on staging** and tell testers that only free flows are in scope.

## 5. Refund and cancellation permissions (server-side)

- Explicit refunds require `finance`:
  - `POST /vendor/bookings/:ref/refund`, `/registrations/:ref/refund` and `/refunds`;
  - the experience refund route;
  - the programme refund route, via `assertPlatformRole(…, "finance")`;
  - admin finance, via `requireAdminRole("finance")`.
- Vendor cancels require `centre_manager` (bookings), `facility_manager` (registrations), or
  the programme or experience operations roles.
- Customer self-cancel goes through `bookingChangeBlock`/`registrationCancelBlock`
  (deadline, linked-activity 409).
- Covered by `qa:authorization` (83 passed) and the Phase 5/6 tests.
- **Changed by this release (B13):** a vendor cancel of a *paid online* order now refunds it in
  full automatically, once, and audits it.
  - This means a `centre_manager` or `facility_manager` without `finance` can now cause a
    refund by cancelling.
  - That's the intended customer-protection behaviour, but it widens who can trigger a
    refund. Confirm it's acceptable, or I'll restrict auto-refund to finance and have
    everyone else flag the order as "refund pending".
  - With paid checkout gated (§4), there's nothing to refund on staging.

## 6. Test status and what couldn't be done

All of this was run on this exact working tree, unchanged since:
- server 801 passed / 23 skipped; client 172; typecheck and build;
- `qa:booking` 38, `qa:lifecycle` 49 + HC-QA-001 3, security gate 39, authorization 83;
- Chromium browsers 75, revenue 38, Stripe test mode all green, mobile sweep 66/66.

**Task 9 (idle CI runner) is not done.**
- `web-ci.yml` runs only build plus client/server unit tests. There's no Playwright job, so
  Firefox and WebKit can't run on CI without adding one (a CI change plus a push, both need
  your approval).
- This Mac isn't idle: Illustrator is at 85% CPU and the load average is about 6.
- I tried running WebKit `LC-UI-DESKTOP-HOST` on the committed `HEAD`, without the booking
  work, to see whether that failure predates it. That needs the fixed-port QA database the
  main checkout already holds, and retiring that container was blocked by the permission
  classifier, so I stopped.
- A detached worktree is left at
  `$TMPDIR/claude-501/…/scratchpad/hc-base` (its only extra is a `node_modules` symlink).
  Remove it with:
  `rm <path>/node_modules && git worktree remove <path>`

## 7. Free-participation smoke checklist (staging, after deploy)

Use the tester accounts (resident `shiva`, admin `gopal`), plus one host and one provider
from `npm run tester`.

1. The gate login works, and the footer shows the new build sha.
2. Browse home, Games and Circles; a centre page with no Open Booking / Make It Happen entry.
3. `curl -X POST …/api/make-it-happen/search` (behind the gate) → 503 `paused:true`.
4. **Free game.** A resident joins a free game. If it has a minimum age, the confirm step
   appears. The join appears under My bookings.
5. **Free game, leave.** Leave the game; the place goes back to the pool.
6. **Host a game.** A host creates a game at an address (no venue). The venue option needs
   the host's own booking (400 `needsVenueBooking` otherwise).
7. **Open Circle.** Join an open Circle; membership shows on the Circle page.
8. **Approval Circle.**
   - The organiser sets two questions.
   - The requester sends a note and answers.
   - The organiser sees them paired and approves.
   - A second approve is a no-op.
9. **Free trial.** Register a child for a free club trial; it confirms with no payment. A
   second trial for the same child returns "already had a free trial".
10. **Free programme.** Enrol a household member in a free programme. The terms checkbox is
    required in the UI.
11. **Self-cancel.** Cancel the free registration from My bookings, before the deadline
    (`canCancel` from the server).
12. **Vendor cancel.** A provider cancels a free registration; the response says
    `refund: "none"`, and the participant is notified in-app.
13. **Mobile.** Repeat steps 4, 9 and 11 at 375px: the cookie banner, bottom nav and submit
    bar don't overlap, and "Accept all" isn't clipped.
14. **Paid paths blocked.** With §4 option 1 applied, a paid room booking and a paid club
    registration return the 503 "Payments aren't configured yet", and no pending row remains.
15. **Email.** Only if you approve a real send: a magic-link email arrives from
    "Hello Circle (staging)".

## 8. Remaining risks

- **R1 (high).** About 30k lines of switch-gated commerce code reach staging for the first
  time. They're validated in isolated QA, not yet on a real host.
- **R2 (high).** Paid checkout is reachable on staging until §4 is decided.
- **R3 (medium).** The auto-refund on vendor cancel widens who can trigger a refund (§5).
- **R4 (medium).** Firefox and WebKit are not green.
  - Firefox: the known flaky `LC-UI-DESKTOP-PARTICIPANT` timeout.
  - WebKit: `LC-UI-DESKTOP-HOST` (module-import failure on `/manage/circles/:id`) is
    unresolved. That page is one this release changed, so the base-commit comparison
    matters.
- **R5 (medium).** Email and Google sign-in on staging are configured but not exercised.
- **R6 (low).** Acknowledgements are recorded, not enforced, server-side. The cash total
  still shows VAT and fee lines (P0, unchanged by instruction). `ClubDetail` pass price is a
  client-side estimate.
- **R7 (low).** The public repo will carry the Stripe sandbox account ids.
- **R8 (low).** `capacitor.config.ts` has a dev `server.url` localhost override. No native
  build is part of this release.
- **R9 (ops).** Staging shares the production host. The build runs at `nice 19`; production's
  service and DB aren't touched by any step below.

## 9. Deployment steps (on approval only)

1. Commit the four commits above locally. Optionally redact R7.
2. Push `feature/commerce-engine` and open a PR into `staging`. Web CI must be green.
3. Apply the §4 decision on staging.
4. Merge the PR, then follow the deploy runbook (`QA_STAGING_ENVIRONMENT.md`) as
   `hellocircle`:
   1. `git fetch && git checkout <sha> && npm ci`
   2. `nice -n 19 npm run build`
   3. `hellocircle-staging-backup pre-<sha>`
   4. `npm run migrate --workspace server`, which must print
      `target database=hello_circle_staging`
   5. `systemctl restart hellocircle-staging`, then `curl 127.0.0.1:3002/api/health`
5. Run the §7 smoke checklist, and check `journalctl -u hellocircle-staging` for errors.

## 10. Rollback

- **App only** (the schema can stay, since it's additive):
  1. `git checkout 544e663 && npm ci && nice -n 19 npm run build`
  2. `systemctl restart hellocircle-staging`
- **Full**, if data written by the new code must go: the app rollback, then restore
  `pre-<sha>`:
  `gunzip -c /var/backups/hellocircle-staging/hello_circle_staging-…-pre-<sha>.sql.gz | mysql --defaults-extra-file=/root/.hellocircle-staging-backup.cnf hello_circle_staging`
- **Git:** revert the PR merge on `staging` (a revert PR; force-push is blocked by the
  ruleset).

## 11. Staging Go/No-Go

**Conditional GO for free participation on staging** once all of these are true:
- (a) a §4 option is chosen and applied (option 1 recommended);
- (b) you accept shipping the 36 commerce commits with it (§0);
- (c) you accept the §5 refund-permission change, or ask for the finance-only variant.

It can't be a clean GO while R4 (WebKit on a changed page) is unexplained. Treat Safari as
"known issue, verify by hand" in the smoke pass, or authorise the base-commit comparison or a
Playwright CI job first.

Paid participation stays **NO-GO**, unchanged from the readiness report.
