# Isolated QA environment recovery — 2026-10-01

## Scope

Recovery and current validation only. No product, authorization, guard or assertion
changes. No development/production database, external provider, deployment,
historical data migration, lifecycle E2E or HC-QA-001 remediation.

## Configuration investigation

`tests/integration/database.ts` setup generates both private files with exclusive
creation and mode 0600 in `os.tmpdir()/hellocircle-qa-<random>/`. The exact directory
is referenced by the gitignored `.qa-data/current.json` manifest.

- `environment.json`: secret-bearing generated QA-only database/persona credentials,
  loopback application targets and disabled external-service configuration. Required
  by loadRun, connected preflight, seed, runner and reporter.
- `empty.env`: empty, non-secret dotenv override used by childEnvironment/backend to
  prevent loading the application's ordinary environment files.
- These are generated/disposable artifacts, outside the repository. `.qa-data/`
  and `.env.test` are gitignored; `.env.test.example` is non-secret documentation.
- Safe template: the setup function's explicit environment schema and cryptographic
  random generator. No supported in-place regeneration exists for unknown passwords.
- Cause of disappearance: **UNKNOWN**. Both files were absent, while provisioning
  files/persona metadata remained. Source review found no QA cleanup deletion of
  either file; only the operation lock is unlinked. No OS cleanup cause is asserted.

## Recovery decision and infrastructure

Method B: fresh isolated environment, using existing `npm run qa:db:setup`.
Before any retirement, verifyContainer matched the old container ID, image ID,
run/nonce labels, network, running status, loopback port and tmpfs database storage.
The recorded QA manifest structure/data-directory identity were also checked.

Under the exclusive operation lock, the exact verified old container was stopped
and current manifest moved to its existing run's `retired-missing-config-manifest.json`.
Old evidence, private directory, stopped container and network were retained. The
old database was volatile tmpfs and is not recoverable as durable database data.
No SQL or old credential was used for retirement. The normal guarded reset command
was not bypassed or modified; this was explicitly approved fresh infrastructure
replacement, not a reset of an unverified database.

Bootstrap generated new independent root-provisioning, restricted-runtime and QA
persona credentials. Root was used only by existing setup inside the new disposable
container. Application/tests use `hello_circle_qa@%`, limited to the new database.

New database: `hello_circle_e2e_qa_7a01b2c0c87998f1`.
Loopback DB exposure: 127.0.0.1:13306. Real frontend/backend: 4178/4311.
`environment.json`: CREATED. `empty.env`: CREATED. No credentials reported.
No development/production credential source, history or cached password was read.

## Preflight and seed

Offline: `npm run qa:preflight -- --current` passed configuration checks. Its
intentional exit 2 / BLOCKED message means offline inspection cannot attest runtime
isolation; it is not a connected PASS. This behavior was preserved.

Connected: `npm run qa:preflight:connected` passed container, actual database/user,
server UUID, unique run marker, grants and visible-database checks before seeding.
Bootstrap itself also independently ran connected preflight.

`npm run qa:db:seed` then passed under its own connected guard and operation lock:
seven unique personas plus one suspended control, actual password hashes/roles
verified. No arbitrary deletion/reset was needed for the fresh database.

## Recovery smoke

REAL-AUTH-001 passed: browser → real frontend → real backend → isolated MySQL,
login/session, authorized identity read, refresh, protected boundaries and logout.
IDOR-NOTIFICATIONS passed: owner read allowed, second-user read filtered and foreign
mark-read denied with database snapshots unchanged. These were recovery controls,
not substitutes for the later unfiltered suites.

Read-only baseline after smoke: residents 4, users 4; games, participants,
invitations, Circles/members, notifications, bookings, programme enrollments,
chat messages and both session tables all zero. Only counts were printed.

## Current full validation

All unfiltered executions finished against the fresh environment, sequentially:

| Check | Current result |
|---|---|
| qa:check safety / test typechecking | 91 PASS / PASS |
| Client workspace tests | 81 PASS |
| Build (server + client) | PASS; known Mapbox chunk-size warning |
| qa:auth | 20 PASS |
| qa:authorization | 83 PASS |
| qa:security-gate | 39 PASS, HC-QA-002..021 |
| qa:smoke (mocked APIs) | 13 PASS / HC-QA-001 FAIL |

No filters used for these full runs. Recovery smoke filters were separate and are
not counted toward these totals. No product code, guards or regression assertions
changed during recovery. The known UI failure retains screenshot/video/trace in
gitignored test-results. Real-suite evidence is sanitized under the current run.

Current authorization subgroup views (overlapping, not separate additive runs):

- Ownership/IDOR 23: ownership, personal, attendance-relations, stage-b-attendance,
  stage-b-vendor, stage-b-org, stage-b-host, stage-b-circles, stage-b-booking,
  stage-b-personal batches.
