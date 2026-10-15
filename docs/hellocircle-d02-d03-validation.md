# D-02 / D-03 — validation record

_2026-10-15. Local only: nothing committed, pushed or deployed; no production, staging or development database used;
email and push delivery went only to the isolated QA backend's in-memory sink (recipient + subject recorded, never
bodies). All screenshots show synthetic QA data._

Statuses are kept separate:

| | D-02 admin permissions | D-03 decision reasons |
|---|---|---|
| Approval | APPROVED for local implementation (2026-10-14) | APPROVED for local implementation, as product policy (2026-10-14) |
| Implementation | Done locally (uncommitted) | Done locally (uncommitted) |
| Verification | **Verified locally** on the final code: unit + real-stack integration suites pass (§4) | **Verified locally** on the final code: unit + real-stack integration and browser checks pass (§4) |
| Deployment | Not deployed | Not deployed |

## 1. QA environment recovery (Method B, owner-approved 2026-10-15)

Followed `tests/README.md` and `QA_ENVIRONMENT_RECOVERY.md`.

- **Cause:** the current run's private configuration directory (`environment.json`, `empty.env`, created by setup in
  the macOS temp directory) no longer existed; the run's container had exited when Docker restarted. Cause of the
  deletion: not established (the temp directory is outside the repository; no QA code deletes it).
- **Retirement:** before touching anything, the stopped container was checked against the manifest with the same
  identity checks as `verifyContainer` except "running": container id, image id, name, run and nonce labels, bridge
  network with the run label, loopback-only port 13306, tmpfs database storage — all matched. Under the operation
  lock, `.qa-data/current.json` was moved to `.qa-data/qa_64f1060afd291303/retired-missing-config-manifest.json`.
  The old container, its network and evidence were **kept** (not removed). Its database was tmpfs and is not
  recoverable; no SQL and no old credential were used.
- **Fresh environment:** `npm run qa:db:setup` → new run `qa_a35e99a58e09c361`, database
  `hello_circle_e2e_qa_a35e99a58e09c361`, restricted user `hello_circle_qa`, newly generated test-only credentials
  (none printed). `qa:preflight -- --current` gave its intended offline "BLOCKED" (not a pass);
  `qa:preflight:connected` PASSED (container, database/user identity, grants, run marker) **before** any schema or
  seed write; `qa:db:seed` PASSED (seven personas + suspended control).
- Unrelated containers, databases, credentials and the uncommitted worktree were not touched; the untracked
  `undefined/` folder was left alone. No guard or login limit was bypassed (batches stay within the real limiter of
  10 logins per IP).

## 2. Defects found during verification and fixed (within D-02/D-03)

| # | Defect | Fix | Proven by |
|---|---|---|---|
| 1 | `POST /api/uploads` accepted **any** admin — including one with no role or an unknown role | Admin uploads need `listings.edit` or `media.editorial`, checked before any file is written | D02-MATRIX: super/support 201 (+1 file), finance/legal/no-role/unknown-role 403 with **no file written**, vendor 201, anonymous 401 |
| 2 | A repeated or concurrent identical listing rejection recorded a second decision and sent a second partner notice and email | Under the listing row lock: same status + identical latest decision → no-op (same 200; no decision, audit entry or notice). A *different* reason is still recorded as a correction | D03-API: repeat → still 2 decisions / 2 notices; two concurrent identical rejections → 1 decision, 1 notice; UI double-click → 1 decision |
| 3 | Race between permission check and update on partner status: a support "approve" that landed just after a super suspended the account would have **reinstated** it (a super-only power) | The update is conditional on the status the permission check saw; if it changed meanwhile → 409, nothing written | `routes/adminVendorRace.test.ts` (follow-up, 2026-10-15): deterministic interleaving — see §2a |
| 4 | Place-suggestion decision checked "pending" then wrote in separate steps: two admins at once could record two decisions/notices (and on approval publish two listings) | One transaction under a row lock: re-check pending, create the listing (approval), update, record the decision | D03-API: two concurrent rejections → one 200, one 409, one decision |
| 5 | The one-time role backfill promoted accounts silently | Each promoted account now gets a system audit row | `adminRoleBackfill.test.ts` |
| 6 | Two older specs left D-03 rows behind (host-verification control; vendor-signup cleanup) | Cleanup now covers `moderation_decisions` and moderation notices | Re-ran `stage-b-admin` and `product-vendor-signup`: residue count unchanged |

Earlier in the same implementation (before this run): the boot backfill that re-ran on every restart, partner notices
failing on NOT NULL columns, the last-super lock order, review "delete" (a hide) mapped to moderation. All re-verified
here.

