# HelloCircle QA results — OG-01 … OG-32

_Final QA and release-readiness pass **2026-10-17**, local (sections G–H added the same day after the Option A decision). Disposable QA profile **`qa_a1e386b9878d625c`** (provisioned
fresh this pass with `qa:db:reset`; MySQL in a throwaway container on tmpfs, scrubbed env, test-only personas, mail sink,
Stripe **TEST** mode only, no production or staging credentials, no real customer data). Every result below was
**executed**; nothing is reported from expectation. The 2026-10-16 results are kept below as history._

## A. SANDBOX-SPLIT isolation

**Inspected first (read-only, previous QA database `qa_566440f1eadeffc6`, before it was disposed).** Times are UTC (DB
`@@system_time_zone` = UTC; the 2026-10-16 note "2026-10-14 23:42" was wrong).

| Row | Party | Amount | Reversed | Status | Created (UTC) |
|---|---|---|---|---|---|
| transfer #2 | host (QA_HOST) | 2666 | 999 | partially_reversed | 2026-10-15 05:12:29 (the passing 2026-10-15 run) |
| reversal #3 | → #2 | 333 | | created | 2026-10-15 05:12:34 (that run's own B2 refund) |
| reversal #11 | → #2 | 333 | | created | 2026-10-16 07:44:15 (failed re-run) |
| reversal #24 | → #2 | 333 | | created | 2026-10-16 11:35:56 (failed re-run) |

