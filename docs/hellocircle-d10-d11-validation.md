# HelloCircle — D-10 / D-11 validation record

_2026-10-15. Local, uncommitted, not deployed. Disposable QA runs `qa_a35e99a58e09c361` (development and the first
three full Stripe attempts) and, after the owner-approved reset, `qa_566440f1eadeffc6` (the clean full run); QA mail
sink only, Stripe **test mode** only. No production or staging data,
configuration or users were touched._

| | D-10 paid order under review | D-11 Recheck with Stripe |
|---|---|---|
| Approval | **Approved for local implementation** (owner, 2026-10-15, with boundaries) | **Approved for local implementation** (owner, 2026-10-15, with boundaries) |
| Implementation | Implemented locally (uncommitted) | Implemented locally (uncommitted) |
| Verification | **Verified locally** — incl. one clean, uninterrupted `qa:stripe` run on final code (§3) | **Verified locally** — incl. one clean, uninterrupted `qa:stripe` run on final code (§3) |
| Deployment | Not deployed | Not deployed |

What was built, the owner's boundaries and every interpretation are in `hellocircle-operating-decisions.md` §D-11
"Implementation record (D-10 and D-11)". This document is the evidence.

## 1. Migration (additive, idempotent — `initSchema()` in `server/src/db/index.ts`)

| Change | Detail |
|---|---|
| New table `payment_reviews` | One row per Checkout session (unique `checkout_session_id`): order type/ref, payment intent, charge, received and agreed amount/currency, provider payment state, reason, detail, `hold_status`, `review_hold_until`, start, urgency, automatic-refund state and note, review status/resolution/resolver, first event, last recheck, recheck claim. Indexes on source, (hold_status, deadline), (status, flagged_at), payment intent |
| New table `payment_review_alerts` | Unique (review_id, kind) — each alert once, across sweeps and restarts |
| `review_hold_until DATETIME NULL` + index | On `bookings`, `registrations`, `program_enrollments`, `experience_bookings`, `game_participants` (passes hold no place) |
| `webhook_events.resolved_at`, `.resolution` | New event status value `resolved` (a parked event closed by its review) |
| `refunds.last_error` | Provider error text; refund statuses gain `unknown` and `failed` |
| Ledger account `unapplied_receipts` | Liability for money received but not applied to an order; used only when a held receipt is refunded with the ledger switch on (receipt + refund, net zero) |
| Commerce switch `commerce.auto_refund_unfulfillable` | Default **on**; finance/super (`commerce.operate`), audited |
| Server settings | `PAYMENT_REVIEW_WINDOW_HOURS` (24), `PAYMENT_REVIEW_LEAD_HOURS` (2), `PAYMENT_REFUND_TIMEOUT_MS` (20000) — README table |
| `settlement_items.party_type`, `.party_id` (settlement fix, §5) | Backfilled from each item's settlement; new unique index `(ledger_group_id, party_type, party_id)` created, then the old `uniq_settlement_item_group` dropped. Forward-only: an item without a party still counts as "settled for everyone" (old meaning) |
| `settlement_runs.failed_step`, `.failure` | A run that throws is marked `failed` with its step and a scrubbed error instead of staying `running` |

No backfill of payment reviews. No down-migration (house rule). Existing rows are unaffected (`review_hold_until`
NULL = no review hold).

### 1a. Containment (stopping automatic refunds)