Spec expectations updated to the approved policy (not weakened): a **signed-in partner or partner staff member**
calling an admin API now gets **403** (authenticated, not permitted) instead of 401 — `auth.spec.ts`,
`authorization-boundaries.spec.ts`, `authorization-staff.spec.ts`, `stage-b-admin.spec.ts`, `stage-b-org.spec.ts`.
Guests, residents and forged cookies still get 401. `hc-validation-admin.spec.ts`: support now reads
`/api/admin/finance/refunds` (matrix: "V, refunds and payment state only, for support"); legal handles complaints;
legal/finance approving a partner → 403; rejections and suspensions send a reason.

## 2a. Follow-up — deterministic race regression (2026-10-15)

`server/src/routes/adminVendorRace.test.ts` runs the real `PUT /api/admin/vendors/:id/status` handler against the
isolated test database. Ordering is forced, not timed: `db.transaction` is wrapped for Support's request only, so
Support's handler does its status read and permission decision (pending → plain approval, allowed for support),
then — at the start of its write transaction — the complete Super suspension request runs and commits; only then
does Support's write continue. No sleeps; the one wait (for the suspension email sent after the response) polls for
that condition on the event loop.

Asserted:
- Support's request reached its write transaction after the permission check (the interleaving really happened).
- Super's suspension → 200; Support's approval → **409**.
- Final account status **suspended**.
- Decisions: exactly one, `partner.suspended` by the super admin — no `partner.approved`/`partner.reinstated`.
- Audit: exactly one `vendor.status_changed` row (super, `suspended`) — none from support.
- Email (mocked sender) to the partner: only "Your HelloCircle partner account has been suspended"; no approval or
  reinstatement mail. Workspace notices: only the suspension notice.
- Afterwards a Support approval of the suspended account is refused outright (403) and it stays suspended.

Negative control: with the fix temporarily reverted (the old `UPDATE … AND status <> ?`), both tests **fail**
(Support gets 200 and the account is reinstated; the follow-up approval returns 200). The fix was restored and
`server/src/routes/admin.ts` checked byte-identical (SHA-1) before the passing run.

## 3. Legacy role migration — runbook

**What the code does.** On the first server start of this code against a database with no
`migration.admin_role_backfill` marker in `app_settings`: the `admin_role` column is created if missing; every row
with `role = 'admin' AND admin_role IS NULL` is set to `super`, with one audit row per account (`actor_kind =
'system'`, `action = 'admin.role_backfilled'`, `object_id = <user id>`); then the marker is written. It never runs
again on that database. Vendors and residents are never touched.