The org (QA_VENDOR_B) also had five transfers from earlier runs (#1, #3, #4, #9, #21). **Cause, now proven:** the spec's
cleanup removes accounts and debts but never money rows, so each re-run on the same database found the host's old
transfer and `openPartnerDebt` correctly recovered €3.33 from it ("recovered" instead of the expected "open"). The
settlement code was behaving as designed. Each failed re-run also made a real Stripe TEST-mode reversal against the
old test account, nothing else.

**Fix (test isolation, no money rows deleted anywhere):**
- New disposable QA database via `npm run qa:db:reset` (disposes only the verified QA container) + `qa:db:seed`.
- `stripe-sandbox-split.spec.ts` now refuses up front, inside its try/finally so switches are restored, when either split
  partner already has transfers: *"split partners start with no transfers (provision a fresh QA database)"*. It can no
  longer fail deep in a 25-minute run for a reason unrelated to the code.

**Result: complete `qa:stripe`, one uninterrupted run, 19/19 batches, 51/51 tests passed**, including `SANDBOX-SPLIT`
(snapshot = Stripe charge to the cent, independent venue/host settlement and transfers, partial and full refunds after
transfer, debt offset, lost dispute after transfer, bank payouts paid/failed) and `SANDBOX-RECONCILE` (local records
match Stripe to the cent). No settlement failure was found.

| Batch | Tests | | Batch | Tests |
|---|---|---|---|---|
| stripe-preflight | 1 | | stripe-d01 | 4 |
| stripe-webhook | 2 | | stripe-sandbox-connect | 1 |
| stripe-checkout | 5 | | stripe-sandbox-money | 2 |
| stripe-payment | 9 | | stripe-sandbox-disputes | 1 |
| stripe-refund | 5 | | stripe-sandbox-billing | 1 |
| stripe-refund-external | 6 | | stripe-sandbox-webhooks | 1 |
| stripe-selfcancel | 2 | | **stripe-sandbox-split** | **1** |
| stripe-browser | 3 | | stripe-sandbox-delivery | 1 |
| stripe-findings | 2 | | stripe-sandbox-reconcile | 1 |
| stripe-r3a | 3 | | | |

**Re-run on the final code.** The first run started before the last server changes of this pass (OG-24 routes, privacy
erasure rule, MFA key handling — none of them touch payments). So after every other suite had passed, the complete
suite was run again on another freshly provisioned disposable QA database (`qa_37ec4ff48a19488d`), the same way: **19/19 batches,
51/51 tests passed in one uninterrupted run (1,255 s)**, SANDBOX-SPLIT included. The validation, revenue and regression
results in §C ran on `qa_a1e386b9878d625c` before that reset.

## B. New dedicated tests (all executed and passed)

| Item | Test | What it proves |
|---|---|---|
| OG-01 | `OG-01-SWITCH` (browser) | Business-only session on `/manage/circles/:id` and `/manage?tab=activities` gets the explicit gate, no personal session until the click; the switch keeps `?tab=`; account menu "Switch to Personal" lands on `/bookings`; both switches audited; unlinked partner sent to `/vendor`, switch API 404, no personal session; signed out 404/401 |
| OG-13 | `OG-13-ORDERS` (browser + API) | Hall booking, club registration and experience booking in one list; search by reference, type, status and date filters, filter in the URL survives reload; hall row opens the booking record (H1 = booker) and Back returns; experience row opens its page; another organisation's order never listed and its record by URL shows "doesn't exist"; failed load → error + Try again (never an empty list); signed out 401, resident refused |
| OG-15 | `OG-15-EXCEPTIONS` (browser + API) | An open failed-event exception is listed with its detail; type filter (in the URL); Open → the Finance event record; failed load → "Couldn't load the exceptions" + Try again, never "Nothing needs attention"; super 200, support 200, legal 403, partner 403, signed out 401; a legal admin sees no rows |
| OG-19 | `OG-19-DEPARTURES` (browser) | Weekly repeat ×3 in one series with a 24 h cut-off (checked in Ireland time); capacity 1 refused with "2 places are already taken", 6 + 48 h cut-off saved; move refused until "the customer asked" is ticked, then moved and audited with the note; API without `customerAsked` 400; another organisation 403 |
| OG-24 | `adminListPages.test.ts` 5/5 + `OG-24-PAGING` (browser) | Vendors (25 synthetic) and All listings (22): status-tab counts over the search/type filters, pending-first order, 20 per page, page number in the URL, Back from a record returns to page 2, status/type/county/sort filters, record by URL without the list, missing record state; requests use `?page` |
| OG-07 key | `adminMfaKey.test.ts` 3/3 | See §D |
| OG-29 | `privacyRequests.test.ts` 4/4 + `OG-29/OG-31-UI` | See §E |
| Isolation | `OG-ISOLATION` (API, real stack) | 19 cross-organisation / cross-account attempts refused (statuses in the permission matrix §5) with DB snapshots unchanged |

Product fixes found while writing them: the departure add form's date, time and capacity inputs had no accessible names
(now labelled). Spec fixes: `/api/residents/me` answers `{resident: null}` (not 401) without a personal session; the
harness DB connection reads DATETIME in the machine's timezone, so cut-offs are compared as UTC text.

## C. Uninterrupted suites and flakiness

| Suite | Result (one uninterrupted run each, fresh backend per batch, no retries) |
|---|---|
| `qa:validation` | **23/23 batches, 38 tests passed** (second run; the first stopped at batch 17 on a spec bug in the new erasure check, fixed — see §E) |
| `qa:revenue` | **9/9 batches, 38 tests passed** (238 s) |
| `qa:smoke` | **14 passed** |
| `qa:authorization` | **39/39 batches, 83 passed** |
| `qa:booking` | **13/13 batches, 38 passed** (2 concurrency halves skipped by design, as before) |
| `qa:lifecycle` | **19/19 batches, 52 passed** |
| `qa:product` | **21/21 batches, 68 passed** (PERF-P13 skipped by design) |

**Flakiness, investigated.** The 2026-10-16 timeouts landed on a different test each run and never reproduced alone. The
recorded durations show why: the same `OG-23-RESPONSIVE` test took **518 s** of its 600 s budget on 2026-10-16 and **70 s**
today, and the revenue tests that timed out normally finish in 6–10 s. The machine was several times slower during those
long runs. That's environment load, not a hang in the app. No timeout reproduced in today's uninterrupted runs. One
structural weakness was real and is fixed rather than given a longer timeout: the responsive check was a single test
doing 99 page loads under one budget. It is now **nine tests, one per width** (sharing three logins, within the
login limiter), each 9–10 s, so a slow moment can't fail them and a failure names the width. It also now covers the
Vendors and All listings pages (13 pages × 9 widths, all passing).

## D. Admin MFA in a disposable environment

`adminMfaKey.test.ts` (isolated test database, a fresh random key per run, never printed):
- **Storage:** the secret is stored only in encrypted form (`v1.` AES-256-GCM, never in clear).
- **Enrol and sign in:** both work with a real key.
- **Missing key:** on `NODE_ENV=production` or `APP_ENV=staging`, two-step set-up is refused (503) and the server does
  not fall back to the development key.
- **Wrong length:** a 24-byte key is refused.
- **Changed key:** a TOTP sign-in now fails with a clear message (it used to be a raw crypto error).
- **Recovery:** recovery codes still work after the key changes, and another super admin's reset lets the admin enrol
  again under the new key.

The server also logs `[mfa] …` at boot when the key is missing or malformed on a deployed server. The log line carries
the problem, never the key. Key provisioning, protection, backup and recovery are in `hellocircle-release-readiness.md`.

## E. Privacy requests: completed never implies deletion

**Found:** an erasure request could be marked "Completed", and the person was emailed *"Your request for deletion of your
data … has been completed"*, although nothing is deleted (D-07, DEC-14).

**Fixed:**
- **Server:** refuses `completed` for erasure with a 409 that says why.
- **Admin record:** offers "Send reply, keep open" (emailed as "An update on your privacy request… It is still open") or
  "Decline and send".
- **Resident's row:** shows "In progress · nothing deleted yet".
- **Other request kinds:** still complete normally.

**Tests:** `privacyRequests.test.ts` 4/4, and the browser journey `OG-29/OG-31-UI`, which now also checks that an erasure
request is kept open, that the server refuses completion, and that the resident's row text is right.

## F. Unit and harness tests (after the last code change)

| Suite | Result |
|---|---|
| Server Vitest (isolated container) | **1014 passed, 23 skipped**, 117 files (+`adminListPages`, `adminMfaKey`, privacy erasure) |
| Client Vitest | **281 passed**, 33 files |
| `qa:check` | **97 passed** |
| `tsc --noEmit` client, server, tests | clean |

★ Scenario evidence that changed since 2026-10-16: #10 experience participants → `OG-19-DEPARTURES` (browser);
#22 admin financial exceptions → `OG-15-EXCEPTIONS`; #23 MFA → also `adminMfaKey.test.ts`; #24 multi-role switching →
`OG-01-SWITCH`; #26 responsive → per-width `OG-23-RESPONSIVE-*`; #27 permissions → also `OG-ISOLATION`.

## G. Option A — partner customer data by staff role (2026-10-17, after the owner's decision)

**Review.** Every partner endpoint was checked for customer personal data (names, emails, phones, children's names,
notes). Checked:
- **Lists:** orders, hall bookings, registrations, a booking's changes.
- **Rosters:** experience bookings, programme enrolments, club participants and waitlist.
- **Customers:** the customers list and record, and the insights participant list.
- **Exports and other reads:** the bookings CSV, Overview "today", program schedule, calendar items, check-in status,
  messages, notifications.

The last three carried no customer data, or only the business's own data. All gates sit in
`server/src/routes/vendorHelpers.ts` (`ORDER_ROLES`, `ROSTER_ROLES`, `CUSTOMER_ROLES`).

| Test | Result |
|---|---|
| `vendorPiiRoles.test.ts` (unit, isolated DB) | **13/13**: 11 routes × 6 roles; CSV columns per role; Overview name mask |
| `PII-ROLES` (real stack, 7 logins) | **passed**: each role gets 200 *with* the data where allowed, or 403 with **no** customer data in the body; the CSV gives finance and the owner contact columns, the analyst the same rows without them, everyone else 403; Overview shows every role the booking and names only for customer roles; the other organisation gets refused-or-empty on every endpoint |
| `PII-UI` (browser) | **passed**: the analyst opens eight partner pages and records by URL (booking record, All orders, customer record, experience/programme/club pages) with no customer data on screen and an explicit "Couldn't load bookings" on the experience Bookings section; communications sees the customer record with the booking as plain text, no order records, no CSV button; finance sees All orders and the booking record by URL but not experience rosters |

**Re-run on the final code:**

| Suite | Result |
|---|---|
| smoke | 14 |
| authorization | 39/39 batches, 83 |
| booking | 13/13, 38 |
| lifecycle | 19/19, 52 |
| product | 21/21, 68 |
| validation | 25/25 batches, 49 tests (uninterrupted) |
| revenue | 9/9, 38 (uninterrupted) |
| unit tests | server 1027 / 23 skipped (118 files), client 281, `qa:check` 97 |

Complete `qa:stripe` on the final code, on another freshly provisioned disposable QA database (`qa_f76248dc13437d5a`): **19/19 batches, 51/51 tests, uninterrupted (1,268 s)**, SANDBOX-SPLIT and SANDBOX-RECONCILE included.

**Flaky test (not caused by this change).** In the first post-change revenue run, `REV-ADMIN-B-HELP-desktop`
(admin field-help editor) saved the previous example text instead of the typed one. The server stores what the browser
sends, so the typed text was lost before Save. That suite doesn't touch partner routes. The batch then passed four times
in a row, and the whole revenue suite passed uninterrupted. The cause isn't found yet: full traces are disabled in this
harness because they would record credentials. The spec now checks that the dialog still holds the typed text after
typing and just before Save, so the next occurrence will show where it is lost. This is an open item, not a fix.

## H. Deployability in production mode (2026-10-17)

`npm run build` passes. The built server ran with `NODE_ENV=production APP_ENV=staging HOST=127.0.0.1` on a throwaway MySQL
container (random credentials, never printed; removed afterwards), with no `.env` loaded and every provider variable blank.
- **Migration:** 146 tables on an empty database, idempotent.
- **Pages:** health 200; SPA, deep link and asset 200; admin API signed out 401; unknown API 404.
- **Session cookie:** Secure and HttpOnly.
- **Admin two-step:** 403 before set-up, enrolment with 10 recovery codes, then admin 200.
- **Without the MFA key:** `[mfa] HELLO_CIRCLE_MFA_KEY is missing…` logged at boot, health 200, verify 503 with a clear
  message, admin 403.
- **Rollback:** the previous release `1ba8c7b`, built from git, booted on the migrated schema: health, home, centres,
  admin login and admin pages all 200.

---

## History — 2026-10-16 pass (QA run `qa_566440f1eadeffc6`, since disposed)

### 1. Unit and harness tests (2026-10-16)

| Suite | Result |
|---|---|
| Server Vitest (isolated container) | **1005 passed, 23 skipped**, 115 files (baseline 937 / 23) |
| Client Vitest | **281 passed**, 33 files (baseline 279) |
| `qa:check` (harness self-tests + tsc) | **97 passed** |
| `tsc --noEmit` client and server | clean |

New server test files: `venueClosures`, `reportModeration`, `financialExceptions`, `adminOperations`, `adminPaging`,
`adminAccess`, `bookingChanges`, `gameMove`, `vendorCustomers` (incl. role gate), `complaintsSubject`,
`experienceDepartures`, `gameJoinApproval`, `gameSeries`, `privacyRequests`, `vendorStatements`, `circleModeration`.

### 2. Real-stack suites (2026-10-16)

Final regression pass (after the last code change), each suite run in full on fresh backends:

| Suite | Baseline (start of pass) | Final |
|---|---|---|
| `qa:smoke` | 10 failed (fixture + route drift) | **14 passed** |
| `qa:authorization` | 83 passed | **83 passed, 39/39 batches** |
| `qa:booking` | 38 passed | **38 passed, 13/13 batches** (2 skipped by design: each concurrency batch runs one half) |
| `qa:lifecycle` | 52 passed | **52 passed, 19/19 batches** |
| `qa:product` | stopped at HC-QA-053 (later batches never ran) | **68 passed, 21/21 batches** (PERF-P13 skipped by design) |
| `qa:validation` | stopped at VAL-UX-WORKSPACES | **all 18 batches passed individually** (table below); a single uninterrupted run is still owed |
| `qa:revenue` | stopped at REV-VENDOR-EARNINGS | **all 9 batches passed individually**; a single uninterrupted run is still owed |
| `qa:stripe` | 16 passed, then COUPON-SINGLE-USE timeout | **16/17 batches passed**; SANDBOX-SPLIT not passing (below) |

#### Validation and revenue, batch by batch (each batch on its own fresh backend and seed; one retry allowed)

| Batch | Result |
|---|---|
| validation-staff / admin / ux | 1 / 3 / 4 passed |
| validation-completion-a / b / c / d | 2 / 2 / 3 / 3 passed (c and d after spec updates, see §4) |
| validation-d02 / d03-api | 2 / 1 passed |
| validation-d03-ui | 1 passed (after spec updates, see §4) |
| revenue-d01-sales / revenue-d10-review | 1 / 1 passed |
| validation-d08 / d08-reinvite / d08-rejoin-ui / d01-d08-ui | 1 / 1 / 1 / 1 passed |
| **validation-og-features** (new) | **4 passed** — OG-27, OG-26, OG-29/31, OG-18/25 journeys (first attempt: OG-29/31 timed out; retry passed) |
| **validation-og-responsive** (new) | **1 passed** — 11 pages × 9 widths (first attempt timed out; retry passed) |
| revenue-public / partner / resident | 6 / 6 / 6 passed (partner: REV-VENDOR-PRO-mobile timed out once; retry passed) |
| revenue-admin / admin-b / split / plan / rewards / credit | 4 / 6 / 2 / 4 / 2 / 2 passed |

**Honest note on timeouts.** Long sequential runs (a whole suite after several others) hit test timeouts in a
*different* test each time (D03-UI, REV-ADMIN-FINANCE-mobile, REV-5F-ADMIN, REV-ADMIN-B-HELP-desktop once). Each of those
passed when its batch ran on its own. No timeout reproduced in isolation except D03-UI, which was a stale spec (§4).

#### Stripe (2026-10-16)

16 of 17 batches passed in the full run, **including `STRIPE-COUPON-SINGLE-USE`, which timed out in the baseline**.
**`SANDBOX-SPLIT` did not pass:** in the full run it failed an assertion ("host had no transfer: nothing reversed, debt
stays open" — expected the host debt open with 333 unrecovered; got recovered); a standalone re-run hit its 25-minute
timeout. A third run (final pass) failed the same assertion. Read-only check of the isolated QA database: the QA host persona
has one transfer left over from 2026-10-14 23:42 UTC (before this pass, during the 2026-10-15 sandbox run), status
`partially_reversed`; the spec's cleanup removes accounts and debts but not transfers, so the host debt in this run
recovers against that old transfer. This looks like a **spec re-runnability gap** (it can pass once per QA database), not
a code regression — but it was not proven by a passing run, and clearing it needs either a QA reset or deleting money
rows, which I left for the owner. The payment, settlement and transfer code is unchanged in this pass apart from two notification
hooks (payout failed / Pro past-due), which are now non-throwing; SANDBOX-SPLIT passed on 2026-10-15 in the same QA run.
**Next step:** reset the QA database (or add transfer cleanup to the spec) and re-run `stripe-sandbox-split`; until it
passes, treat venue/host split settlement as unverified for this build.

### 3. Brief's 30 scenarios → evidence (2026-10-16; updated rows marked ★ in §F)

| # | Scenario | Evidence (executed and passed unless stated) |
|---|---|---|
| 1 | Vendor registration and approval | `qa:product` vendor signup batches; `qa:authorization` |
| 2 | Vendor creates venue | `hc-d03-ui`, `hc-completion-d` (create, edit, error summary) |
| 3 | Vendor creates facilities | `stage-b-vendor` rooms (authorization) |
| 4 | Customer books venue | `qa:booking` centre batches |
| 5 | Vendor completes booking | `qa:booking` provider batches (check-in/attendance) |
| 6 | Vendor blocks booked facility | `venueClosures.test.ts` (preview, refuse on change, keep, cancel+refund); `STAGE-B-ROOM-ASSIGNMENT` (foreign room 400) |
| 7 | Vendor proposes reschedule | `bookingChanges.test.ts` |
| 8 | Customer accepts or declines | `bookingChanges.test.ts` (accept once, decline, taken slot, withdrawn/expired) |
| 9 | Vendor creates experience | `qa:booking` experience batch; `experienceDepartures.test.ts` (repeat, cut-off) |
| 10 | Vendor manages experience participants | `experienceDepartures.test.ts` (capacity floor, move only when customer asked) — **no browser spec** |
| 11 | Host reserves venue | `qa:booking` activity batch; `gameMove.test.ts` reservations |
| 12 | Host creates paid activity | `qa:stripe` (HC-QA-049 paid activity) |
| 13 | Participants book activity | `qa:lifecycle`, `qa:stripe` |
| 14 | Host reschedules linked activity | `gameMove.test.ts` (both move or neither) |
| 15 | Host cancels activity | `qa:lifecycle` cancel batches; `OG-26-UI` (cancel remaining dates) |
| 16 | Host manages Circle | `qa:lifecycle` circle batches; `OG-18/OG-25-UI` announcement |
| 17 | Host moderates chat | `reportModeration.test.ts` (organiser hide), `circleModeration.test.ts` |
| 18 | Partner payout failure | `financialExceptions.test.ts` (notified once); `commerceMarkup.test.tsx` banner |
| 19 | Subscription payment failure | `financialExceptions.test.ts`; `SANDBOX-BILLING-F` (failed renewal + grace) |
| 20 | Admin moderates reported content | `reportModeration.test.ts`, `reports.test.ts`, `hc-completion-a` report record |
| 21 | Admin manages bookings | `adminOperations.test.ts` (cancel on behalf, permission refusals) |
| 22 | Admin reviews financial exceptions | `financialExceptions.test.ts`; `OG-23-RESPONSIVE` loads the Exceptions page |
| 23 | Admin invitation and MFA | `adminAccess.test.ts` (8 cases: single use, expiry, TOTP, replay, lockout, recovery, step-up) |
| 24 | Multi-role workspace switching | `account-link-*` specs (authorization); OG-01 switch screen — **no dedicated spec** |
| 25 | Complaints and partner responses | `complaintsSubject.test.ts`; `REV-ADMIN-TRUST` |
| 26 | Responsive layouts | `OG-23-RESPONSIVE` (11 pages × 320/375/390/428/768/1024/1280/1440/1920), `VAL-UX-WORKSPACES`, `LC-UI-*` |
| 27 | Permission enforcement | `qa:authorization` (83), `adminPermissions.test.ts` route inventory, `validation-d02`, `vendorCustomers` role gate |
| 28 | Loading and error recovery | `VAL-UX-ERRORS`, `COMPLETE-SILENT`, `COMPLETE-FORMS` |
| 29 | Financial statements | `vendorStatements.test.ts`; `OG-18/OG-25-UI` (download) |
| 30 | Recurring activities | `gameSeries.test.ts` (6); `OG-26-UI` |

### 4. Specs changed during QA (2026-10-16)

| Spec | Change | Reason |
|---|---|---|
| `tests/fixtures/browser.ts`, smoke spec | mock `POST /api/consents/cookies`; partner pitch at `/partners` | baseline: consent banner POST unmocked; `/` is now Home |
| `product-host`, `product-a11y-a/b` | row locator → `listitem` | rows became `<li>` in the workspace redesign |
| `revenue` balance locator | region "Your balance" | earnings redesign |
| `hc-completion-a` | status text "Listing:" | admin listing record redesign (2026-10-16) |
| `hc-completion-c` | after a decision the page moves to the next item; reopen by URL | page-by-page "next after decision" (2026-10-16) |
| `hc-completion-d` | target the "Location" popup's Save | two stacked section popups both have Save |
| `hc-d03-ui` | "Reject…/Reject & next…"; reopen record after reject; Delete via "More actions" menu (keyboard); 15 s step timeout | pending-approvals redesign (2026-10-16) |
| `revenue-admin` | Transfers/Debts on Finance, Credits on Plans & credit; grant form in a popup; 15 s step timeout | finance/plans split (2026-10-14/16) |
| `product-p13-a` | wait for the dialog to close after each add | race: the next add typed into a closing dialog |

Product fixes found by QA in this pass: partner Overview header overflow at 390px (`Header.tsx`, `header.css`);
foreign-room block returned 409 instead of 400 (restored); stacked-table labels leaked into cells' accessible names
(CSS alt text `content: attr(data-label) / ""`); customer contact details weren't server-gated by staff role (now 403
for read-only analysts).