- Aggregation/visibility 11: leakage, visibility-adjacent, stage-b-aggregation,
  stage-b-visibility, stage-b-visibility-2 batches.
- Invitations 11: disclosure, hardening, binding, consumption, states, history,
  activity-invitation-closure; another consumption case sits in revocation-closure.
- Non-Circle chat: one scenario covering four scopes; Circle authorization also
  reran in ownership and stage-b-circles.
- Account-link closure: two scenarios in the two dedicated closure batches.
- Revocation/consumption: two scenarios in revocation-closure.
- Stage B finding regressions 010..016: seven scenarios in stage-b-findings/open.

## Final cleanup, retention and repository safety

Final connected preflight PASS. Re-running qa:db:seed verified all seven personas
and the suspended control without changing existing credentials; demonstrates seed
repeatability. Operation lock released. Both private files still exist, mode 0600,
outside the repository; empty.env remains zero bytes. No private files removed.

Resident/user counts remain 4/4. Read-only counts are zero for games/participants,
invitations, Circles/members, waitlist_entries, bookings/program_enrollments,
chat_messages/chat_reads, centres/programs/program_sessions, experiences/sessions/
bookings, clubs/club_sessions, org_invites and guest/vendor sessions.

Cleanup is not universal: two synthetic experience notifications and 15 analytics
events remain. Three organisations also remain, consistent with initSchema assigning
organisations to the two vendor personas and suspended vendor. The notification
fixture path does not track every experience-generated side effect. No arbitrary
DELETE/global cleanup or reset was performed to hide residue. A bounded fixture-
hygiene follow-up is appropriate; no demonstrated security failure resulted. Audit
history was not globally removed or claimed empty. No historical migration executed.

Scoped generated-credential scan found zero matches in Git-tracked/unignored repo
files. No files staged and no commits made; existing dirty worktree preserved.
.qa-data/current.json and .env.test ignore rules verified. No credential values
entered output or reports. This is not a claim of a universal repository secret scan.

## Decision

Stage B is SECURITY-COMPLETE LOCALLY for its defined matrix. HC-QA-002..021 all pass;
no confirmed backend P0/P1 is open locally. Fixes remain NOT DEPLOYED. Lifecycle
testing can be the next approved checkpoint, then booking integrity. Stripe test
mode remains conditional on booking-integrity success and separately verified
sandbox configuration; the current auth QA profile prohibits Stripe credentials.
No next phase began. External integrations, future token-at-rest/identity-writer
hardening, production migration/deployment, and HC-QA-001 remain separate.

## Recovery 2 — 2026-10-15 (owner-approved, Method B again)

Same symptom: run `qa_64f1060afd291303`'s private directory (`environment.json`, `empty.env`, in `os.tmpdir()`) no
longer existed and its container had exited when Docker restarted. Cause of the deletion: not established.

- Before retirement the stopped container was checked against the manifest with `verifyContainer`'s identity checks
  except "running" (id, image, name, run/nonce labels, labelled bridge network, loopback 13306, tmpfs storage): all
  matched. Under the operation lock the manifest moved to
  `.qa-data/qa_64f1060afd291303/retired-missing-config-manifest.json`. Container, network and evidence retained; no
  SQL or old credential used.
- `qa:db:setup` → run `qa_a35e99a58e09c361` (database `hello_circle_e2e_qa_a35e99a58e09c361`, user
  `hello_circle_qa`, new generated credentials, none printed). Offline preflight: intended BLOCKED. Connected
  preflight: PASS before any write. `qa:db:seed`: PASS.
- Results on this environment: `docs/hellocircle-d02-d03-validation.md`.
- Recurrence risk: the private directory lives in the OS temp folder. Moving it somewhere durable is a harness change
  that needs its own approval; not done.

## Reset 3 — 2026-10-15 (owner-approved clean-run recovery)

Purpose: one clean, uninterrupted `qa:stripe` run after repeated diagnostic reruns had left partial settlement state.
- Before: evidence for the unexplained split-settlement failure preserved under
  `.qa-data/qa_a35e99a58e09c361/preserved-split-settlement-2026-10-15/` (logs, sanitised results, read-only settlement
  snapshot). Offline preflight: intended BLOCKED; connected preflight: PASS. Manifest target `hellocircle-qa_a35e99a58e09c361`
  (container `b699e01bd2a4`) matched; container list recorded.
- `npm run qa:db:reset` (its own verifyContainer + no-other-connections checks) → new run `qa_566440f1eadeffc6`
  (database `hello_circle_e2e_qa_566440f1eadeffc6`, new generated QA-only credentials, none printed). `qa:db:seed`:
  PASS. Connected preflight: PASS. Only the QA container changed; every other container unchanged. Old run's evidence
  and recovery metadata retained (`retired-manifest.json`). The Stripe test key file was not touched.
- Result: `qa:stripe` 51/51 uninterrupted — `docs/hellocircle-d10-d11-validation.md` §3.