**Policy consequence — state it plainly:** every legacy admin keeps **Super** access after the upgrade, until a super
admin explicitly reassigns them (Admin workspace → Settings → Admin roles; super-only, reason required, audited, the
last super can't be demoted, nobody changes their own role). The migration preserves today's unrestricted access; it
does not narrow anyone. Narrowing is a deliberate, per-account step after deployment.

Run these read-only, against the target database, **before** and **after** the first start. (Not run against
production or staging in this task; they were executed against the isolated QA database to confirm they run.)

**Step 1 — schema availability**
```sql
SELECT COUNT(*) AS has_admin_role FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'admin_role';
SELECT COUNT(*) AS has_app_settings FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_settings';
-- only if has_app_settings = 1:
SELECT value FROM app_settings WHERE `key` = 'migration.admin_role_backfill';
```
- Marker `done` → the migration already ran; nothing will be promoted. Skip to step 4.

**Step 2 — inventory (who will be promoted)**
- If `has_admin_role = 0` (production and staging today — `main`/`staging` don't have the column): use a query that
  doesn't reference the column. **Every admin listed will become Super.**
  ```sql
  SELECT id, email, status, created_at FROM users WHERE role = 'admin' ORDER BY created_at, id;
  ```
- If `has_admin_role = 1` and no marker (a database that ran the earlier Stage 2a code): the rows with
  `admin_role IS NULL` will become Super; the rest keep their role.
  ```sql
  SELECT id, email, admin_role FROM users WHERE role = 'admin' ORDER BY created_at, id;
  ```
Keep this list; step 4 compares against it. Decide which accounts should be narrowed afterwards.

**Step 3 — deploy and start the server once** (the migration runs at start-up, before the server listens).

**Step 4 — verify**
```sql
-- every admin has a known role; expect 0:
SELECT COUNT(*) AS unassigned FROM users WHERE role = 'admin'
 AND (admin_role IS NULL OR admin_role NOT IN ('super','finance','support','legal'));
-- role distribution; the step-2 accounts should all be 'super':
SELECT id, email, admin_role FROM users WHERE role = 'admin' ORDER BY created_at, id;
-- one audit row per promoted account; must equal the step-2 "will be promoted" list exactly:
SELECT object_id, created_at FROM audit_log WHERE action = 'admin.role_backfilled' ORDER BY created_at;
-- marker present:
SELECT value FROM app_settings WHERE `key` = 'migration.admin_role_backfill';
```
If an audit row is missing for a listed account, or an unexpected account appears, stop and investigate before
narrowing roles.

**Step 5 — narrow deliberately.** Reassign any account that shouldn't be Super in Settings → Admin roles (each change
is audited with its reason). Until then it has full access.

**Evidence**
- `server/src/adminRoleBackfill.test.ts`, test "runbook rehearsal" (isolated unit-test DB): adds a pre-roles admin,
  **drops** `admin_role` and the marker to simulate production/staging, confirms step 1 reports the column missing,
  inventories admins with the column-free query, runs the start-up migration, then checks: column present, every
  inventoried admin is `super`, the `admin.role_backfilled` rows written by that run are **exactly** the inventory
  (one each), marker set. The other test covers a database that already had the column and proves later restarts
  promote nobody (a role-less admin added afterwards stays role-less, no audit row). 2/2 passing.
- The step 1/2/4 queries were executed read-only against the isolated QA database (run `qa_a35e99a58e09c361`): column
  present, `app_settings` present, marker `done`; 1 admin, `super`; 0 unassigned; 0 backfill audit rows — expected,
  because that database had no admin at its first start (the seed created the QA admin afterwards with an explicit
  `super` role), so nothing was promoted.

## 4. Final-code results

All runs below are on the final code: no server or client code changed after the D-02/D-03 batches ran (later
edits were spec expectations and test cleanup only, and the affected batches were re-run). The 2026-10-15 follow-up
added tests only (`adminVendorRace.test.ts`, the runbook-rehearsal test) — no product code — and ran the affected
server tests: **4/4 passing** (race 2, backfill 2), plus server typecheck.

| Check | Result |
|---|---|
| Server unit tests (isolated Docker MySQL) | 92 files · **887 passed**, 23 skipped (pre-existing skips) |
| Client unit tests | 33 files · **272 passed** |
| `qa:check` (harness unit tests + typecheck) | **97 passed** |
| Typecheck (server, client, tests) and production build | PASS |
| `validation-d02` | **2/2** (D02-MATRIX, D02-LAST-SUPER — ran, not skipped: statuses 200 + 409, one super left) |
| `validation-d03-api` | **1/1** |
| `validation-d03-ui` | **1/1** |
| Other `qa:validation` batches (staff, admin, ux, completion a–d) | **18/18** (`validation-admin` first failed on a stale expectation — support refund read — fixed to the approved matrix and re-run: 3/3) |
| `qa:auth` | **20/20** (first run stopped at a stale 401 expectation for a signed-in vendor; fixed to 403 and re-run in full) |
| `qa:authorization` | **83/83**, 39 batches |
| `qa:security-gate` | **39/39** |
| `qa:product` | **68 passed, 1 skipped** — PERF-P13 by design (measures a production build only, `QA_PROD_BUILD=1`; unrelated to D-02/D-03) |

Not run in this pass: `qa:stripe`, `qa:revenue`, `qa:lifecycle`, `qa:booking`, `qa:browsers`, `qa:smoke` (not in
the requested list; no payment code changed).

## 5. What each risk check covered

| Risk | Evidence |
|---|---|
| Every admin route has an enforced permission | Route-inventory unit test over the real routers (140+ routes incl. mounted finance/commerce/policies/complaints/traders/help/media); a negative probe proves it can fail; D02-MATRIX 14 read rows × 4 roles |
| Unknown, empty, missing roles denied | Unit tests (null, "", "owner", non-admin); D02-MATRIX: no-role and unknown-role admins → 403 on every read and on 41 denied writes total, DB snapshots unchanged; `/api/admin/permissions` → 403 |
| 401 vs 403 | Anonymous → 401; signed-in vendor / partner staff → 403; residents → 401 (they have no partner/admin session) |
| Existing sessions follow role changes | D02-MATRIX: support's session reads its permissions, a super changes it to legal, the same session's next approve → 403 (no re-login); `/permissions` reports legal |
| Stale client permissions can't authorise | Same step: the old permission list held by the client still says `partners.approve`; the server refuses |
| Image uploads | `POST /api/uploads`: super 201, support 201, finance 403, legal 403, no-role 403, unknown-role 403 — refused uploads write **no file** (upload directory counted), allowed ones exactly one; vendor 201; anonymous 401 |
| Unresolved permissions Super-only | Matrix unit test lists the Super-only set incl. `commerce.governance_switches`, `coupons.delete`, `templates.delete`; commerce route test: finance 403 on each governance switch (setting unchanged), 200 on a financial switch |
| Legacy migration | `adminRoleBackfill.test.ts`: upgrade from a database **without** the column (runbook rehearsal) and with it, then two restarts; runbook queries executed on the QA DB (§3) |
| Support approval vs Super suspension race | `adminVendorRace.test.ts`: forced interleaving → Support 409, stays suspended, one decision/audit/email (suspension only); fails with the fix reverted (§2a) |
| Last-super, concurrent | D02-LAST-SUPER: QA_ADMIN demotes admin B while B demotes QA_ADMIN (distinct actors and targets, no self-change) → one 200, one 409, no deadlock, exactly one super left; persona restored in `finally` regardless |
| Required reasons | D03-API: five invalid bodies → 400, status and history unchanged; suspension, host application, claim and suggestion without a reason → 400 |
| Single and bulk rejection, each applicant type | D03-API (listing, partner suspension + reinstatement, host application, claim, place suggestion); D03-UI bulk rejection of two listings → two decisions with the same reason |
| Append-only history | D03-API: a second rejection adds a row; the first explanation is unchanged; unit test on `decisionHistory` |
| Note privacy | Marker string asserted absent from: partner decision API, other-partner request (403), suspended sign-in 403 body, suggestion list, resident and partner notification bodies, audit `new_value`, finance admin's history (no `internalNote` field), partner editor page, suspended sign-in page |
| Reason only after credentials | Wrong password → 401 with no reason; `/api/auth/account-decision` without a session → 401; right password → 403 with category + explanation |
| No duplicate decisions or notices | Identical repeat rejection → no new decision/notice; two concurrent identical rejections → one each; repeat suspension → one decision, one email; repeat host decision → 404; concurrent suggestion rejections → 200 + 409, one decision; UI double-click → one decision |
| Delivery failure | `moderationNotifyFailure.test.ts`: email throws → decision intact, workspace notice written, notifier resolves; the decision is committed before any notice is attempted |
| Email/push only to test sinks | QA backend in-memory sink (recipient + subject); asserted subjects for listing rejection, suspension, reinstatement, host decline |
| Browser behaviour | D03-UI: centred dialog, disabled until valid, failed save keeps all text and shows the error (one request), double-click → one decision, Escape closes and returns focus, Tab stays in the dialog, 390px dialog fits without sideways scroll; finance admin by direct URL sees records without decision controls and a locked queue; partner and suspended sign-in see the explanation |

## 6. Screenshots (synthetic data; `docs/hellocircle-ui-completion/`)

| File | Shows |
|---|---|
| `d03-listing-reject-confirm.png` | Centred confirmation: category, explanation tagged "Visible to the partner", "Internal note — not shown to the partner", consequences above |
| `d03-listing-reject-failed.png` | Failed save (simulated 503): dialog stays open, every field kept, error shown |
| `d03-listing-decision-history.png` | Record page "Decisions" history with the explanation and (super) internal note |
| `d03-bulk-reject-confirm.png` | Bulk rejection of two listings with one reason |
| `d03-suspend-confirm-mobile.png` | Suspension confirmation at 390px: centred card, no sideways scroll, disabled until valid |
| `d03-partner-listing-reason.png` | Partner's listing editor: category + explanation + complaint/contact route, no note |
| `d03-suspended-sign-in.png` | Suspended partner signing in with the right password sees the reason |
| `d03-finance-listing-record.png` | Finance admin by direct URL: record visible, no decision buttons, notes withheld |
| `d03-finance-locked-claims.png` | Finance admin opening a moderation queue: "Not included in your admin role" |

## 7. Remaining limitations, skips and residue

- **Race test scope:** the deterministic race test covers the Support-approval vs Super-suspension ordering through
  the route with a forced interleaving in one process; it is a unit-level test against the isolated test database,
  not a multi-process real-stack race.
- **Migration runbook:** not executed against production or staging (by instruction). Every legacy admin keeps Super
  access until explicitly reassigned — narrowing is a manual post-deploy step.
- **Not in this phase (by instruction or scope):** no diagnostic comparison mode; "reason required" not enforced on
  platform role, tier, delete or template changes; no appeal workflow linked to a decision id; no partner-facing claims
  list; anonymous place-suggestion decisions are visible only on the submitting device; Google sign-in path for a
  suspended partner shares the code path but has no automated test (needs a Google token).
- **Skipped:** PERF-P13 (production-build only, by design); 23 pre-existing server unit skips.
- **Residue in the disposable QA DB:** 3 `moderation_decisions` rows and 1 moderation notice from the first full run
  of two older specs (their cleanup now covers these tables; re-runs left nothing more). Synthetic, left in place —
  no arbitrary deletes. Allowed test uploads (3 files per D02-MATRIX run) stay in the QA run's upload directory.
- **Old QA run** `qa_64f1060afd291303`: container (stopped), network and evidence retained; its manifest is
  `retired-missing-config-manifest.json`.
- Nothing is deployed; production and staging will run the one-time role backfill on first start (§3) — review the
  admin list before deploying.
