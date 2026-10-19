# HelloCircle — Operating decisions: implementation plan

_2026-10-14. Plan only. **Nothing here is approved or built.** Each phase starts only after the matching decision in
`hellocircle-operating-decisions.md` is approved. Schema changes follow the repo rule: additive, idempotent
`ensureColumn()` / `CREATE TABLE IF NOT EXISTS` in `server/src/db/index.ts`, no down-migrations, no foreign keys.
Every phase is verified in the guarded QA environment (`npm run qa:*`, Stripe test mode); none touches
`hello_circle`, staging or production data._

---

_Revision 3 (2026-10-14): updated to the decisions doc, revision 3 (default-deny permissions with no relaxing
mode; pricing compatibility version marked unapproved; D-10 deadline cases; refund preconditions; illustrative fee
examples)._

## 0. Before any decision (authorised by the owner, 2026-10-14)

| Item | Why | Change | Verify |
|---|---|---|---|
| 0.1 Fix the admin suspend dialog copy — **DONE** | It said listings stay "public **and bookable**", but checkout is already refused for the suspended user's listings | `AdminVendors.tsx` now says: new bookings refused for the listings this person created; those listings still show; other members' listings stay bookable; existing bookings unchanged; no reason recorded | Typecheck; no spec asserted the old text |
| 0.2 Record the per-user/per-org gap — **DONE** | Suspending an owner doesn't stop staff-created listings | CLAUDE.md "Known gaps"; correction notes added to the audit, validation-results, product-context and UI-completion docs | — |
| 0.3 One uninterrupted green `qa:stripe` run — **DONE** (second clean attempt 47/47, 18 batches; first attempt had one timeout — see `hellocircle-completion-validation.md` §1c) | Every batch had passed, but split across a full run and reruns | `npm run qa:db:reset && npm run qa:db:seed && npm run qa:stripe` | Run log |

---

## 1. Delivery order (dependency-aware)

```
D-02 permissions ──┬─> D-03 reasons ──┬─> D-01 org suspension ──> D-07 resident suspension
                   │                  └─> D-05 listing revisions
                   ├─> D-06 owner-only claims
                   └─> D-08 staff management
checkout agreement (built) ──> D-10 review hold ──> D-11 recheck with Stripe
D-04 part B inputs ──> D-04 part A rollout ──> D-09 fee model / Pro
D-07 deletion (needs legal inputs; independent of the rest)
```

| Phase | Decision | Size | Blocks |
|---|---|---|---|
| 1 | D-02 named admin permissions, enforced on deploy | M | A second admin account; every admin action below |
| 2 | D-03 moderation decisions + reasons | M | D-01, D-05 rejections, partner notices |
| 3 | D-01 organisation and listing suspension | L | Public and paid launch |
| 4 | D-10 bounded review hold | M | Paid launch |
| 5 | D-11 recheck with Stripe | M | Paid launch |
| 6 | D-08 staff role change and removal | S–M | Multi-staff partners |
| 7 | D-06 owner-only claims | S | — |
| 8 | D-05 listing revisions | L | Public launch (recommended) |
| 9 | D-07 resident suspension | M | Public launch |
| 10 | D-07 account deletion | L | Public launch (privacy) |
| 11 | D-04 part A: unified pricing source, per type | L | Paid launch (with part B values) |
| 12 | D-09 Pro / rewards (only if chosen) | S (built; enablement + abuse control) | Pro launch |

---

## 2. Phase details

### Phase 1 — D-02 admin permissions

**Status (2026-10-14):** approved for local implementation · implemented locally (uncommitted) · unit tests pass
(server 92 files / 887 tests, client 272, `qa:check` 97) · integration verified locally 2026-10-15 (`validation-d02` 2/2 and the
full QA suites; see `hellocircle-d02-d03-validation.md`) · not deployed. Details, ambiguities kept Super-only and the exact rollback
inventory: `hellocircle-operating-decisions.md` §D-02 "Implementation record". The optional shadow/diagnostic
mode below was **not built** (owner instruction for this phase).

