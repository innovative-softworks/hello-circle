# 02 · Test execution results

## 1. Repositories and commits under test

| Repo | Branch | Commit | State |
|---|---|---|---|
| web (`hello-circle`, worktree `hello-circle-participation-p1`) | `feature/participation-phase2` | start `e5f3b77` (25 commits over `f22294f`, clean). Validation added `1025e83` (journey E batch), `0998764` (DEF-01), `d22f4a6` (DEF-02); final code = `d22f4a6` + DEF-07 + validation specs + these docs (committed at the end of the validation) | not pushed |
| baseline (worktree `hello-circle-baseline-f22294f`) | detached `f22294f` | `f22294f` | only uncommitted QA-harness port-offset patches |
| mobile (`hello-circle-mobile`) | `feature/registration-forms` | `a509d86` | **out of scope** (no mobile app; [06](06-mobile-compatibility.md)); untracked `package-lock.json` preserved |

## 2. Isolated environment (verified before any write)
- **Harness:** `tests/integration` (`npm run qa:db:reset`, `qa:db:seed`), main QA stack on `QA_PORT_OFFSET=10`, baseline on `20`.
- **Database:** a fresh disposable MySQL container per reset, `hello_circle_e2e_qa_<runid>`, with the restricted user `hello_circle_qa`. The harness asserts the database name, account, server UUID and container identity on every batch (`connectedPreflight`).
- **Data:** seven synthetic personas plus one suspended-account control, all `@example.test` (`QA SAFE: seven unique personas … verified`).
- **Credentials:** the backend child gets an explicit allow-list environment and `DOTENV_CONFIG_PATH=<secrets>/empty.env`. It never sees `server/.env`, refuses inherited SMTP, Firebase, R2 or Stripe keys, and blocks every outbound socket except the QA DB (and `api.stripe.com:443` in the Stripe TEST profile, after `balance.livemode === false`).
- **Mail:** e-mail is recorded as facts only (recipient, subject, link origin); no transport exists.
- **Not touched:** `hello_circle` (prod), `hello_circle_dev` and production. No stop condition was hit.

## 3. Unit, type and build (final code)

| Check | Command | Result |
|---|---|---|
| Type checks (server, client, QA harness) | `npx tsc --noEmit -p server && npx tsc --noEmit -p client && npx tsc --project tests/tsconfig.json` | pass |
| Production build | `npm run build` | pass |
| Client unit | `npm run test --workspace client` | **45 files, 352 passed** |
| QA harness self-tests | `npx vitest run --config tests/vitest.config.ts` | **100 passed** |
| Server suite (disposable MySQL; booking, registration, attendee, check-in, permission, security, notification, reporting, export, migration and schema tests) | `npm run test --workspace server` | **152 files, 1,371 passed, 0 failed, 23 skipped** (live-provider tests, off by design) |

One earlier server run, made while browser batches ran in parallel, had 13 port-collision failures in one file. They're explained in [11](11-defects-and-remediation.md) §4; the isolated re-run above is clean.

## 4. Combined browser regression

### 4a. Full run: one orchestrated pass over every guarded batch
- **When:** 05:47:50–07:01:36, fresh QA DB, `final/validate.sh`.
- **Batches:** 212, run sequentially, one `QA_ONLY_BATCH` per invocation with the same guards. The harness runs each batch with a fresh backend and stops each batch at its first failure. **This is a sequenced batch orchestration, not one Playwright process.**
- **Suites covered:** authorization (incl. auth), security-gate, lifecycle, booking, Stripe TEST, product, browsers, revenue, validation, trust.

| Result | Count |
|---|---|
| Passed | **455** |
| Failed | 15 |
| Timed out | 11 |
| Skipped | 4 (PERF-P13 ×2, which needs the production build and was run separately below; REM-046 ×2, one spec split over two batches) |
| Safety aborts | 4 (`core`, `collisions`, `flows`, `recovery` sent to the wrong suite; re-run with `qa:auth`: 11 passed, 1 failed REAL-AUTH-001) |

