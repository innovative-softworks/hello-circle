# D-01 / D-08 — validation record

_2026-10-15. Local only: nothing committed, pushed or deployed; no production, staging or development database
queried or changed; email went only to the isolated QA backend's sink (recipient + subject recorded, never bodies);
online payments in tests used the guarded QA provider stub (no network, no Stripe). Screenshots show synthetic QA
data only._

| | D-01 organisation suspension | D-08 staff access management |
|---|---|---|
| Approval | APPROVED for local implementation (2026-10-15) | APPROVED for local implementation (2026-10-15) |
| Implementation | Done locally (uncommitted) | Done locally (uncommitted) |
| Verification | **Verified locally on the final code** (2026-10-15): unit, real-stack integration and browser checks pass — §3 | **Verified locally on the final code** (2026-10-15) — §3 |
| Deployment | Not deployed | Not deployed |

Environment: the guarded disposable QA run `qa_a35e99a58e09c361` (rebuilt 2026-10-15 under Method B; see
`hellocircle-d02-d03-validation.md` §1). Connected preflight and seed had passed; no other environment was used.

## 1. What was built

See `hellocircle-operating-decisions.md` §D-01 and §D-08 "Implementation record" for the full description,
ownership rule, migration and limitations. In short:

- **D-01:** organisation status separate from any member's account; Super-only suspend/reinstate with D-03 reasons
  and decision history; one shared sale check under a shared lock on the organisation row in every sale path; public
  reads exclude suspended organisations; detail links show an unavailable state; listing statuses never rewritten;
  late payments parked for finance review; members get a read-only, role-scoped obligations page; customers and other
  organisations unaffected.
- **D-08:** owner-only role change and removal with row versions; next-request effect; removal moves listings and
  coupons to the owner (creator kept), deletes partner sessions only; audit of actor, membership and previous/new
  state; blocked while the organisation is suspended.

## 2. Defects found during this work and fixed