- **Modules:**
  - new `server/src/adminPermissions.ts` (`ADMIN_PERMISSIONS` table, `requireAdminPermission(permission)`,
    `canAdmin()`), **default deny**: unknown permission, unknown role or missing role → 403;
  - every handler in `routes/admin.ts` and `routes/adminMedia.ts`, plus the mounted finance, commerce, policies,
    complaints and traders routers (keep their current guards as a floor);
  - client `components/admin/adminNav.ts` generated from the same table (shared constant in `packages/types`, or a
    `GET /api/admin/permissions` read).
- **Schema:** none.
- **Permissions are named** (`listings.moderate`, `queues.decide`, `partners.suspend`, `listings.delete`, …) and
  assigned to roles in one table; Support receives the moderation permissions, Super keeps partner suspension,
  reinstatement and every destructive action. A moderator role later = a new assignment row.
- **Rollout:** enforced from the first deploy after approval. **No environment variable or mode relaxes
  enforcement.** An optional shadow check can compare a *proposed* table and log differences
  (`admin.permission_shadow_diff`); it never changes a decision. Before deploy, the current admin list and roles are
  shown to the owner.
- **Tests:**
  - an authorization-suite matrix (every permission × 4 roles), asserting 2xx + audit, or 403 + an unchanged scoped
    snapshot;
  - route coverage: every route mounted under `/api/admin` declares a permission (test fails otherwise);
  - default deny: unknown permission name, unknown role, empty role → 403;
  - shadow check on with a more permissive proposed table → still 403, DB unchanged;
  - the denied matrix re-run under every value of any `ADMIN_RBAC_*` variable → still 403;
  - a nav test that locked items equal denied permissions;
  - unit tests for the self-role and last-super rules (existing).
- **Rollback:** redeploy the previous permission table (a reviewed code change). Only the reverted rows change; there
  is no global switch back to the pre-D-02 broad powers.

### Phase 2 — D-03 reasons

**Status (2026-10-14):** approved for local implementation as product policy · implemented locally
(uncommitted) · unit tests pass · integration and browser checks verified locally 2026-10-15 (`validation-d03-api`,
`validation-d03-ui`; see `hellocircle-d02-d03-validation.md`) · not deployed. See `hellocircle-operating-decisions.md` §D-03 "Implementation
record".

- **Schema:** `moderation_decisions` (id, object_type, object_id, action, reason_category, explanation, internal_note
  TEXT NULL, actor_user_id, created_at; index on object).
- **API:**
  - reason fields on listing status, organisation status, claim, host application, suggestion and report actions;
  - partner reads gain `latestDecision` (no note);
  - email template `moderation_decision`.
- **UI:**
  - admin confirm dialogs gain the category select, explanation and internal note (fields already supported by
    `ConfirmDialog` children);
  - `ListingReviewNotice` and the suspended screen show the latest decision, or "No reason recorded".
- **Historical data:** no back-fill.
- **Tests:**
  - required-field validation;
  - the internal note never appears in partner JSON or email (string search);
  - history is append-only.
- **Rollback:** the columns are unused if the UI is reverted; endpoints accept but don't require reasons
  (`MODERATION_REASONS_REQUIRED` env, default on).

### Phase 3 — D-01 suspension