The 26 failed and timed-out results cover **19 distinct tests**. Some batches belong to both the `product` and `browsers` suites, so they ran twice:
- **17 baseline-listed tests**, each with the same signature on `f22294f` ([11](11-defects-and-remediation.md) §3).
- **2 new regressions:**
  - DEF-01 (OG-23-RESPONSIVE-320), fixed in `0998764`; re-run 9/9 widths pass;
  - DEF-02 (CFG-MESSAGES), fixed in `d22f4a6`; re-run pass.

**Fix timing (honest scope):**
- Fix `0998764` landed after batch 28 and fix `d22f4a6` after batch 130, so batches before each fix ran on the earlier code.
- Both fixes are small and local: a switch label, and the message composer.
- Every batch touching them was re-run on the final code (OG-23-RESPONSIVE, CFG-MESSAGES, CFG-OPERATIONS, FINAL-A11Y).
- **There is no single uninterrupted green pass of all 212 batches on the final commit.**

### 4b. Stripe TEST (inside the full run)
19 batches, **51 passed, 0 failed**, including SANDBOX-SPLIT on the fresh DB and SANDBOX-RECONCILE (to the cent). Details: [05](05-booking-stripe-reconciliation.md).

### 4c. Baseline comparison on `f22294f` (fresh DB, offset 20)
- **Batches:** the 17 failing batches re-run, 09:00–09:05.
- **Result:** every one fails on the same test, with the same error, locator and spec line. Timeouts have the same test and budget.

### 4d. Tests hidden behind first failures: run on both commits
Because each batch stops at its first failure, tests later in a failing batch didn't run in 4a. They were run with the harness's allowed `--grep-invert` filter, excluding only the known failure(s). The harness refuses `--max-failures` overrides by design.

| Round | Batches | Current `d22f4a6` | Baseline `f22294f` | Same? |
|---|---|---|---|---|
| 1 | 13 | 26 passed, 8 failed/timed out | 26 passed, 8 failed/timed out | **identical**, including failure locations |
| 2 | 6 (stopped again at a second failure) | 14 passed, 3 failed/timed out | identical | **identical** |
| 3 | 1 | OG-18/OG-25-UI passed | passed | identical |

**No hidden test fails on the current commit unless it also fails on the baseline.**

### 4e. Batches added by this validation

| Batch | What | Result on final code |
|---|---|---|
| `booking-config-host-questions` | Journey E end to end (host questions, phone join, host answers, no-show) | **PASS** (in 4a) |
| `booking-final-security` | Direct-API probes of the Phase H–O endpoints, plus Make It Happen paused | **PASS** (run twice) |
| `booking-final-perf` | Response times, 30 registrations, exports, messages, parallel reads | **PASS** (after two fixes to the spec itself: question type name, client id) |
| `booking-final-a11y` | 13 participation pages × 4 widths | **PASS**, after DEF-07 (fixed) and a spec restructure (login limiter) |
| `product-perf-p13` with `QA_PROD_BUILD=1` | CLS and API accounting on the production client build | **PASS** |

## 5. Commands (reproduce)
```bash
QA_PORT_OFFSET=10 npm run qa:db:reset && QA_PORT_OFFSET=10 npm run qa:db:seed
QA_PORT_OFFSET=10 QA_ONLY_BATCH=<batch> npm run qa:<suite>                        # one batch
QA_PORT_OFFSET=10 QA_ONLY_BATCH=<batch> npm run qa:<suite> -- --grep-invert "<ID>:"  # hidden tests
QA_PORT_OFFSET=10 QA_PROD_BUILD=1 QA_ONLY_BATCH=product-perf-p13 npm run qa:product
```
The orchestration scripts used are kept outside the repository (session scratchpad): `validate.sh`, `baseline.sh`, `phase2.sh`, `round2.sh`, `round3.sh`. Logs aren't committed because they include run identifiers only; no secrets were written.