- **Switch `commerce.auto_refund_unfulfillable` off** (Admin → Commercial rules → switches; finance or super; reason
  required; audited). This stops **new automatic refund initiation only**. Everything else keeps running:
  - refunds already requested, `pending` at Stripe, `unknown` or `failed` keep their rows and are still reconciled —
    by the sweep (stale `pending` → `unknown`), by `charge.refunded` (provider id attached by the refund's own key) and
    by Recheck with Stripe (test: *switching automatic refunds off stops new ones only …*);
  - completed refunds stay recorded;
  - new case 4 payments are recorded as received, not fulfilled, and wait in Finance → Payment reviews; new case 4b
    payments keep the D-01 behaviour (order pending, event parked);
  - existing review cases stay open with their stored deadlines; holds keep expiring at those deadlines; alerts
    continue.
- **The switch survives restarts.** Its default (on) applies only while no value has ever been stored; nothing at
  startup, migration or seeding writes it (only the audited admin route does). Test: `autoRefundSwitch.test.ts`
  (switch off → run the startup migration again → still off).
- **The review window is not a rollback.** `PAYMENT_REVIEW_WINDOW_HOURS` / `PAYMENT_REVIEW_LEAD_HOURS` apply only to
  reviews opened after the change. Stored deadlines are never recomputed (a reschedule can only shorten them), and
  existing review cases are untouched. Setting the window to 0 means new mismatches hold no place; it changes
  nothing about refunds or existing cases.

### 1b. Rollback and forward repair

Preferred: **forward repair** (fix forward on the new schema) — every D-10/D-11 change is additive and the switch
contains the only money-moving part.

If the previous application version must be redeployed on the migrated schema (schema-compatible: old code ignores
the new tables and columns), do this first, in order:
1. Switch automatic refunds off (above) and wait for none to be `requested`/`checking`.
2. Run Recheck with Stripe on every review whose automatic refund is `requested`, `provider_pending` or `uncertain`,
   until each refund row has a provider id and a final status. The previous version doesn't know the `unknown` status
   and wouldn't count those rows as refunded — an unreconciled one could be refunded again by hand.
3. Inventory open reviews (§1c query adapted to `payment_reviews WHERE status = 'open'`) and hand them to finance:
   the previous version stops counting review holds (those places become sellable at once), stops the sweep and
   alerts, and has no Payment reviews page. The data stays and is used again after a roll-forward.
4. Settlement items written by the new version carry a party; the previous version ignores the columns. Its
   settlement query treats any item for a group as settled (the old, defective meaning) — so a shared venue/host
   group can again lose one party's share until the roll-forward. Avoid running settlements while rolled back.

Never: delete payment reviews or refund rows, mark payments paid by hand, or edit statuses to make figures agree.

### 1c. Payment events parked before payment reviews existed

These have no review row. **Read-only inventory** (run against the target database; prints ids, types, amounts and
the parking reason only):

```sql
SELECT we.id, we.event_type, we.status, we.received_at, we.object_id AS checkout_session,
       JSON_UNQUOTE(JSON_EXTRACT(we.summary, '$.metadata.type')) AS order_type,
       JSON_UNQUOTE(JSON_EXTRACT(we.summary, '$.metadata.ref'))  AS order_ref,
       JSON_EXTRACT(we.summary, '$.amount') AS amount_minor,
       JSON_UNQUOTE(JSON_EXTRACT(we.summary, '$.currency')) AS currency,
       LEFT(we.last_error, 120) AS parked_because
FROM webhook_events we
LEFT JOIN payment_reviews pr ON pr.checkout_session_id = we.object_id
WHERE we.status IN ('manual_review', 'failed') AND we.event_type LIKE 'checkout.session.%' AND pr.id IS NULL
ORDER BY we.received_at;
-- and parked refunds of payments that have neither a payment record nor a review:
SELECT we.id, we.event_type, we.received_at, JSON_UNQUOTE(JSON_EXTRACT(we.summary, '$.payment_intent')) AS payment_intent
FROM webhook_events we
WHERE we.status IN ('manual_review', 'failed') AND we.event_type = 'charge.refunded'
  AND NOT EXISTS (SELECT 1 FROM payment_records p WHERE p.payment_intent_id = JSON_UNQUOTE(JSON_EXTRACT(we.summary, '$.payment_intent')))
  AND NOT EXISTS (SELECT 1 FROM payment_reviews r WHERE r.payment_intent_id = JSON_UNQUOTE(JSON_EXTRACT(we.summary, '$.payment_intent')));
```

**Can a replay initiate a refund? Yes.** Replay re-fetches the event from Stripe and processes it like a live
delivery. For an event parked because its organisation was suspended (D-01) or whose place is gone, processing is
D-10 case 4b/4, which refunds automatically when the switch is on and every precondition holds. A parked amount or
currency mismatch never refunds (case 1); replaying it opens a review whose deadline counts from the replay time.

**Controlled recovery plan** (not performed — no historical event was replayed and no refund initiated outside the
isolated tests):
1. Run the inventory; for each row, read the order and the payment in the Stripe Dashboard.
2. Decide the intended outcome per payment *before* touching it: confirm (organisation reinstated, place free),
   refund, or hold.
3. Switch automatic refunds **off** before replaying anything unless a refund is the intended outcome for every
   event in the batch.
4. Replay one event at a time with a reason; check the resulting payment review and order before the next.
5. For payments already refunded in the Dashboard, Replay (to open the review) then Recheck with Stripe closes it.
6. Switch automatic refunds back on afterwards if that is the operating choice.

### 1d. Status semantics (payment ≠ fulfilment)

Each fact has its own column and is never merged:
| Fact | Where | Values |
|---|---|---|
| Payment at the provider | `payment_reviews.provider_payment` + Stripe | verified paid |
| Order payment state | order `payment_status` | `pending` (received, held) · `paid` · `refunded` |
| Booking fulfilment | order `status` | `confirmed` · `cancelled` (not fulfilled) |
| Capacity | `payment_reviews.hold_status` + order `review_hold_until` | none · held · expired · released · consumed |
| Review | `payment_reviews.status` / `resolution` | open · resolved (confirmed / refunded / auto_refunded) |

A fully refunded payment is `payment_status = 'refunded'`; its booking stays `status = 'cancelled'` (never restored,
never "failed" or "unpaid"). Spec wording that said `failed` (D-11 outcomes table) has been corrected.

## 2. Requirement → evidence

Unit = `server/src/payments/paymentReview.test.ts` (28 tests, stub provider with a call log, isolated test DB).
Stub QA = `revenue-d10-review` (`tests/integration/specs/hc-d10-review.spec.ts`, real server + browser, provider stub).
Stripe = `stripe-d01` (`tests/integration/specs/stripe-d01.spec.ts`, 4 tests) and `stripe-payment`
(`STRIPE-LATE-SUCCESS`), real test-mode Checkout paid with test cards, real signed events, refunds read from Stripe.

| Requirement | Evidence |
|---|---|
| Verified receipt recorded durably even when not confirmed; Finance finds it without event logs | Unit (every case reads the review: received amount, currency, payment intent); Stripe `STRIPE-D01-HELD` (review row with Stripe's amount/currency/payment intent; listed by `GET /payment-reviews`); stub QA (Finance list + review page) |
| Payment, booking, capacity and review states kept separate | Review page statuses (screenshots); unit asserts each separately (e.g. expiry: hold `expired`, review still `open`, order still pending) |
| No duplicate financial records; held event processed later | Stripe `STRIPE-D01-HELD` (one payment record after reinstatement); unit 4b-off test (one payment record after two redeliveries); concurrent delivery (one refund row, one provider call) |
| Never "unpaid" for a charged customer | D-11 closure → `refunded` (unit, stub QA, Stripe); refused/uncertain refund → order stays `paid` + `cancelled` (unit) |
| Deadline: far start / start within a day / within 2 h / started / no start | Pure deadline test (all cases incl. W=0); unit: 3 days (24 h hold), 90 min (no hold, urgent, one urgent alert), started (no hold, replay can't confirm), registration (exactly 24 h); stub QA: 90 min urgent + customer page |
| Programme: earliest future session; part-way → manual | Unit programme test (S = future session, "part-way" flagged; none left → after_start) |
| Rescheduling only shortens | Unit: activity moved later (unchanged), earlier (shrinks to S − 2 h), inside the lead (hold ends, one `shortened` alert); customer reschedule → 409 |
| Expiry releases inventory, keeps the case, never refunds | Unit (place freed, review open, no refund row, zero provider refund calls, three sweeps → one alert); stub QA (competing checkout 409 while held, 201 after expiry, no refund row) |
| Durable, deduplicated, restart-safe alerts | Unit: halfway once across sweeps; expiry once across three sweeps; one notification per kind per finance admin; stale refund marked unknown once across two sweeps |
| Confirmation re-checks availability atomically, eligibility, organisation, cancellation/refund state, start | Unit `case 4b … automatic refunds off`: reinstated → confirmed only after re-checks; resold place → not reclaimed (other customer keeps it); Stripe `STRIPE-D01-HELD` (Stripe re-read before confirming); last-place race (exactly one of park/checkout holds the place) |
| Replays can't resurrect cancelled/refunded | Unit case 4 and 4b; Stripe `STRIPE-D10-4B` (duplicate + post-reinstatement delivery: stays refunded, one Stripe refund) |
| Automatic refunds only for 4/4b, all preconditions | Unit: case 4 refunded once (concurrent deliveries → one row, one call); prior partial refund → none; dispute → none; amount mismatch → case 1, none; Stripe `STRIPE-D10-4B`, `STRIPE-LATE-SUCCESS` (one refund at Stripe, matching provider id) |
| Current review vs a separate conflicting review | Precondition excludes the current session's own review (unit 4b/4 refunds succeed with their own review open); another open review for the order blocks it (code path; not separately tested) |
| Durable operation record, provider idempotency key, no transaction across the call | Refund row `auto-refund:<charge>` committed before the call; same key on the call (unit asserts the key; Stripe asserts the provider id matches) |
| Timeout / crash / uncertain → reconciliation, no blind retry | Unit: refusal → `failed`, never retried; timeout → `unknown`, redelivery makes no call; response lost after Stripe refunded → `unknown`, Recheck finds it by its key and closes with zero refund calls; stale pending (crash) → `unknown` by the sweep, once |
| D-11: finance/super only | Unit route test (unauthenticated 401, support 403, finance 200, reason required); stub QA (support 403) |
| Recheck reads only | Unit: provider call log shows zero `createRefund` across every recheck; Stripe `STRIPE-D11-RECHECK`: Stripe's refund list unchanged by each recheck |
| Multiple partials, pending/failed, disputes, association | Unit: partial → open, two partials → closed, third → no-op; pending → open → succeeded → closed; failed recorded, open; disputed + refunded → open; unmatched session → open, nothing recorded. Stripe: partial then rest (closed only at full); dispute test card → open |
| No duplicate resolution records; concurrent rechecks | Unit: one `payment.review_resolved` audit across repeated rechecks; two at once → one 409; provider error → nothing written, claim released |
| Webhook before recheck | Unit: `charge.refunded` for a held payment records the refund; recheck adds no second row |
| Doesn't restore bookings | Every closure leaves the order `cancelled` + `refunded` (unit, stub QA, Stripe) |
| Customer UI | Stub QA: "needs a quick check" (desktop + phone), "couldn't confirm in time", "wasn't confirmed — refunded" (phone); never "couldn't find that booking"; no side scroll |
| Finance UI | Stub QA: list → review page (desktop + phone); centred Recheck confirmation (reason required, button disabled until valid); closed state |
| Customer refund email once | Stub QA: one refund email in the QA sink after two rechecks |
| D-08 returning-member form | `validation-d08-rejoin-ui`: rejoin variant (no name field, current-password autofill), wrong password → inline error and nothing changes (phone + desktop), right password → `/vendor` and membership restored, used link → invalid |

Negative controls (each restored byte-for-byte and verified with `cmp`): removing the review hold from
`occupiesCapacitySql` fails the 3-day case; letting a reschedule set the deadline instead of min(old, new) fails the
rescheduling test.

## 3. Results on final code

Product code was final from 07:06 IST (2026-10-15). Later changes were test-only (QA seam, Stripe specs — listed
below).

| Check | Result |
|---|---|
| Server unit tests | 97 files · **932 passed**, 23 skipped (pre-existing) — incl. `paymentReview.test.ts` **28/28** (stable across 3 runs) |
| Client unit tests · `qa:check` · typecheck (server, client, tests) · build | **272** · **97** · PASS · PASS |
| `qa:validation` (incl. `revenue-d10-review`, `validation-d08-rejoin-ui`, `revenue-d01-sales`, D-08 batches) | **28/28** |
| `qa:booking` | **38 passed**, 2 skipped by design (REM-046 pair, as before) |
| `qa:revenue` | **38/38** |
| `qa:lifecycle` | **52/52** |
| `qa:product` | **68 passed**, 1 skipped by design (PERF-P13) |
| `qa:authorization` · `qa:security-gate` | **83/83** · **39/39** |
| `qa:stripe` `stripe-d01` (D-10/D-11, real test-mode Checkout) | **4/4** (twice: targeted, and inside full runs #2 and #3) |
| `qa:stripe` full run #1 (07:24) | 42 passed, then **SANDBOX-CONNECT-A** failed waiting for the browser to reach Stripe's hosted Connect onboarding page; the run stops at a failure. Passed alone on the same code |
| `qa:stripe` full run #2 (07:35) | **50 passed**, **SANDBOX-RECONCILE** failed — caused by my own test cleanup: the new Stripe specs deleted refund/payment rows the reconcile batch compares with Stripe. Fixed (records kept, as every Stripe test does; reconcile now also checks a held payment against its payment review to the cent); the two orphaned payment records my earlier runs left (my own synthetic programme orders, exact ids) were removed. Reconcile then passed alone: 116 payments match Stripe, 0 mismatches |
| `qa:stripe` full run #3 (07:59) | **48 passed** (every batch before it, incl. all D-10/D-11 and payment tests), then **SANDBOX-SPLIT** failed at its settlement run (line 106, non-200). Not explained: the runner withholds server diagnostics, the parties involved are the persistent `QA_VENDOR_B` / `QA_HOST` personas (none of the D-10 synthetic records), and it passed in run #2 on the same product code. Diagnostic reruns then failed at different later lines because each interrupted run leaves "due" settlements for the host (confirmed read-only), so further reruns in this database aren't meaningful |

**Full run #4 — clean (owner-approved reset, 2026-10-15 10:25–10:46 IST).** After the split-settlement defect was
diagnosed and fixed (§5): `qa:db:reset` (target verified against its manifest and container identity first; only
the QA container `hellocircle-qa_a35e99a58e09c361` was replaced — every other container unchanged), `qa:db:seed`,
connected preflight PASS; then `qa:stripe` as the first thing on the new database:

| `qa:stripe`, full, uninterrupted, final code | **51/51 passed, 19/19 batches, 0 failed, 0 skipped**, exit 0 |
|---|---|
| SANDBOX-RECONCILE in that run | 41 payment records = Stripe to the cent, 0 mismatches; 43 Stripe payments tagged for the run, the 2 without a payment record matched to their payment reviews (D-10 held payments) |
| Server-side settlement failures recorded | none |
| Run scoping | Stripe-side checks only consider objects tagged `hc_qa_run = qa_stripe_e0a796467a99e0d1`; the database is fresh, so only this run's records exist locally |

After the settlement fix (product code), re-run on the new database: server unit **937 passed** (99 files, 23
skipped as before), client 272, `qa:check` 97, build PASS, `qa:revenue` **38/38**, `qa:validation` **28/28**. The other
suites in the table above ran on the product code before the settlement fix, which only touches settlement; they
were not repeated.

Attempts, honestly: full runs #1–#3 each stopped at one failure (Connect redirect timeout; my reconcile cleanup bug;
the split-settlement defect). Diagnosis for each is above and in §5. No assertion was weakened and no case skipped.

**Test changes made (behaviour changed by approval, not weakened):**
- `STRIPE-LATE-SUCCESS`: now expects the approved D-10 case-4 outcome — cancelled + refunded once at Stripe (was
  "paid + cancelled, no refund"), plus a replay that refunds nothing more.
- `stripe-d01.spec.ts`: the earlier single D-01 test (held → reinstated → confirmed) is now four tests: 4b automatic
  refund, held with automatic refunds off (the former behaviour, still verified), Recheck with partial + full
  refunds, dispute.
- `STRIPE-WEBHOOK-UNKNOWN`: its "nothing changed" count now excludes only finance's payment-review alerts (an
  intended D-10 case-2 effect) and adds refunds and payment records to the count; it newly asserts that each unknown
  paid session is a case-2 review with no hold and no refund.
- `SANDBOX-RECONCILE`: a tagged payment with no payment record is accepted only if its payment review matches
  Stripe's amount and currency and its recorded refunds match Stripe's, to the cent.
- QA seam (`tests/integration/backend.ts`): `/api/__qa/payment` (stub batches only) delivers a paid Checkout event
  through the real webhook pipeline; the existing `success` outcome records a stub charge for a payment already under
  review (a real held payment always has one).

## 4. Screenshots (synthetic data; `docs/hellocircle-ui-completion/`)

| File | Shows |
|---|---|
| `d10-customer-review.png`, `-mobile.png` | Customer: payment received, needs a check, place held |
| `d10-customer-urgent.png` | Customer: couldn't confirm in time (starts within 2 h) |
| `d10-customer-refunded-mobile.png` | Customer: not confirmed, refund amount and date |
| `d10-finance-review-held.png`, `-mobile.png` | Finance review page: money, deadline, Stripe references, events, history |
| `d10-finance-recheck-confirm.png` | Centred Recheck confirmation with required reason |
| `d10-finance-review-closed.png` | Closed review after a provider refund |
| `d08-rejoin-form-mobile.png`, `d08-rejoin-wrong-password(-mobile).png`, `d08-rejoin-success.png` | D-08 returning-member form, wrong password, success |

## 5. The split-settlement failure (run #3) — explained and fixed

**Cause (confirmed from preserved state, not inferred):** a pre-existing settlement defect (Revenue & Connect Stage 5e),
unrelated to D-10/D-11.
- A ledger group can carry `partner_available` lines for **two** parties — a split venue/host booking refunded or
  disputed after completion. Here: `dispute_recovery:du_…` with host −€16.41 and venue organisation −€32.82.
- `settlement_items.ledger_group_id` was globally unique, and the balance query excluded a group once it was an item
  of *any* settlement.
- Settlement run 60 (run #3's `s1x`) settled the host first (settlement 22, which took that group), then inserting the
  same group for the venue hit the unique key: the run threw and was left `running` (the line-106 non-200).
- Where the second party wasn't settled in the same run, its share was silently excluded from every later run: the
  snapshot shows five two-party groups, each settled for one party only (balance drift, not just a crash).
- It only surfaces when an earlier split run leaves such a group unsettled — why run #2 passed and run #3 failed.
- Later isolated reruns failed at different lines because each interrupted run left "due" settlements behind.

**Evidence preserved before the reset** (`.qa-data/qa_a35e99a58e09c361/preserved-split-settlement-2026-10-15/`): all
full-run and suite logs (sanitised runner output), sanitised result files, the Stage 5d/5e evidence files and a
read-only database snapshot (`db-settlement-snapshot.json`: settlement runs, settlements, items, the two-party groups
and per-party balances — ids, amounts and statuses only). The old run's evidence directory is retained too.

**Fix:** settlement items are unique per (ledger group, party) — `party_type`/`party_id` added, backfilled, new
unique index, old one dropped; the balance query uses `NOT EXISTS` per party, and an item with no party keeps the old
"settled" meaning (schema-compatible with older code). Tests: `settlementSharedGroup.test.ts` — a shared group settles
for both parties once; a share carried forward is settled later (fails without the fix: negative control, restored
byte-for-byte); a failing run is marked `failed` with its step.

**Diagnostics added:** a settlement run that throws is marked `failed` with `failed_step` and a scrubbed `failure`
(never left `running`); the API answers 500 with `runId`, `step`, error `code`, scrubbed `failure` and a
`correlationId`, and the server writes one scrubbed `[error-report]` line carrying the same correlation id. The Stripe
sandbox specs (split, money, disputes) record those fields — and nothing else — in the run's evidence on any 5xx
(`noteServerFailure`). No financial records were deleted to make reconciliation pass; the earlier removal of two of my
own orphaned test payment records happened in the old (now retired) database, and the clean run's reconciliation
passed on a fresh database with every record kept.

## 6. Remaining limitations

**Tested only with the provider stub (not against Stripe):** refund refused, provider timeout, response lost after the
refund, process stopped mid-refund, pending/failed provider refunds and the halfway alert. Real Stripe can't be made to
time out or refuse on demand in test mode.

**Test residue (synthetic):** `STRIPE-WEBHOOK-UNKNOWN`'s fake sessions leave 8 parked events (and one refund event)
whose case-2 reviews it removes on cleanup; the §1c inventory correctly lists them.

**Outstanding (documented, deliberately not changed in this task):**
- A programme enrolment paid after the programme started (late or held) is never confirmed; there's no path for
  finance to confirm it after deciding it's eligible (no override, by design). Needs a product decision.
- Activities linked to a venue booking under review are not specially labelled.
- Payment events parked before this change have no review until replayed (§1).
- Alerts are in-app notifications plus best-effort email; an email lost in a crash between commit and send isn't
  re-sent (the in-app alert is durable).
- The webhook's existing `processing` state has no stale-claim recovery (pre-existing); a crash mid-event relies on
  Stripe's retry being refused as "busy". The review and refund records are durable either way.
- `refundInApp` (finance/vendor manual refunds, pre-existing) still holds its transaction across the provider call;
  only the new automatic refund avoids that.

**Release dependencies (before any deployment):**
- Owner approval to commit and deploy; nothing is committed.
- A database backup before the first boot of this version: its migration creates two tables, adds columns to five
  order tables, `webhook_events`, `refunds`, `settlement_items` and `settlement_runs`, and swaps the
  `settlement_items` unique index (forward-only).
- Decide the automatic-refund switch state for go-live (default on) and who owns the Payment reviews queue.
- Run the §1c inventory on the target database and agree the recovery plan for any events parked before this version.
- If the settlement ledger is on anywhere, run a settlement after deploy: shares lost by the old defect become
  available again — review them before paying out.

**External / manual (outside this environment):** a production Stripe webhook endpoint subscribed to
`charge.refunded`, `charge.dispute.*` and `refund.updated`; finance admins' email delivery; deciding who watches the
Payment reviews queue and how fast (the 24 h window assumes someone looks daily).