**Status (2026-10-15):** approved for local implementation · implemented locally (uncommitted) · verified locally 2026-10-15
(`hellocircle-d01-d08-validation.md`) · not deployed. Differences from the plan below, by the owner's boundaries:
listing statuses are **not** rewritten (no `status_before_suspension`; public reads and sales check the organisation
instead); late payments are parked in the existing finance review with the order left pending (not "paid +
cancelled"); no listing-level suspension; no `ORG_SUSPENSION_ENABLED` switch. Details: operating decisions §D-01
"Implementation record".

- **Schema:**
  - `organisations.status`, `status_changed_at`, `status_decision_id`;
  - `status_before_suspension` on `centres`, `clubs`, `experiences`, `programs`;
  - listing status value `suspended` (VARCHAR, no enum change needed).
- **Server:**
  - `offeringSellable()` in `bookingIntegrity.ts` replaces `vendorSuspended()` at its 5 call sites, and is added to
    `games.ts` paid joins at venues, the waitlist offer claim and `stripeWebhook.ts` confirmation. A verified late
    payment for a suspended organisation → paid + cancelled + **finance review item**. No new automatic refund is
    added in this phase; the D-10 automatic-refund rule (Phase 4) later covers it as case 4b;
  - `db/queries.ts` public reads, map, search, sitemap and recommendations exclude suspended orgs and listings;
  - `routes/admin.ts`: organisation and listing suspension endpoints (D-02 action `org.suspend`);
  - `GET /api/vendor/obligations` (read-only obligations + reason + support route), allowed while suspended;
  - sellability decided by the owning organisation, not the creating member;
  - automatic refunds for these late payments only once Phase 4 ships, under the D-10 rule.
- **Client:**
  - admin organisation record page (Suspend/Reinstate, Super only, with the upcoming-booking count);
  - partner restricted page (obligations, reason, contact/appeal);
  - listing record action;
  - partner suspended screen;
  - public unavailable state on the centre, club, programme and experience detail pages.
- **Migration:**
  - every existing organisation becomes `active`;
  - existing per-user suspended partners stay as today; an admin decides whether to convert them to org suspensions
    (list provided at rollout).
- **Tests:** the D-01 acceptance list, including the late-payment Stripe test-mode case and the reinstatement
  round-trip for each prior status.
- **Rollback:** reinstate orgs; the code paths fall back to listing status (`ORG_SUSPENSION_ENABLED=false` makes
  `offeringSellable` ignore the org status).

### Phase 4 — D-10 review deadline

**Status (2026-10-15):** approved for local implementation · implemented locally (uncommitted) · **verified locally** (unit, stub QA, browser and Stripe test-mode batches, and one clean uninterrupted `qa:stripe` run on final code, 51/51 — `hellocircle-d10-d11-validation.md` §3) · not
deployed. As built: a `payment_reviews` record per held session (the durable receipt) instead of new order statuses;
sweep every 5 minutes; alerts as in-app notifications to finance/super plus best-effort email; automatic refund
behind the `commerce.auto_refund_unfulfillable` switch (default on). Interpretations: operating decisions §D-11
"Implementation record". Evidence: `hellocircle-d10-d11-validation.md`.
- **Schema:** `review_hold_until DATETIME NULL` (indexed) on `bookings`, `registrations`, `program_enrollments`,
  `experience_bookings`, `game_participants` and `passes`.
- **Server:**
  - when the webhook parks a case-1 mismatch (verified, agreement-matched order), compute **once** and store
    `review_hold_until = min(parked_at + W, S − L)` (no start → `parked_at + W`; programmes → first session not yet
    started; S via `irelandTime.ts`). If the result is not after `parked_at` (starts within L, or already started),
    **store no hold**: set the order `review_urgent` and send one urgent finance alert (in
    `payments/checkoutAgreement.ts`, with a per-type start-time lookup);
  - reschedule paths (customer `bookings.ts` reschedule, partner session edits in `vendorPrograms.ts` /
    `vendorExperiences.ts`, host `games.ts` edits, venue-booking moves for linked games) apply
    `review_hold_until = LEAST(review_hold_until, newS − L)`; if that's now past → end the hold, `review_urgent`, one
    urgent alert. Customer reschedule of an under-review order → 409. Nothing ever raises `review_hold_until`;
  - W and L as server settings with the approved defaults (24 h, 2 h);
  - alerts recorded in a `review_alerts` table (order, kind `parked|halfway|expired|urgent`, unique) so each is sent
    once across sweeps, retries and restarts;
  - `occupiesCapacitySql` and `gameSeatSql` include `review_hold_until > NOW()`;
  - a sweep every 15 minutes (`index.ts` interval, same pattern as existing sweeps) sends the halfway alert, marks
    expired holds `review_expired` and alerts finance. **Expiry never creates a refund row or calls Stripe**;
  - automatic refund **only** while processing a case-4/4b payment event, and only when all five D-10 preconditions
    hold: Stripe re-fetch of session, PaymentIntent, charge, refunds and dispute; verified association; charge
    succeeded for the agreed amount and currency with `amount_refunded = 0` and no dispute; no HelloCircle refund row
    and no open review for the order; unfulfillable. Under `SELECT … FOR UPDATE` on the order, insert the refund row
    `pending` with unique key `auto-refund:<charge id>`, then call Stripe with the same idempotency key. A Stripe
    failure leaves the row `pending` + error and creates a finance item (no retry with a new key). Every other case
    goes to finance.
- **Client:** PaymentSuccess copy for cases 1, 3 and 4.
- **Tests (controlled clock):**
  - deadline calculation: start far away, start within a day, start within L, already started, no start, programme
    with past first session;
  - reschedule earlier (shrinks; past → urgent), reschedule later (unchanged), customer reschedule → 409;
  - capacity predicates (hold counts, deadline frees);
  - expiry: place released, `review_expired`, one alert, no refund row, no Stripe call (provider spy);
  - alerts sent exactly once per kind across repeated sweeps and a restart;
  - automatic-refund rule: refunds only for 4/4b; never for a mismatch, uncertain association, prior partial refund
    or dispute; exactly once under two concurrent deliveries and an out-of-order replay; Stripe failure → pending row +
    finance item;
  - a concurrency test (last place vs hold);
  - a Stripe test-mode late payment (refund issued once);
  - replay never confirms (existing).
- **Containment / rollback (corrected 2026-10-15):** switching automatic refunds off stops new automatic refunds
  only (in-flight, unknown and completed refunds are still reconciled); the review window applies to new reviews only
  and is not a rollback. Schema-compatible rollback and forward repair: `hellocircle-d10-d11-validation.md` §1a–1b.

### Phase 5 — D-11 recheck with Stripe

**Status (2026-10-15):** approved for local implementation · implemented locally (uncommitted) · **verified locally** (unit, stub QA, browser and Stripe test-mode batches, and one clean uninterrupted `qa:stripe` run on final code, 51/51 — `hellocircle-d10-d11-validation.md` §3) · not
deployed. The recheck is keyed on the payment review (`POST /api/admin/finance/payment-reviews/:id/recheck`), with
the payment-event route as an alias; a closed review marks the order `refunded` (not `failed`).
- **Schema:** `webhook_events.resolved_at`, `resolution` (status value `resolved`).
- **Server:**
  - `POST /api/admin/finance/webhooks/:id/recheck` in `routes/adminFinance.ts` (finance or super permission);
  - atomic claim of the event (same `→ processing` claim as Replay) so concurrent rechecks get 409;
  - provider **reads** for session, PaymentIntent, charge, all refunds and disputes (extend `payments/provider.ts`).
    The recheck has no code path to Stripe's refund-create API;
  - record refunds through `recordProviderRefunds`-style idempotent inserts keyed by provider refund id (unique), and
    update statuses of ones already recorded;
  - closure only when association is verified, succeeded refunds = charged amount, none pending, and no dispute;
    then the order becomes `payment_status = 'refunded'` with `status = 'cancelled'` (corrected 2026-10-15 — not
    "failed"; the booking is never restored), the place and coupon hold are released. Otherwise it stays open;
  - a provider error writes nothing and leaves the event as it was;
  - audit `payment.review_rechecked`.
- **Client:** a "Recheck with Stripe" action on the payment-event record page, with the outcome shown.
- **Tests (Stripe test mode + provider spy):** full refund; two partials summing to the charge; one partial (stays
  open); pending then succeeded; failed; disputed and refunded (stays open); association unverifiable (stays open);
  webhook-first ordering; double recheck no-op; two concurrent rechecks (one 409); provider error (nothing written);
  refund-create never called; wrong role 403.
- **Rollback:** hide the action; events stay in review (today's state).

### Phase 6 — D-08 staff management

**Status (2026-10-15):** approved for local implementation · implemented locally (uncommitted) · verified locally 2026-10-15
(`hellocircle-d01-d08-validation.md`) · not deployed. Removal also moves the member's coupons to the owner and keeps the
listing creator in `created_by_user_id`. Details: operating decisions §D-08 "Implementation record".

- **API (in `routes/org.ts`, owner only):**
  - `PUT /api/vendor/org/staff/:id {platformRole, rowVersion}`;
  - `DELETE /api/vendor/org/staff/:id {rowVersion}`, which deletes the member's sessions, clears `org_id` and moves
    their listings' `vendor_id` to the owner (in one transaction);
  - `users.row_version` for stale-screen protection (`ensureColumn`).
- **Client:** `VendorOrg.tsx` staff table with role descriptions, Change role and Remove (centred confirmations).
- **Tests:** the D-08 acceptance list, especially a removed member's old cookie replayed against every partner API
  (authorization fixture).
- **Rollback:** remove the endpoints; no data loss (a removed member can be re-invited).

### Phase 7 — D-06 claims
- **Schema:** `listing_claims.org_id`, `drafted_by`, `submitted_by`, status values `draft`/`withdrawn`. One **active**
  (draft or pending) claim per (org, listing), enforced in code inside a transaction; no limit on the number of
  different listings an organisation claims.
- **API:**
  - owner-only submit;
  - manager draft;
  - owner withdraw;
  - admin approval closes competing organisations' claims **on that listing only**, in the same transaction.
- **Migration:** set `org_id` on existing claims from the claimant's user; leave them pending.
- **Tests:** the D-06 list.

### Phase 8 — D-05 listing revisions
- **Schema:** `listing_revisions`; `row_version` on `centres`, `clubs`, `experiences` and `rooms`.
- **Server:**
  - field classification constant per listing type (single source, unit-tested): operational, low-risk and **price**
    fields immediate; material content fields to a revision;
  - price changes validated (whole cents, not negative, per-type maximum) and audited as `listing.price_changed`;
    existing orders keep their stored price (D-04 stored breakdown; today's per-order columns already do);
  - vendor PUT routes split immediate vs revision fields;
  - admin list, compare, approve and reject;
  - public queries unchanged (they read the live columns, which only change on approval).
- **Client:**
  - partner "Changes waiting for review" banner with withdraw;
  - admin revision record page with a field diff.
- **Tests:** the D-05 list, including the public-JSON leak test.
- **Rollback:** `LISTING_REVISIONS_ENABLED=false` makes all fields immediate again (today); open revisions stay
  stored for later.

### Phase 9 — D-07 resident suspension
- **Schema:** `residents.status` (`active`/`suspended`), `status_decision_id`.
- **Server:**
  - `attachResident` sets `req.residentRestricted`, and a guard refuses write routes;
  - a resident-side allow-list for receipts and refunds;
  - host and organiser pause hooks in `games.ts` and `circles.ts`.
- **Client:**
  - restricted page;
  - admin Support action on a new resident record page (needed anyway; listed as a gap).
- **Tests:** the D-07 suspension list.

### Phase 10 — D-07 deletion
- **Schema:** `account_deletion_requests` (resident, status, requested_at, attempts, last_error, completed_at). No
  waiting period: execution starts once the request is confirmed and unblocked. "Deactivate account" stays as is.
- **Server:**
  - request, cancel and status endpoints;
  - a blocker check;
  - a job (interval sweep) doing per-table deletes and anonymisation, plus provider media deletes (R2/Cloudinary
    adapters), idempotent and retried;
  - an audit entry without personal data.
- **Inputs required before build (blocking):** legal confirmation of the retained-field list and the record keeper
  per order.
- **Tests:** blockers; execution; re-run no-op; provider failure → `failed` + retry; financial reconciliation still
  balances after anonymisation.

### Phase 11 — D-04 unified pricing (part A — can be approved without the money values)
- **Server:**
  - `commerce/engine.ts` `priceOrder()` used by `bookings.ts`, `registrations.ts`, `programs.ts`, `games.ts` and
    `passes.ts` (experiences already wired);
  - switches `commerce.engine_v2_<type>` (only added as each type is wired: no dead switches);
  - rule version `appliesTo` coverage check (fail closed);
  - stored breakdown in `orders` for every type, including the rule version id and its `commercial_status`;
  - production gate: paid checkout requires `PAID_CHECKOUT=open` **and** an effective version with
    `commercial_status = 'approved'` (in `commerce/releaseGates.ts`); dev, QA and test run on the compatibility
    version;
  - shadow comparison logged per type.
- **Client:** remove `VAT_RATE` / `PLATFORM_FEE_RATE` from `client/src/api/public.ts`; all displays use server
  quotes.
- **Migration:** back-fill `orders` for legacy rows with `rule_version='legacy-v0'` (`commerce/backfill.ts`).
- **Inputs:** none to build part A. Today's values become the compatibility version `legacy-compat-v1`, marked
  `commercial_status = 'unapproved'` (shown on the admin rule card and in stored breakdowns). Building part A does
  **not** open paid checkout or approve any VAT, fee or deposit; a part-B version is approved and published
  separately (audited super action after the owner's recorded approval).
- **Tests:**
  - per type: engine price under `legacy-compat-v1` equals today's legacy price to the cent (deposits, coupons,
    credits, multi-person, day rate);
  - production-profile test: `PAID_CHECKOUT=open` with only the compatibility version → paid checkout refused; free
    and cash still work;
  - Stripe amount = stored total (agreement), including sessions already open at switch-over;
  - refunds and receipts read the stored breakdown; legacy orders unchanged;
  - publishing a version never changes an earlier version or an existing order.
- **Rollback:** the per-type switch off.

### Phase 12 — D-09 (only if chosen)
- Flip `PARTNER_FEE_MODEL_STATUS` in a reviewed change, add the self-dealing exclusion in `commerce/rewards.ts`
  (customer email/card vs org members), then turn the switches on per environment.
- **Tests:** the existing billing and rewards suites plus the self-dealing case.

---

## 3. Decisions that block launch features

| Launch feature | Blocked by |
|---|---|
| Public venue/club/experience pages at scale | D-01, D-02, D-03 (recommended), D-05 (recommended), D-07 deletion |
| Paid checkout (`PAID_CHECKOUT=open`) | D-04 (both parts), D-10, D-11, D-01 |
| Stripe Connect payouts (`commerce.connect_v1`) | D-04 part B (fee basis), manual hosted onboarding test |
| A second admin account | D-02 |
| Multi-staff partner organisations | D-08, D-06 |
| Pro / partner rewards | D-09 (+ D-04) |

## 4. Evidence required per phase

For each phase:
- the server unit tests (isolated profile);
- the matching authorization-matrix rows;
- one browser completion spec with screenshots (record page, confirmation, partner-visible result);
- a Stripe test-mode run where money moves;
- an updated `docs/roles-and-flows.md` and CLAUDE.md note;
- an entry in `docs/hellocircle-completion-validation.md` with PASS / FAIL / BLOCKED / NOT TESTED.
