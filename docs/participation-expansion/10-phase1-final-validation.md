# 10 · Phase 1 final validation and local commit

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase1`, local only, in worktree `../hello-circle-participation-p1`.
**Base:** `f22294f` (`origin/feature/circles-and-experience-3`).
**Not pushed, no PR, not merged, not deployed.** Production payments stay off and `participation.partial_cancel` stays locked. KNOTS pricing is unchanged: no commercial configuration was created.

## 1. Changes since report 09
| Change | Why |
|---|---|
| **Event labels across both journeys** | New `client/src/experienceKind.ts` (`kindPath`, `experienceHref`, `experienceKindWord`) used by ExperienceCard, FeaturedPicks, Home, ExperienceKindBrowse. Detail breadcrumb "Events › …", payment success pass **Event** (status route now returns `kind`), My Life upcoming card "Event", partner title "New adventure, experience or event" |
| **Fixed a regression found by guarded QA** | The booking breakdown was hidden when coupon + credit brought a paid booking to €0 (`REV-5F-CREDIT`). It now shows whenever something is priced before discounts. Confirmed: the test passes on the baseline and now passes on Phase 1 |
| **QA harness: second isolated environment** | `QA_PORT_OFFSET` (unset/0 = the documented 13306/4311/4312/4178; otherwise 10…90, all ports shift together). Every exact-match safety check applies to the shifted values; a mismatch still aborts. Lets a worktree run its own disposable QA container without touching another checkout's. +3 harness self-tests (100 total) |
| **New guarded browser batch** | `booking-event-options` (4 tests): partner Registration tab, guest options booking on desktop and mobile with server totals and lines in My Life, and the switches-off behaviour |

## 2. Diff review
- **59 tracked files changed, 24 new:** code, tests, docs and 12 screenshots.
- **Scanned:** no secrets, tokens, test credentials, `.env*`, `.qa-data`, logs, build output or `node_modules`.
- **Nothing unrelated:** every change is Phase 1, its tests and docs, or the QA harness port offset.
- **Stripe contract untouched:** metadata (`type`, `ref`), `stripeWebhook.ts`, `checkoutService.ts` and `pricing.ts` are unchanged.

## 3. Database migration review (additive only)
| Change | Existing data |
|---|---|
| `CREATE TABLE IF NOT EXISTS offering_options`, `order_lines` | none touched |
| `experience_bookings.pricing_mode VARCHAR(10) NOT NULL DEFAULT 'single'` | every existing row reads `single` (today's behaviour) |
| `experiences.options_version INT NOT NULL DEFAULT 0` | 0 for every listing |
| `commerce_quotes.lines_json TEXT NULL` | NULL for existing quotes; compared only when present |
| Taxonomy seed: Culture, faith & celebrations + 4 subcategories | `INSERT … ON DUPLICATE KEY` no-op; 5 rows and 6 aliases added |

**How it was tested:**
1. A scratch database was built with the **pre-Phase-1 code** (`f22294f`): demo seed plus legacy experience bookings in every state (paid, pending, cancelled, refunded) and a legacy quote.
2. Every table was fingerprinted (rows, checksum, columns).
3. The **Phase 1 `initSchema()` ran twice**.

**Results:**
- Only the tables, columns and seed rows above were added. No column was removed and no existing row changed.
- The legacy bookings keep their status, payment, people and totals and read `pricing_mode = 'single'`.
- The second run was identical to the first (idempotent).
- One unrelated difference: the existing boot-time "every partner gets an organisation" backfill gave the test's organisation-less partner an organisation. That's base behaviour, not Phase 1.
- The scratch database was then dropped. `hello_circle` and `hello_circle_dev` were never touched.

**No backfill and no down-migration needed.** Rollback = switches off; the new tables and columns stay unused.

## 4. Test results (final code)
| Check | Result |
|---|---|
| Type-check: server, client, QA harness | pass |
| Production build | pass |
| Client unit | 44 files, **343 passed** |
| QA harness self-tests (`qa:check`) | **100 passed** |
| Server suite (disposable MySQL) | 136 files, **1,254 passed, 0 failed, 23 skipped** (live R2/Cloudinary provider tests, off by design) |
| Guarded QA, every batch of every suite on the worktree's own isolated QA (offset 10): auth, authorization, lifecycle, booking, trust, Stripe TEST, product, revenue, validation | **157 batches: 371 passed, 14 failed, 3 skipped** (plus 5 known-failing batches run separately, §5) |
| New `booking-event-options` batch | **4/4 passed** |
| Stripe TEST mode (19 batches) | all passed except `stripe-checkout` once (flake, re-run **5/5 passed**) and `stripe-sandbox-split` (once-per-database by design, passed in the first run on this database) |

**The 3 skips:**
- `REM-046-REGISTRATION` and `REM-046-BOOKING` are one spec split across two batches, so each skips the other half.
- `PERF-P13` needs a production build.

## 5. Every failure, compared with the untouched base `f22294f`
The base was run on its own isolated QA (offset 20) in a detached worktree. Only the QA harness port offset was copied into it; no product code.

| Batch / test | Phase 1 | Base `f22294f` | Cause |
|---|---|---|---|
| `core` REAL-AUTH-001 | fail | **fail** | `/profile` signed-out heading removed in `60929d2` |
| `lifecycle-ui-desktop` LC-UI-DESKTOP-HOST | timeout | **timeout** | Circle/plan/activity UI changed before Phase 1 |
| `lifecycle-ui-responsive` LC-UI-TABLET | timeout | **timeout** | same |
| `lifecycle-ui-bottom-chrome` HC-QA-001-STACK | timeout | **timeout** | pre-existing |
| `lifecycle-findings-ui` HC-QA-032-DRAFT-COPY | timeout | **timeout** | pre-existing |
| `booking-ui` BK-UI-DESKTOP | timeout | **timeout** | **"View full activity" missing since `60929d2`, unchanged** |
| `booking-findings-b` HC-QA-043 | timeout | **timeout** | **"View full activity", unchanged** |
| `product-a11y-a` HC-QA-066 | fail | **fail** | "View full activity" |
| `product-a11y-b` HC-QA-068 | fail | **fail** | host form step 2 copy changed |
| `product-gaps-ui` HC-GAP-UI-EXP | fail | **fail** | "View full activity" |
| `product-public-batch1` PUB-05/33 | fail | **fail** | My Life signed-out heading changed |
| `product-public-batch1b` PUB-21/22/23 | fail | **fail** | profile account row changed |
| `product-public-batch2` B2-LISTS | fail | **fail** | Explore toolbar redesign |
| `validation-completion-c` COMPLETE-REVIEW-STATE | fail | **fail** | payment success review copy |
| `validation-completion-d` COMPLETE-SILENT | fail | **fail** | Reviews eligibility rework |
| `validation-og-features` OG-27-UI | fail | **fail** | game join-request UI |
| `validation-categories` CAT-PUBLIC | timeout | **timeout** | games category chips |
| `revenue-credit` REV-5F-CREDIT | fail → **fixed, pass** | pass | **Phase 1 regression, fixed** (§1) |
| `stripe-checkout` STRIPE-CONCURRENCY | fail once → **pass on re-run** | — | counts all Stripe TEST sessions on a shared account since the test started; another session's activity breaks the count |
| `stripe-sandbox-split` SANDBOX-SPLIT | fail (2nd run) | — | documented once-per-QA-database spec; passed in the first run here |

**Summary:**
- **No remaining failure is caused by Phase 1.**
- 17 tests fail identically on the untouched base: stale specs after the redesigns already in `f22294f`. Most are timeouts waiting for a removed element, and many share the "View full activity" cause.
- The two pre-existing "View full activity" failures (`BK-UI-DESKTOP`, `HC-QA-043`) are unchanged.

## 6. Branch and staging integration
- `origin/staging` = `ba913af`. It does **not** contain `f22294f` (the base is 1 commit ahead; staging has 3 merge commits).
- `git merge-tree origin/staging f22294f` gives **0 conflicts**.
- Phase 1's merge base with `f22294f` is `f22294f` itself, so after step 1 it applies cleanly.

**Safe order:**
1. PR `feature/circles-and-experience-3` (`f22294f`) → `staging`. Fix or retire the 17 stale QA specs in that PR or a follow-up, since they fail on it already.
2. Then PR `feature/participation-phase1` → `staging`. Keep all `participation.*` switches off on staging until the owner turns them on.
3. Production unchanged (`PAID_CHECKOUT` closed; partial cancel locked).

## 7. Screenshots (corrected journeys)
`docs/participation-expansion/phase1-screenshots/`:
- `01` partner creates an event;
- `02b`/`02c` Registration tab;
- `03` Events list;
- `04` event page (breadcrumb **Events**, "from · several options");
- `05` options with server totals;
- `06` Stripe TEST checkout;
- `07` payment success (**Event** pass);
- `08` My Life (**Event** pass);
- `09` booking page ("Event registration", **What you booked**);
- `10` phone options step;
- `11` partner "New adventure, experience or event".

## 8. Left running and left in place (all isolated; say the word to remove)
- **Worktree dev servers:** API :3021 and client :5193 (Phase 1 worktree; DB `hello_circle_participation_dev`).
- **QA containers:** `hellocircle-qa_13942178b1563252` (:13316, Phase 1) and `hellocircle-qa_d74bd7a1c03f561b` (:13326, baseline).
- **Baseline worktree:** `../hello-circle-baseline-f22294f` (detached `f22294f`, harness offset only).
- **Untouched:** the main checkout, its dev servers and its QA container `hellocircle-qa_75cfb6ddd2b03e5e` (:13306).
