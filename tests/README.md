# HelloCircle browser QA

## Phase 8 — Booking integrity, no payment provider (current)

`npm run qa:booking` uses the same guards and run lock as the other suites, with a fresh backend per batch. Batches:
- `booking-{centre,club,program,experience,activity}`: API and DB, including concurrency.
- `booking-ui`: desktop and mobile journeys; the mobile run keeps the consent banner showing.
- `booking-provider`: the paid state machine through the QA provider seam (QA_PAYMENT_PROVIDER_STUB is set for this batch only).
- `booking-remediation` and `booking-remediation-cancel-{booking,registration}`: the extended scenarios. Each cancel race runs in its own batch because of the lookup limiter.
- `booking-findings-{a,b,c}`: the finding gate HC-QA-034..047 (all PASS after remediation). Verify one with `--grep 'HC-QA-0NN'`.

Full run: `npm run qa:booking` (exit 0). Resources come from `booking-fixture.ts` (vendor-owned, made bookable by exact-ID updates). Guests are separate `X-Client-Id` contexts. Cleanup is timeout-safe through the lifecycle-fixture `test`/`withActors`. Stripe stays unconfigured; `/api/__qa/outbound` must report 0 blocked attempts and no provider configured.

## Phase 7 — Activity & Circle lifecycle (current)

`npm run qa:lifecycle` — same guarded runner, connected isolation checks, run lock and
fresh backend per batch as qa:auth/qa:authorization (real limiter respected). Batches:
lifecycle-activity-{publish,participation,access,states}, lifecycle-circle-{membership,planning},
lifecycle-notifications, lifecycle-ui-desktop, lifecycle-ui-responsive (tablet 820x1180,
mobile 390x844), lifecycle-ui-bottom-chrome (HC-QA-001 consent/fixed-bottom layout),
then the lifecycle-findings-* gate. Free synthetic activities only; no Stripe,
email, external providers; exact-ID cleanup via withActors.