| # | Found | Fix | Evidence |
|---|---|---|---|
| 1 | A pending invite could be accepted while the organisation was suspended (a suspended organisation would gain a member) | Accepting refused with 409 while suspended; the invite stays pending | D08-STAFF |
| 2 | A listing claim by a since-removed member could still be approved, giving the listing to an account with no organisation | Approval refused (409) | code review |
| 3 | Removing a member would have broken their coupons (validated against the creator's organisation) | Removal moves coupons to the owner too | D08-STAFF |
| 4 | Restricted page showed a false "Your session has expired" toast: listing chat answered 401 for a signed-in but suspended partner, and the header kept polling partner endpoints | Chat answers 403 for a blocked partner; the header stops polling partner endpoints for a suspended or removed member; the session refresh on `orgSuspended` can't loop | D01-D08-UI asserts no toast after the page settles |
| 5 | An admin platform-role change didn't bump the member's row version, so an owner's open page could overwrite it | `row_version` bumped there too | code review |
| 6 | Integration test race (not a product defect): after "Refresh" the member page re-opens with the current role; picking a role before the reload finished was reset | Test waits for the reload response | D01-D08-UI passed 3/3 in a row afterwards |
| 7 | A listing, programme, experience or coupon created by a member in a request that raced their removal would be written with the removed member as holder — belonging to no organisation | Each of the six creation inserts runs in a transaction that first re-reads the creator's membership under a shared lock on their user row (`assertCreatorStillMember`); removal holds the exclusive lock, so a creation either commits first (and is moved to the owner by the removal) or is refused with 403 `removedFromOrg` | `staffRemovalRace.test.ts` (deterministic; fails with the lock removed) |
| 8 | A late payment's verified state was only recorded in the parked event, not alongside the hold | The hold audit row now records order `pending` and provider payment `verified_paid` with the agreed session, amount and currency | `orgSuspension.test.ts` |

## 2a. VIS-COUNTS investigation (`qa:authorization`, stage-b-visibility-2)

**Original failure.** In the first full regression run after the D-01/D-08 changes (its `qa:authorization` part ran between 23:00 and 00:00 UTC on 14 October), the batch
`stage-b-visibility-2` failed at `stage-b-visibility-2.spec.ts:17` called from line 49 — the **first** of the test's
four activity creations. The runner stops a suite at a failing batch, so 73 of 83 tests had run.

**Captured request and response.** `POST /api/games` as QA_HOST_B with `date` = the test's "today", `time` 23:30,
the QA vendor's centre and the host's own booking → **400 `{"error":"Pick a date that hasn't passed"}`** (captured by
a temporary evidence line in the spec, removed afterwards; the spec was restored byte-for-byte before the fix). The
QA backend's server output isn't captured by the runner; none was needed — the message is the route's own
validation (`routes/games.ts`: `b.date < irelandTodayIso()`), which proves the request got through every middleware
(session, resident identity, `requireResident`) and that no organisation, account, venue-status, limit or
shared-state rule was involved: that check runs before any of them.

**Checks made.** Fixture ownership (QA_VENDOR's centre, QA_HOST_B's own paid booking), organisation and account status
(both active; D-01 code never consulted on this path), venue availability (not reached), limits (game creation has no
rate limit), shared state and ordering (the same failure in isolation, see below).

**Cause.** The test computes "today" — for the host's venue booking (line 35) and every activity (line 47) — from the
**UTC** date, while the server validates against **Ireland's** date. In Irish summer time (UTC+1) the two differ
from 23:00 to 00:00 UTC. At the time of the failure: UTC 2026-10-14 23:28, Ireland 2026-10-15 00:28. Outside that hour
they agree: the earlier full run that passed 83/83 ran at ~22:20 UTC (Ireland 23:20, same date).

**Isolation and sequence.** Re-run in isolation inside the window: failed identically (twice, plus once with the
evidence line). Because the isolated run reproduces the failure, it doesn't depend on the preceding batches; the
original sequence was the same suite started in the same hour.

**Fix.** The test now uses Ireland's date (`irelandDate(0)`, the existing fixture helper) for both the booking and the
activities, matching the server. No assertion was changed. Other specs that build UTC dates use offsets of ≥ 3 days,
which a one-day difference can't push into the past; they're unaffected.

**Regression evidence.** Inside the same failing window (23:29 UTC, Ireland already 15 October): the batch passed
(3/3 tests), and the complete `qa:authorization` passed **83/83 in 39 batches** (23:30–23:32 UTC). Final-code runs
are in §3.

## 2c. REV-ADMIN-B-FINANCE-mobile (`qa:revenue`, revenue-admin-b) — found on the final-code run

**Failure.** In the final-code regression run, `REV-ADMIN-B-FINANCE-mobile` failed at `revenue-admin-b.spec.ts:17`
(clicking "Preview" in the reason dialog on a 390px phone); desktop passed, and the same test had passed in the
previous full run. `qa:revenue` stops at a failing batch, so 25 of its 38 tests had run.

**Evidence** (temporary diagnostics in the spec, removed afterwards; the spec was restored byte-for-byte):
- Playwright: the button was visible, enabled and stable, but "`<div>…</div>` intercepts pointer events"; the element
  under the button's centre was the dialog's own "Reason" label — the page was offset under the tap.
- The document was **470px wide on a 390px phone** (`scrollWidth`/`innerWidth` 470). It became 470 as soon as the
  Settlements list loaded (before any dialog), and only when that list was long.
- Every unclipped element fitted in 390px; listing **absolutely positioned** elements found the cause:
  `span.adm-visually-hidden` ("Open", the screen-reader header of the table's last column) at left 469, width 1. It
  had no offset, so it sat at its static position — the far edge of the 511px table — and its containing block is
  outside the table's horizontal scroll wrapper, so the wrapper didn't clip it.
- Why it appeared now: the table's width depends on its rows (long `host:<uuid>` partner ids), and the revenue suites
  had added rows to the disposable database since the first run.

**Ruled out** by bisecting (each change tried with and without the others, 5 failing runs): the workspace grid's bare
`1fr` track and the modal scroll lock's `innerWidth − clientWidth` padding. The scroll lock did turn the overflow into
an 80px body padding once the page was wide, but changing it alone didn't fix the failure; both changes were reverted.

**Fix.** `.adm-visually-hidden` (`client/src/components/admin/admin.css`, new in the uncommitted admin redesign) is
anchored with `top: 0; left: 0`, so a screen-reader-only label can't extend the page wherever it sits. No test or
assertion changed.

**Regression evidence.** The same batch on the same wide data then passed 6/6 twice in a row. Because the class is used
across the admin, partner and host workspaces, `qa:revenue`, `qa:validation` and `qa:product` were re-run (§3).

## 2b. Implementation details verified

| Detail | Verified by |
|---|---|
| Staff removal and the reassignment of listings and coupons are atomic and stay in the same organisation | One transaction (member row locked, membership cleared, listings/coupons moved to the owner, partner sessions deleted). The owner is the caller, checked to be in the same organisation as the member under lock. D08-STAFF asserts the new holder's `org_id` equals the organisation. Creation racing a removal can't escape it (§2 row 7) |
| Reassignment preserves coupon terms, usage limits and attribution | D08-STAFF: every coupon column except `created_by_vendor_id` (kind, amount, `max_uses`, `used_count`, expiry, eligible listing, funding, minimum spend, per-customer limit, active) and every centre column except `vendor_id`/`created_by_user_id` identical before and after; `created_by_user_id` = the member; the audit entry lists each moved id with its previous holder; earlier audit history unchanged |
| Late successful payments keep their verified payment state separate from the pending order/review status | The order's `payment_status` stays `pending` (not fulfilled), while the provider payment is recorded as verified-paid in two places: the parked event (`webhook_events.status = 'manual_review'`, summary `payment_status: "paid"`, payment intent, amount, currency) and the hold audit row (`orderPaymentStatus: "pending"`, `providerPayment: "verified_paid"`, agreed session/amount/currency). The customer sees "needs a check" (`paymentUnderReview`). `orgSuspension.test.ts` asserts all of these |
| Capacity of orders held for review (existing behaviour, unchanged) | A pending order occupies a place only during its 30-minute hold (`occupiesCapacitySql`, `PENDING_HOLD_MINUTES` in `bookingIntegrity.ts`); a held late payment follows the same rule, so after 30 minutes its place can be sold. On replay after reinstatement, confirmation re-proves capacity for a stale hold (`stillFits`): if the place is gone the order becomes paid + cancelled ("refund required", the existing state). Passes have no capacity. **D-10 dependency:** whether a place is held during review, for how long, and when such a payment is refunded automatically are D-10's decisions; nothing here changes them. Covered by the existing hold/expiry/late-success tests in `qa:booking` |
| Reinstatement restores visibility only for listings still eligible under their own current status | No status is written by suspension or reinstatement, and every public read requires the listing's own status *and* an active organisation. `orgSuspension.test.ts`: draft/rejected/paused stay hidden; a live listing paused during the suspension stays hidden after reinstatement; a draft approved during it becomes visible |

## 3. Results on the final code

Final code = everything above, including the VIS-COUNTS test fix (§2a), the creation-vs-removal lock and hold audit
(§2 rows 7–8) and the `.adm-visually-hidden` fix (§2c). Every suite below ran after its last relevant change; the
API-only suites ran after the last server change (the final CSS change can't affect them).

| Check | Result | Ran after |
|---|---|---|
| Server unit tests (isolated Docker MySQL) | 95 files · **902 passed**, 23 skipped (pre-existing) — incl. `orgSuspension.test.ts` (10), `staffRemovalRace.test.ts` (2), `adminVendorRace.test.ts` | last server change |
| Client unit tests · `qa:check` · typecheck · production build | **272** · **97** · PASS · PASS | final code |
| `qa:auth` | **20/20** | last server change |
| `qa:authorization` | **83/83** (39 batches); earlier also 83/83 inside the 23:00–00:00 UTC window | last server change |
| `qa:security-gate` | **39/39** | last server change |
| `qa:booking` | **38 passed**, 2 skipped by design (each concurrency case runs only in its own limiter batch) | last server change |
| `qa:revenue` (provider stub) | **38/38** | final code |
| `qa:lifecycle` | **52/52** | final code |
| `qa:product` | **68 passed**, 1 skipped by design (PERF-P13 measures a production build only) | final code |
| `qa:validation` (all 13 batches, incl. `revenue-d01-sales`, `validation-d08`, `validation-d01-d08-ui`, D-02/D-03) | **25/25** | final code |

Not run: `qa:stripe` and the Stripe sandbox suites (Stripe test mode wasn't required — late payments are covered with
the provider stub and the real event store; no Stripe credential is configured in this QA run), `qa:browsers`
(cross-browser matrix), `qa:smoke` (mocked APIs).

## 4. What each required check covered

| Requirement | Evidence |
|---|---|
| Owner- and staff-created listings | D01-SALES and `orgSuspension.test.ts`: a centre created by the owner and a centre and club created by a manager are all hidden and refused |
| Every supported sales path | D01-SALES: venue booking (owner's and staff's centre), club registration, programme enrolment, experience booking, pass purchase → refused; free/cash and online paths covered (Make It Happen / Open Booking share the booking function) |
| Direct API calls and existing sessions | D01-SALES: members signed in before the suspension get 403 `orgSuspended` on their next request (listings, edit, staff invite); after reinstatement the same session works again. D08-STAFF: role change applies to the member's existing session |
| Discovery and direct links | D01-SALES: centres, clubs, experiences and programmes lists exclude them; centre, club, experience, programme and provider detail return 200 `unavailable` with no prices/sessions; unit test: sitemap excludes them, keeps another organisation's provider. D01-D08-UI: public page "This listing isn't available at the moment" with no booking control |
| Existing obligations, role-scoped | D01-SALES: owner sees first name + reference (never the email); a read-only analyst gets the summary only, no reference. D01-D08-UI: restricted page desktop and phone |
| Unrelated memberships | D01-SALES: another organisation's owner keeps workspace access and its centre stays bookable. D08-STAFF: other members and the other organisation unaffected by a removal |
| Reinstatement preserves listing states | D01-SALES and unit test: statuses identical before/after; draft, paused and rejected stay hidden; approved come back |
| Existing checkout and late payments | D01-SALES (stub provider): a pass and an online booking opened before the suspension, then paid → not confirmed, order stays pending, `*.held_org_suspended` audit; after reinstatement the pass confirms. Unit test (real event store): the event is parked `manual_review` with session id, payment intent, amount and currency; `paymentUnderReview` true; replay after reinstatement confirms |
| Staff role changes, removal, cross-organisation denial | D08-STAFF: staff can't change staff (403); owner can't change themselves (403); another organisation → 404; extra fields can't change ownership; removal: old session 401/403, re-login 403 `removedFromOrg`, listing and coupon moved to owner with creator kept, still editable and sellable; audit and emails |
| Concurrency | Unit test (deterministic): while a sale holds its shared lock, a suspension can't commit (25 observations from another connection), then completes and new sales are refused — fails with the lock removed. D01-SALES: suspension and five bookings fired together → every response 201 or 409, rows exactly match the 201s, nothing accepted afterwards; two simultaneous suspensions → one transition. D08-STAFF: two tabs changing the same member → one 200, one 409; stale version → 409 |
| Decision reasons, note privacy, audit | D01-SALES: Support can't suspend (403); no reason → 400 and nothing changes; one decision per transition; audit `organisation.suspended` with decision id and no note; members' obligations response and page carry the explanation, never the internal note; QA mail sink: every member got the suspension email |
| Browser: navigation, confirmations, failures, responsive | D01-D08-UI: organisation record by direct URL; the confirmation states scope (members, live listings, "whichever member created them", upcoming count, "different from suspending one person's account"); disabled until a valid reason; a failed save (simulated 503) keeps every field and shows the error with one request; a double click records one decision; Escape closes and returns focus; phone dialog without sideways scroll; partner restricted page desktop and phone; staff member page: change role, stale message with the chosen role kept, removal consequences |

## 5. Screenshots (synthetic data; `docs/hellocircle-ui-completion/`)

| File | Shows |
|---|---|
| `d01-org-suspend-confirm.png` | Suspend confirmation with scope, reason fields, internal note |
| `d01-org-suspend-failed.png` | Failed save: dialog open, text kept, error shown |
| `d01-org-record-suspended.png` | Organisation record after suspension, with decision history |
| `d01-org-reinstate-confirm-mobile.png` | Reinstate confirmation at 390px |
| `d01-partner-restricted.png` | Member's read-only page: reason, obligations, support links |
| `d01-partner-restricted-mobile.png` | The same on a phone |
| `d01-public-unavailable.png` | Public direct link to a suspended organisation's listing |
| `d08-change-role-confirm.png` | Role change confirmation with what the role allows |
| `d08-stale-member.png` | Stale-screen message after a concurrent change, chosen role kept |
| `d08-remove-confirm.png` | Removal consequences before confirming |

## 6. Remaining limitations and dependencies

- **D-10 / D-11 (since implemented, 2026-10-15 — `hellocircle-d10-d11-validation.md`):** at the time of this
  record a payment completing after a suspension was held with the order pending and nothing else. It is now
  refunded automatically when every D-10 precondition holds, otherwise held as before (with a payment review), and
  closed through "Recheck with Stripe" after an external refund. The tests in this record ran before that change.
- **Not built (outside this approval):** listing-level suspension; ownership transfer; an "organisation suspended"
  notice to customers with upcoming bookings (they keep their bookings; nothing tells them); a required reason for an
  admin's platform-role change (D-02 follow-up).
- **Invite links:** an accepted, replaced, revoked or expired link answers 400 at acceptance and 404 at lookup (not the
  410 the draft named). Rejoining is API- and unit-tested; the rejoin variant of the acceptance page was typechecked
  but not exercised in a browser.
- **Venue pages** are behind the coming-soon gate in this environment, so the public unavailable state was checked
  in the browser on an experience page; centre/club detail responses were checked at the API.
- **Concurrency:** the integration run of "suspension + five bookings at once" had the suspension win all five; the
  ordering guarantee itself is proven by the deterministic unit test (which fails without the lock).
- (Fixed in the follow-ups, §7: club-session feeds now follow the club's approval status; removed staff can be
  re-invited. The VIS-COUNTS date fragility was fixed — §2a.)
- **Residue:** synthetic rows are removed by exact id after each test; allowed uploads and the earlier D-03 residue
  remain in the disposable database (see the D-02/D-03 record).

## 7. Follow-ups (2026-10-15): club-session visibility, re-inviting removed staff, Stripe regression

### 7.1 Public club-session visibility

**Found.** Three public feeds listed a club's weekly sessions without checking the club's own publication status, so a
draft, rejected or paused club's sessions could appear: the "what's on" / search schedule
(`listScheduledActivities`), the provider page's upcoming list (`getProviderUpcoming`), and the "what's next" suggestion
after a registration (`nextSteps.ts`, which also ignored organisation status).

**Fix.** All three now require `clubs.status = 'approved'` **and** an active organisation (`orgActiveSql`). No new
listing-suspension rule. Already correct and unchanged: the schedule endpoint (`GET /api/club-sessions?clubId=` — empty
for a non-public club or a suspended organisation, full list for the owning organisation's members), club detail
(`GET /api/clubs/:id` — 404 or the unavailable state), saved favourites (approved + active organisation). A customer's
own registration and receipt are unaffected; only the suggestion of another session is suppressed.

**Booking enforces eligibility on its own.** A registration (including one for a specific session) requires an approved
club, an active session and a sellable organisation, re-checked inside the locked registration transaction
(`registrations.ts` → `reserveRegistration` → `assertSellable`), whatever any feed showed.

**Evidence.** `clubSessionVisibility.test.ts` (2 tests): sessions of an approved club appear, draft/rejected/paused never
do, in both feeds; while the organisation is suspended none appear and sales are refused; after reinstatement only the
approved club's sessions return. Negative control: with the new approval filter removed, the test fails (a draft club's
sessions appear); the file was restored byte-for-byte. Direct-URL behaviour of the schedule endpoint is covered by the
existing VIS-014-015 batch (`qa:authorization`) and D01-SALES.

### 7.2 Re-inviting removed staff

**Before:** accepting an invitation refused any email that already had an account, so a removed member could never
return.

**Now:**
- The owner invites the same email as anyone else (owner-only; refused while the organisation is suspended; 409 if the
  person is already on the team). Invite creation runs under the organisation row lock and **replaces** any earlier
  pending invite for that person and organisation, so duplicate or concurrent requests leave exactly one valid link.
- Nothing reactivates by itself: the person rejoins only by **accepting the new invitation with their existing
  password** (the lookup tells the page it's a rejoin; the page asks for the current password instead of creating an
  account). A wrong password changes nothing (401). The password isn't changed by accepting.
- Same identity: the same `users` row (id, email) gets the invitation's organisation and role; `row_version` is bumped;
  audit `org.staff_rejoined` (previous: removed; new: member, role, via invitation). Earlier attribution is untouched —
  listings moved to the owner at removal stay there with `created_by_user_id` = this person.
- Only a removed staff account (approved partner, invited staff, no organisation) can rejoin; any other existing
  account — a member of another organisation, an owner, an admin — gets the existing 409, so no other membership is
  ever moved.
- Concurrency: acceptance locks the invite and the user row and rejoins with a conditional update; accepting also
  closes any other pending invite for that person in that organisation.
- Accepted, replaced, revoked and expired links stay invalid; joining a suspended organisation is refused (the invite
  stays pending).

**Evidence.** `D08-REINVITE` (`validation-d08-reinvite`, real sessions): already-on-team invite → 409; removal; two
simultaneous invites → 201 + 201 with one pending and one replaced; replaced link → 404 at lookup, 400 at acceptance;
expired and revoked links → 404; another organisation can't revoke the invite; while suspended: inviting → 403,
accepting → 409; lookup says `rejoin: true`; wrong password → 401 and still removed; two simultaneous acceptances → one
201, one 400; same user id and email, new organisation and role; workspace access restored on the new session; the
listing created before removal still with the owner and the creator recorded; `org.staff_rejoined` audited; the other
organisation's invite can't pull them across (409); the used link → 404.

### 7.3 Stripe TEST-mode regression for D-01 late payments

No existing provider-backed case covered a suspension during checkout, so `STRIPE-D01-LATE-PAYMENT` (batch
`stripe-d01`, `qa:stripe`, test-mode key from `~/.config/hellocircle-qa`, Stripe CLI test-mode signing) was added:
a real Checkout session for a staff-created centre of a synthetic organisation is paid on Stripe-hosted Checkout with
a test card; Super suspends the organisation; the real signed `checkout.session.completed` is delivered to the real
webhook route.

Verified: the webhook acknowledges (200) and the event is **parked once** (`manual_review`) with the provider's session
id, `payment_status: paid`, amount, currency and **payment intent**; the booking stays `pending` (not confirmed) and
**no payment record** is written; one `booking.held_org_suspended` audit row records order pending / provider payment
verified-paid with the same session and amount; the customer's status shows "needs a check"; Finance → Payment events
lists it with the "Organisation suspended" reason; **delivering the same event again** is acknowledged as a duplicate —
attempts unchanged, no second audit row; after reinstatement a new delivery confirms the booking once (`paid`,
`confirmed`) with exactly one payment record.

Existing Stripe batches re-run on the same code: `stripe-webhook` 2/2, `stripe-payment` 9/9 (incl. late success after
a lapsed hold, decline, isolation, single-use coupon), `stripe-sandbox-webhooks` 1/1 (duplicates, out-of-order,
replay, no duplicate ledger rows). D-10/D-11 policy unchanged: no automatic refund, deadline or recheck was added.

### 7.4 Results after the follow-ups

Run after the last code change of these follow-ups (only documentation changed afterwards). Suites not touching the
changed paths (booking, revenue, lifecycle — no club-session feed, invitation or webhook code beyond what the Stripe
batches cover) were not repeated; their last results are in §3.

| Check | Result |
|---|---|
| Server unit tests | 96 files · **904 passed**, 23 skipped (pre-existing) — incl. `clubSessionVisibility.test.ts` (2) |
| Client unit tests · `qa:check` · typecheck · build | **272** · **97** · PASS · PASS |
| `qa:stripe` — `stripe-d01` (new), `stripe-webhook`, `stripe-payment`, `stripe-sandbox-webhooks` | **1/1**, **2/2**, **9/9**, **1/1** (TEST mode) |
| `qa:authorization` (incl. invitation batches and the club schedule VIS-014-015) | **83/83** |
| `qa:security-gate` (incl. invitation regressions) | **39/39** |
| `qa:validation` (incl. `validation-d08-reinvite`, `validation-d08`, `revenue-d01-sales`, `validation-d01-d08-ui`) | **26/26** |
| `qa:product` (discover/search feeds) | **68 passed**, 1 skipped by design (PERF-P13) |

Not run in this follow-up: the rest of `qa:stripe` (other batches don't use the changed confirmation path beyond those
above), `qa:browsers`, `qa:smoke`.