- Default run is the full gate: 20 lifecycle scenarios + 29 finding-gate cases (HC-QA-022..033
  remediated; originals unchanged plus *-INVARIANT/*-SEMANTICS/*-CROSS-SCOPE), exit 0.
- Finding gate is split into 9 `lifecycle-findings-*` files so each fresh backend stays within the
  real 10-login limiter. One finding: `npm run qa:lifecycle -- --grep 'HC-QA-026'`.
- Helpers: `lifecycle-fixture.ts` (API/DB, notification href via the real client mapping),
  `lifecycle-ui-fixture.ts` (per-persona browser contexts; consent pre-decided except the
  dedicated consent-overlap check). State matrix evidence: `evidence/lc-act-state-matrix.json`.
- Cleanup: lifecycle specs import `test`/`withActors` from lifecycle-fixture; tracked exact IDs are
  also deleted in an auto-fixture teardown, which Playwright runs even after a test timeout.

## Final Stage B closure

The existing qa:security-gate and qa:authorization runners now include the five
closure batches: activity-invitation-closure, chat-closure, account-link-closure,
account-link-race-closure and revocation-closure. Eight new scenarios; complete
security gate 39 PASS, HC-QA-002..021. No new command or external dependency.
Run real suites sequentially using existing isolation checks and exclusive lock.
Separate account-link batches respect the real request limiter without bypassing it.

RECOVERY COMPLETE: fresh disposable QA bootstrap generated new independent credentials;
environment.json and empty.env are retained outside the repository with mode 0600.
Current unfiltered results: qa:auth 20 PASS, qa:authorization 83 PASS, security gate
39 PASS. Stage B is security-complete locally within the defined matrix, not deployed.
QA_STAGE_B_FINAL_CLOSURE.md documents findings and invariants; QA_ENVIRONMENT_RECOVERY.md
records the approved recovery, remaining fixture residue and unknown missing-file cause.

Keep the private files for repeatable runs. Never infer/reconstruct credentials from
development/production, bypass missing-config guards or use root for tests. For an
existing valid run: qa:preflight -- --current performs offline checks (intentional
exit 2 means connected identity still unverified), then qa:preflight:connected must
pass before qa:db:seed or real suites. Setup refuses an existing manifest; reset
requires its independent connected guard. Missing configuration requires explicit
identity-verified recovery, not a relaxed reset. No recovery command was added.

## HC-QA-016 closure (historical)

`npm run qa:security-gate` now includes HC-QA-002 through HC-QA-016, including the
unchanged `stage-b-open.spec.ts` and three new `join-visibility.spec.ts` cases.
Focused: `npm run qa:authorization -- --grep 'HC-QA-016'` (four scenarios).
Full: `npm run qa:security-gate`, `npm run qa:auth`, `npm run qa:authorization`.
Run real suites sequentially; existing run lock, per-batch limiter and connected
isolation checks remain mandatory. Do not use historical exclusion instructions
below for the current green gate.

No auth API mocked. Synthetic free/public/invite/Circle activities and only a local
503 paid-provider control; the backend refuses a configured Stripe client and blocks
external sockets. Test-only `/api/__qa/outbound` returns a count and configuration
boolean, never credentials. Production has no such endpoint. Evidence contains safe
statuses/counts only. Reporter failure diagnostics expose test file/line only.

HC-QA-016 fixed locally, not deployed. HC-QA-001 remains the known mocked smoke
failure. Stage B sign-off and lifecycle/payment testing are not part of this closure.

Final closure results: gate 31 PASS; auth/security 20 PASS; authorization 75 PASS;
safety 91 PASS; client 81 PASS; typechecking/build PASS; mocked smoke 13 PASS / 1
known HC-QA-001 failure. The four focused cases are subsets, not additive coverage.
Subgroup breakdown and remaining review gaps are recorded in QA_REPORT.md.

## Historical Stage B remediation (before HC-QA-016 closure)

- Canonical activity visibility lives in `server/src/gameVisibility.ts`; see
  `QA_ACTIVITY_VISIBILITY_POLICY.md`. New coverage: `specs/stage-b-visibility.spec.ts`
  (VIS-010/011/012, 8 logins) and `specs/stage-b-visibility-2.spec.ts` (VIS-COUNTS/013/014-015,
  9 logins) — split to stay within the real limiter.
- `npm run qa:security-gate` now also runs `stage-b-findings.spec.ts` (HC-QA-010..015): 27 PASS.
- `specs/stage-b-open.spec.ts` preserves open HC-QA-016 and runs LAST in `qa:authorization`
  (71 PASS then red). Diagnostic: `--grep-invert 'HC-QA-016'`.
- VIS-COUNTS was also executed once with the count predicate temporarily removed to prove the
  disclosure (FAIL), then the source was restored byte-identical and re-verified (PASS).


## Phase 6B — Stage B completion (latest)

New commands / batches (same guarded runner, same connected safety checks):

```sh
npm run qa:security-gate        # permanent HC-QA-002..009 regression gate (21 cases), must be green
npm run qa:authorization        # 59 PASS, then stops red on preserved open findings (runs last)
npm run qa:authorization -- --grep-invert 'HC-QA-01[0-5]:'   # diagnostic baseline: 59 PASS, exit 0
npm run qa:authorization -- --grep 'HC-QA-011:'              # one preserved finding
```

- Stage B specs: `specs/stage-b-{vendor,refund,org,host,circles,aggregation,admin,booking,personal,errors,media}.spec.ts`,
  helper `stage-b-fixture.ts` (synthetic staff login, inserts, exact-scope cleanup, canary leak assertion).
- One batch per spec file: a fresh backend per batch keeps each within the real (not
  disabled) 10-login password limiter and 10-request lookup limiter. The gate splits
  HC-QA-002 across four batches for the same reason — a single combined batch
  exhausts the limiter and fails AUTH-SEC-008 spuriously.
- `specs/stage-b-findings.spec.ts` preserves HC-QA-010..015 as unskipped failing
  regressions. It is the LAST authorization batch, so the default run reports every
  other batch first. `maxFailures: 1` means only the first finding executes in a full
  run; run each by `--grep` for independent evidence. The `--grep-invert` baseline
  is a diagnostic, not a green full suite.
- Refund authorization is proven up to the provider boundary (Stripe unset → 502
  "Payments aren't configured"); media up to the storage boundary (503). Positive
  refund and real media delivery/deletion are EXTERNAL PENDING, never PASS.
- Synthetic cash-marked `paid` rows (no stripe session) exist only so status-gated
  cancel/check-in paths are reachable; no checkout or provider call occurs.
- Scoped no-op routes (e.g. foreign org invite revoke, foreign programme session
  delete, foreign poll close) return 200 by design; the DB snapshot is the assertion.
- Post-run residue check found zero synthetic Stage B rows left in the QA database.

Latest validation (separate lanes, not summed): safety 91 PASS; client 81 PASS;
typecheck/build PASS; auth/security 20 PASS; security gate 21 PASS; authorization/
remediation 59 PASS + 6 open findings; IDOR subset 26 PASS; aggregation subset 5 PASS
(+ HC-QA-011/012/015 open); invitation subset 12 PASS (8 dedicated + 4 adjacent);
mocked smoke 13 PASS / 1 known HC-QA-001 failure.


## HC-QA-008 remediation (latest)

The default `npm run qa:authorization` again includes the original HC-QA-008
regression without exclusions/skips. Focused command:
`npm run qa:authorization -- --grep 'ATTENDANCE-(READ|WRITE|SIBLINGS):|STAGE-B-CHILD:'`.
Four real API/MySQL scenarios cover read relationships, enrollment write boundaries
and nearby cancellation/deletion invariants. Unpaid synthetic data only, no Stripe.
HC-QA-008 P1 and adjacent HC-QA-009 P2 are fixed locally, not deployed. Broader
Stage B remains paused for review. Older stop/exclusion instructions below describe
the pre-fix checkpoint and are not needed to get a green current security run.

Remediation validation: full `qa:authorization` 41 PASS, full `qa:auth` 20 PASS,
safety 91 PASS, client 81 PASS, typechecking/build PASS. Focused attendance 4 PASS
is a subset of authorization. HC-QA-002 through HC-QA-009 regressions pass.
Mocked smoke remains 13 PASS / 1 known HC-QA-001 failure. No deployment occurred.

## Historical Phase 6 — HC-QA-008 mandatory stop (before remediation)

`npm run qa:authorization` now runs the preserved cross-organisation attendance
regression first and stops red. Focused reproduction:
`npm run qa:authorization -- --grep 'STAGE-B-CHILD:'`.
It creates only synthetic programmes/session/unpaid enrollment/attendance, verifies
distinct organisations and exact DB invariants, then cleans exact fixture IDs.
No checkout, Stripe, customer record or production access.

Diagnostic pre-existing baseline only:
`npm run qa:authorization -- --grep-invert 'STAGE-B-CHILD:'`.
This deliberate exclusion does NOT mean the full suite is green or the defect fixed.
No skip/expected-fail marker was added. New Stage B probes are stopped for review.
Sanitized evidence is stored under the ignored current-run evidence directory.

Final Phase 6 validation: new attendance regression FAIL; explicitly filtered prior
authorization/remediation baseline 37 PASS; auth/security 20 PASS, safety 91, client
81, typechecking/build PASS; mocked smoke 13 PASS / unchanged HC-QA-001 failure.
HC-QA-002 through 007 remain PASS. Full Stage B remains incomplete and unsafe to
sign off while HC-QA-008 is open.

Playwright grep matches a full test path/title, not only the displayed title.
An initial anchored filter selected zero tests and is not counted as coverage.

## Invitation closure — 2026-09-29 (latest)

`npm run qa:authorization -- --grep 'INVITE-(BINDING|CONCURRENCY|STATES|HISTORY):'` runs five closure scenarios:
binding, legitimate-recipient concurrency, existing-member/no-upgrade cases,
invalid invitation states and synthetic historical-audit cleanup. Real API/MySQL,
existing connected safety guard, exact fixture cleanup, no external email/provider.
No new command or production migration runner. The historical helper additionally
requires exact audit IDs and current-run synthetic markers, refusing unknown scope.

Acceptance requests in these tests are exclusively synthetic: mismatches assert
denial, intended recipients exercise normal onboarding. No privilege-escalation
probe. Original HC-QA-006 disclosure regression is unchanged. Production migration
plan is QA_INVITATION_AUDIT_MIGRATION_PLAN.md; never point tests at shared databases.
Full authorization/remediation: 37 passed (8 invitation scenarios included).

Final closure baseline: real auth/security 20 PASS; safety 91; client 81;
typechecking/build PASS; mocked smoke 13 PASS / known HC-QA-001 failure. No invitation
traces/screenshots or persisted authentication states: artifacts remain sanitized.

## Defensive hardening follow-up (latest)

The existing `qa:authorization` command includes an invitation-hardening batch.
Focused filter: `npm run qa:authorization -- --grep 'INVITATION-AUDIT|INVITATION-EXISTING'`.
Tests use real guarded QA API/MySQL; no external email or other-recipient redemption.
New audit records must never contain the bearer token. Own existing-recipient
acceptance must reject without changing account/invite/session state. Creation
audit history uses the same non-redeemable ID as the HC-QA-006 owner metadata.
See QA_INVITATION_SECURITY_REVIEW.md for deferred acceptance/retention risks.
Broad Stage B remains paused. HC-QA-001 remains the known mocked-smoke failure.

Latest full validation: safety 91, client 81, auth/security 20, authorization/
remediation 32 passes; typechecking/build pass; mocked smoke 13 passes / HC-QA-001
failure. Existing response-disclosure regression is unchanged. Acceptance concurrency
is code-review-only, not a passing atomicity test.

## Focused HC-QA-006 checkpoint (latest)

`npm run qa:authorization -- --grep INVITATION-DISCLOSURE` runs the defensive
invitation-disclosure regression with the existing connected guard and synthetic
fixtures. No invitation is redeemed. Checks owner creation/revocation, staff and
resident read boundaries, non-redeemable IDs, secret-free responses and DB
invariants. The case failed before the fix and now passes. Acceptance remains
code-review-only. Broader Stage B coverage is paused for review.

Current full results: 29 authorization/remediation passes; 20 real auth/security
passes; safety 91, client 81; typechecking/build pass. Mocked smoke retains 13
passes and the HC-QA-001 failure. Older Phase 4 failure results below are historical;
HC-QA-003/004/005 fixes passed before this focused checkpoint. All local only,
not deployed. See QA_BUGS/HC-QA-006.md for residual acceptance/audit risks.

There are separate lanes. `qa:smoke` retains the original real-frontend/**mocked API** foundation. `qa:auth` and `qa:authorization` use the **real frontend, backend, middleware and disposable MySQL**. None tests Stripe, Firebase, email delivery or cloud storage.

## Phase 4: RBAC, ownership and recovery audit

```sh
npm run qa:preflight:connected
npm run qa:db:seed
npm run qa:authorization
# Independently inspect preserved findings after reviewing severity:
npm run qa:authorization -- --grep IDOR-LEAKAGE
npm run qa:authorization -- --grep HC-QA-004
npm run qa:authorization -- --grep HC-QA-003
```

The authorization runner stops at the first failed test/batch. It does not mark known vulnerabilities expected-to-fail or skip them. Therefore the default run stops at HC-QA-005; the two recovery/logging findings were also executed separately. A filtered run is not a full green suite. Do not continue probing unrelated resources after a new P0/broad escalation; review the finding first.

Paired residents/hosts/vendors are deterministic; scenario-owned resources have unique synthetic IDs and exact-scope cleanup after independent connected verification. Sessions remain in memory and credential-bearing traces/screenshots are disabled. Sanitized evidence is in `.qa-data/<run>/evidence/`; never upload the whole QA directory or private manifest/secret files. Scenario diagnostics intentionally contain only status/count/boolean facts.

See [authorization matrix](../QA_AUTHORIZATION_MATRIX.md) for tested methods and pending surfaces. This is bounded security coverage, not a complete penetration test. HC-QA-003/004/005 remain open and red; no product code was changed in this phase. The email logging diagnostic uses a noncredential canary and never sends an email. HC-QA-001 remains open; HC-QA-002 must stay green.

## Phase 3: isolated real authentication

**Current stop: HC-QA-002 is fixed and verified locally, awaiting review/deployment.** The original regression passed unchanged after failing before the fix. The default real-auth run now has **20 passing cases**: eight established auth checks, the original security regression and eleven focused security cases. Do not skip/expect-fail security regressions to make CI green. See [the bug report](../QA_BUGS/HC-QA-002.md). HC-QA-001 remains unchanged/open in mocked mobile coverage.

Prerequisites: Docker Desktop running; cached `mysql:8.0` image; dependencies/Chromium installed; ports 13306, 4311 and 4178 free. Never source `server/.env`, use `switch-db.sh`, or supply shared-development/root credentials to these commands.

```sh
# Once per disposable run; refuses to overwrite a current run.
npm run qa:db:setup

# Offline: expected exit 2 for acceptable config; NOT permission to mutate.
npm run qa:preflight -- --current

# Read-only connected identity/grant/container verification: expected exit 0.
npm run qa:preflight:connected

# Explicit guarded application schema/persona setup; safe to repeat.
npm run qa:db:seed

# Real auth and security; currently 20 passed, exit 0.
npm run qa:auth

# Optional targeted investigation; does NOT replace the full regression run.
npm run qa:auth -- --grep SEC-REVIEW-001
```

`qa:db:reset` independently verifies isolation, refuses concurrent QA connections/operations, removes only the current verified container/network, and creates a fresh empty run. It destroys that container's synthetic DB irrecoverably. Re-run `qa:db:seed` afterward. Do not reset when you need to retain a failing run's state/evidence. Existing evidence directories and credential directories are not globally deleted.

Setup generates per-run secrets in a private OS temporary directory, outside the repository. The ignored `.qa-data/current.json` records the run and credential-directory locator. No real secret belongs in `.env.test.example` or reports. Temporary directories may disappear after OS cleanup; fail closed and recover the exact QA resources rather than pointing at another database. Docker tmpfs data is lost when its container stops.

The existing offline profile variables are documented in `.env.test.example`; real commands generate and pass those same names as a sanitized child environment rather than importing application `.env` files. Bare `qa:preflight` preserves the original `.env.test`/shell behavior. Only offline `--current` reads generated configuration without Docker/MySQL access.

Safety layers: strict configuration → exact container/image/labels/mounts/loopback binding → actual MySQL database/account/UUID/grants/marker → real application pool identity → identity through the frontend API proxy. Each mutation-capable entry point rechecks; no reliance on a previous command's result. Seed/reset/auth share an exclusive operation lock. Do not bypass a leftover lock without checking its recorded process and stopping the associated QA services.

Seven primary personas are seeded, plus one suspended vendor control. Host is a resident with verified host status; vendor/admin use the real users role model. A/B ownership pairs use separate IDs and sessions. Generated passwords use production bcrypt; no password hashing changes or auth backdoors. Authentication states stay in memory, not committed or attached to reports.

The real suite uses one desktop Chromium worker and zero retries. The runner executes four bounded batches with fresh backends (core: 9 tests, collisions: 5, flows: 4, recovery: 2); these stay within the real shared password limiter, which is not disabled. A red batch stops subsequent batches. Only `--list`, `--grep` and `--grep-invert` arguments are accepted and are applied within each batch. Filtered empty batches are allowed; filtered results do not constitute a full suite. No HelloCircle API is fulfilled with a synthetic response. External browser calls are blocked; the test-only backend wrapper denies sockets other than QA MySQL and suppresses token-bearing application email logs. Real Vite uses a separate ignored optimizer cache from mocked/dev Vite.

Real-auth recording is intentionally stricter than mocked smoke: no screenshots/videos/traces/storageState or DOM copy prompts. A sanitized reporter records statuses in `.qa-data/<run-id>/evidence/auth-results-{core,collisions,flows,recovery}.json`; the passwordless probe records boolean/status evidence in `passwordless-signup.json`. These are latest-run files, not an immutable history; do not mistake a historical `auth-results.json` for the current aggregate. Do not upload the whole `.qa-data` tree or secret directory. Mocked screenshot/video/trace behavior remains unchanged.

Phase 3's startup change skips demo/default-admin seeding with **both** `NODE_ENV=test` and `QA_E2E_ENABLED=true`; schema initialization/backfills remain real and guarded. The wrapper's identity endpoint is test-only, not a production route. The subsequently approved HC-QA-002 service fix rejects public signup for all existing emails; only that intended security behavior changes, with no UI/OAuth/schema redesign.

After the approved P0 remediation and successful verification, further implementation is stopped for review. Next: review/deploy the patch and separately approve isolated authorization/IDOR testing. Live Google/Firebase and email delivery remain untested; reset concurrency and non-SMTP secret-link logging need separate hardening review. No payment/booking/media or CI integration is included here.

## Mocked foundation (retained)

The mocked lane does **not** prove authentication, database persistence or backend authorization. Its original setup and commands follow.

Phase 2 environment audit and real-auth/IDOR plan: [QA_ENVIRONMENT.md](../QA_ENVIRONMENT.md). The current development backend has live-capable email/cloud credentials and uses a shared database; it is not an isolated QA backend.

## Commands

```sh
npm ci
npx playwright install chromium
npm run qa:check
npm run qa:smoke
npm run qa:report
```

`qa:check` runs the environment/request-policy tests and typechecks test code. It never loads `server/vitest.setup.ts` or connects to MySQL. The existing root `npm test` still runs DB-backed server tests; do not substitute it without provisioning their environment.

`npm run qa:preflight` validates **only offline configuration** for the proposed local auth profile, using the existing `tsx` dependency and `.env.test` with explicit shell overrides. It never imports application/database code. Exit **1** means unsafe/missing configuration; exit **2** means configuration is acceptable but real database identity/grants, mounts and network isolation are still unverified. There is deliberately no “ready to mutate” exit code. It neither provisions nor starts anything. See the commented Phase 2 inputs in `.env.test.example`; do not copy development credentials into them.

`qa:smoke` starts an isolated Vite server at `http://127.0.0.1:4177`, refuses to reuse an existing listener, disables application `.env` loading, and sets public launch mode. The server has no API proxy. Firebase configuration and Mapbox are disabled. API responses are explicit route fixtures; unknown API requests fail the test and never reach a backend. Third-party images/styles are replaced locally and recorded; any other external request fails. This is functional browser coverage, not a typography, media-delivery, or map test.

Seven scenarios run at both 1440×900 and 390×844: landing/partner navigation, resident sign-in/signup navigation, vendor and admin guest redirects, sign-in overflow/keyboard order, and injected 401/500 handling. Synthetic invalid input is not a real test-account credential.

## Selected local/staging API target

Copy `.env.test.example` to `.env.test`, or set the environment directly. Use `E2E_MODE=live-readonly`, `E2E_ENVIRONMENT=local|staging`, and `E2E_BASE_URL` for an **already running** server. Staging additionally requires HTTPS and `E2E_STAGING_ORIGIN` equal to the exact approved origin. Then run:

```sh
npm run qa:e2e
```

This selects only `tests/api/read-only.spec.ts`. It checks health, empty guest/vendor sessions, and unauthenticated vendor/admin boundaries. It does not start Express: its startup runs migrations and seeds. Every request uses an explicit allowlist and disables redirect following. No account credentials, storage state, production mode, mutation tests, payment tests, or cleanup scripts are enabled. Declaring a hostname staging is an operator assertion, not independent proof that its backing database is isolated. Known production origins are rejected.

The guard also refuses `NODE_ENV=production`, production DNS trailing-dot aliases and ambiguous/credential-bearing API URLs. The live read-only suite is not permission to target the currently configured shared database. A future real-auth launcher must verify the actual target and sanitize its child environment before backend imports; the offline preflight alone cannot do that.

## Fixtures and failure policy

- Import browser `test`/`expect` from `tests/fixtures/browser.ts`; its automatic fixture installs interception and monitoring before navigation.
- Mock only routes needed by a scenario. Never default an unknown endpoint to an empty success response.
- Expected error responses require exact method/path/status and a reason. Only the corresponding Chromium HTTP console message is ignored. Other console errors, page errors, failed same-origin requests, and unexpected HTTP errors fail the test.
- Role/label selectors first. Do not force a click through another element, inject CSS to make a test pass, or use sleeps to hide layout/race failures.
- Keep each test independent. Add page objects when behavior is reused enough to justify them; no empty directory/page-object scaffolding.
- New API/browser mutation suites require a dedicated test DB, fixture/reset ownership, sandbox Stripe and media targets, mail sink, and verified environment provenance first. Do not add them to the current read-only suite.

Artifacts are under ignored `test-results/` and `playwright-report/`. Screenshots/video are retained on failures; traces retain local failures and record the first CI retry. Each browser test attaches a JSON diagnostic log. HTML reporting, retention, and trace settings follow the [Playwright recording options](https://playwright.dev/docs/test-use-options). Artifacts can contain form data and session details once authenticated tests are added: keep them private, redact diagnostic data, and use short CI retention.

Local retries are zero; CI retries are one. A reproduced product defect must remain failing until the product is fixed; retry is not a fix. The initial mobile landing test currently exposes **HC-QA-001** (see `QA_REPORT.md`).

## Next checkpoints

1. Review/fix HC-QA-001, then rerun the existing mobile regression without changing its assertion.
2. Provision disposable MySQL and deterministic personas/content, then implement real auth (valid login/logout/session), onboarding, discovery, booking/test-payment, and host publication in that order.
3. After stable local runs, add web CI: build, client tests, QA safety/typecheck, mock browser smoke; DB integration tests need a separate ephemeral MySQL job. Deployment smoke uses the explicit staging target.

No new CI workflow is included yet because the mobile product regression is still open and live environment isolation is unresolved.

## Phase 9 — Stripe TEST mode (`npm run qa:stripe`)

- **Opt-in only.** Needs `~/.config/hellocircle-qa/stripe-test.json` (directory 0700, file 0600) containing exactly `{"STRIPE_SECRET_KEY":"sk_test_…"}`. Live keys, extra keys and wrong permissions are refused. Every other suite still refuses any `STRIPE_*` variable.
- **Test-mode proof.** The backend proves test mode (`balance.livemode === false`) before serving. Egress is limited to `api.stripe.com:443`, and the browser may reach Stripe hosts only.
- **Webhooks** are signed with a fresh per-run `whsec_qa_…` secret and verified by the real handler.
- **Batches:** stripe-preflight, webhook, checkout, payment, refund, browser, findings (HC-QA-048/049; HC-QA-050 lives in the payment batch). Payments use Stripe test card numbers on hosted Checkout.
- **Provider-side records** stay in the Stripe test sandbox (they can't be deleted); local rows are cleaned by exact ID.

