# Revenue & Connect — rollout log

Branch `feature/commerce-engine` (local, not pushed). Decisions B3–B11 taken at the recommended defaults (owner:
"continue", 2026-10-09). B1 (legal entity and Stripe country) and B2 (test key) remain open; they only block policy
publication and Stage 5.

## Stage 2a — Configuration, admin roles, plans, promotions

**1. Inspected.** `commerce/catalog.ts` and `rules.ts`, `auth.ts` (user loading), `routes/admin.ts`, the
existing switches and the audit columns.

**2–3. Changed / files.**
- **New:**
  - `server/src/commerce/plans.ts`: current plan, plan terms, assignment, campaigns, Pro break-even
  - `server/src/commerce/plans.test.ts`
- **Edited:**
  - `commerce/catalog.ts`: 11 new rule keys, entitlements as included/not-included
  - `commerce/rules.ts`: review and retire steps, `reviewed_by`, `actor_role` in the audit
  - `db/index.ts`: schema
  - `auth.ts`: `adminRole`, `requireAdminRole`, `hasAdminRole`
  - `routes/admin.ts`: finance gate on commerce and coupons; `/admins` role management
  - `routes/adminCommerce.ts`: review/retire, plans, partner plan assignment, campaigns, enrolment
  - `commerce/rules.test.ts`: three tests rewritten for B11
- **Client:** `api/admin.ts` and `components/AdminCommerce.tsx` (review/retire actions and badges; the new rule
  keys appear automatically in the generic editor).

**4. Database (additive).**
- `users.admin_role` (existing admins backfilled to `super`), `audit_log.actor_role`,
  `commerce_rule_versions.reviewed_by`.
- New tables:
  - `pricing_plans` (free, pro, enterprise=disabled)
  - `partner_plan_assignments` (plan plus optional `fee_plan_key`, effective-dated, one in force at a time)
  - `promotion_campaigns` (with `commission_plan_key`)
  - `promotion_enrollments` (unique per campaign and partner)
- Seeded **v1 of 11 new rules** with the brief's defaults: `plan_free` (9% / €0.75), `plan_pro` (7% / €0.50 /
  €29), `plan_rules` (next booking / period end / 7-day grace), `entitlements_free` and `entitlements_pro`,
  `tax_vat` (23%, standard), `payment_costs` (1.5% + €0.25 card, 0.25% + €0.10 payout, €2/month account, instant
  1.25% min €0.75), `settlement` (48h, weekly Monday, €25 minimum), `rewards` (1 point/€, 10,000, 18 months),
  `credits` (12 and 24 months, no cash), `availability` (IE, EUR).
- The earlier brief's target draft is discarded (B11).

**5. APIs (admin).**
- `GET /api/admin/admins`, `PUT /api/admin/admins/:id/role` (super only)
- Under `/api/admin/commerce` (finance or super):
  - `POST /rules/:id/review`, `POST /rules/:id/retire`
  - `GET /plans`
  - `GET` / `POST /partners/:kind/:id/plan`
  - `GET` / `POST /campaigns`, `POST /campaigns/:id/enroll`
- **Behaviour change:** `/api/admin/commerce/*` and `/api/admin/coupons*` now require finance or super. Every
  existing admin is super, so no current access is lost.

**6. UI.** Commercial rules shows all the new settings with their brief defaults, plus Send for review, Retire,
and the "In review" and "Retired" badges. Plan, campaign and admin-role screens come in Stage 3; the APIs exist now.

**7–9. Tests.** `plans.test.ts` (17 tests):
- every new key valid and resolving to the brief's numbers
- the Free plan keeps today's features
- break-even €1,450
- finance, support and legal gating
- super-only role changes with a reason; can't change your own; last super protected
- `actor_role` in the audit
- full draft → review → approve (by another admin) → publish → retire lifecycle; retiring the global version in
  force is refused
- Free by default; Pro assignment changes the resolved fee; no back-dating; one assignment in force
- Enterprise disabled; unknown partners refused
- founding campaign gives Pro features with a Free commission for 90 days, then reverts
- no double enrolment; the cap holds under three concurrent enrolments

Results:
- Full server suite: **59 files, 614 passed, 23 skipped**.
- Client: 105 passed.
- Build clean.

**10. Security.** First admin privilege boundary: money settings are finance-only, and role changes are
super-only with a reason. Plan assignments and enrolments are audited.

**11. Data-migration impact.** Additive only. No live checkout reads plans yet (the `pe-2` engine in Stage 2b).
Existing admins become super.

**12. Remaining risks.**
- Moderation, support and listing admin routes are still open to every admin role. Gating them is a follow-up
  (needs per-route mapping).
- Entitlements aren't enforced anywhere yet (by design, until features are tied to plans).
- B12 default needs your confirmation.

**13. Rollback.** Revert the commit. The new columns and tables are ignored by older code. If needed, any admin can
be set back to `super` by setting `users.admin_role = NULL` (it resolves to super).

**14. Next.** Stage 2b: the `pe-2` calculation engine (fee base, minimum fee, fee VAT, partner pool, splits,
coupon funding types, credits, reserves, margin warnings) as golden tests on test vectors T1–T7, plus the
`PaymentProvider` interface (Stripe and Stub).

## Stage 2b — Calculation engine (pe-2) and payment-provider layer

**1. Inspected.**
- Every direct Stripe call: `checkoutService.ts` (checkout, customers, refunds) and `routes/residents.ts` (saved
  cards).
- The refund test's Stripe fake.
- The QA stub seam.
- The brief's §6–§8 formulas and §7 vectors.

**2–3. Changed / files.**
- **New:**
  - `commerce/calc.ts`: pure pe-2 engine (fee base, minimum fee, fee VAT, partner pool, five discount funders,
    credits, refunded amount, four split rules, card/payout estimates, reward and risk reserves, margin warning,
    blocking rules), plus `monthlyPlanCost`
  - `commerce/calcContext.ts`: resolves the published rules for a partner (plan, partner overrides, VAT, costs,
    settlement, rewards) and returns the rule versions used
  - `commerce/planCompare.ts`: neutral Free vs Pro comparison
  - `payments/provider.ts`: `PaymentProvider` interface, `StripeProvider`, deterministic `StubProvider`
  - `routes/pricingPublic.ts`: public `/api/pricing/plans|estimate|compare`
  - Tests: `commerce/calc.test.ts`, `payments/provider.test.ts`, `routes/pricingPublic.test.ts`
- **Edited:**
  - `checkoutService.ts`: checkout, customers and refunds via the provider; `issueStripeRefund` gains optional
    `amountMinor` and `idempotencyKey` for partial refunds
  - `routes/residents.ts`: saved cards via the provider, plus an ownership check on set-default
  - `stripe.ts` / `stripeWebhookPolicy.ts`: live-key refusal
  - `routes/adminCommerce.ts`: `/simulate`, `/simulate/plans`
  - `index.ts`: mount

**4. Database.** None.

**5. APIs.**
- **New:**
  - `GET /api/pricing/plans`
  - `POST /api/pricing/estimate` (rate-limited, partner-agnostic, no margin warning)
  - `POST /api/pricing/compare`
  - `POST /api/admin/commerce/simulate` (finance; partner-aware; margin warning; rule versions)
  - `POST /api/admin/commerce/simulate/plans`
- **Changed:** `PUT /api/residents/me/payment-methods/:id/default` now returns 403 for a card that isn't the
  resident's. Before, the check was left to Stripe.

**6. UI.** None (calculators and simulator screens are Stage 3).

**7–9. Tests.**
- `calc.test.ts` (23): **T1–T7 to the cent** using the seeded rule values; shared-coupon remainder; host- and
  venue-funded discounts; HelloCircle credit vs vendor credit; percentage, fixed-host and custom splits; refunded
  amount; free orders; reverse-charge and exempt; reward reserve ≈ 0.29%; every blocking rule; a reconciliation
  property sweep (`customer + HC subsidy = pool + fee + VAT`, allocations = pool, pool ≥ 0); Free vs Pro at
  €1,450; minimum fee per order.
- `provider.test.ts`: stub selection guarded; refund and transfer idempotency; over-refund refused; full refund
  once then reconcile; partial refund amount and key; unknown payment; live-key matrix.
- `pricingPublic.test.ts`: public plans, estimate (T1, warning hidden), partner ids ignored, validation,
  comparison; simulator finance-gated; partner plan and partner-specific override resolution; T5 through the API.
- The existing refund tests (HC-QA-091) pass unchanged through the provider.

Results:
- Full server suite: **62 files, 654 passed, 23 skipped**.
- Client: 105 passed.
- Build clean.

**10. Security.**
- Live Stripe keys are refused unless `NODE_ENV=production` and `APP_ENV` is unset or `production`. Staging, dev
  and test can never charge real cards, and prod behaviour is unchanged.
- Card set-default now checks ownership.
- The public estimator is rate-limited, accepts no partner ids and hides internal warnings.

**11. Data-migration impact.** None. No live checkout uses pe-2 yet. Existing Stripe behaviour is unchanged
(same session, refund and customer calls).

**12. Remaining risks.**
- Payout estimates assume one payout per order. Weekly batching lowers the real cost, which reconciliation
  replaces with actuals in 2c/2d.
- `StripeProvider` refuses transfers until Stage 5.
- Card-mix and FX costs aren't modelled yet; that comes with the admin simulator UI in Stage 3.

**13. Rollback.** Revert the commit. There's no schema change, and the provider wraps the same Stripe calls one to
one.

**14. Next.** Stage 2c: append-only double-entry ledger, `webhook_events` store with replay and a manual-review
queue, handlers for the non-Connect events (`charge.refunded`, `charge.dispute.*`, `payment_intent.*`),
`refunds` and `disputes` tables, and partial refunds wired to allocation reversal.

## Stage 2c — Ledger, webhook event store, refunds and disputes

**1. Inspected.**
- The webhook handler and its policy test.
- Every refund path: `refundPaidOnce` (used by bookings, registrations, programmes, experiences and games) and
  `issueStripeRefund`.
- The QA provider seam.
- The legacy rows' stored breakdowns: bookings, registrations and experiences have them; programmes, games and
  passes store only a total.

**2–3. Changed / files.**
- **New:**
  - `commerce/ledger.ts`: balanced, idempotent group posting; full and proportional reversal; balances; whole-ledger
    zero check
  - `commerce/payments.ts`: payment records; payment posting from the snapshot or the legacy breakdown (exact
    recovery from the total where none is stored); `refundInApp` (full, partial, remaining); `recordProviderRefunds`
    (delta, locked); `recordDispute`
  - `payments/webhookEvents.ts`: store, claim, finish, fail and park, replay
  - `routes/adminFinance.ts`
  - `commerce/finance.test.ts`
- **Edited:**
  - `routes/stripeWebhook.ts`: event store, `processStripeEvent` (adds `charge.refunded` and
    `charge.dispute.created|updated|closed`; `payment_intent.*` stored but ignored), payment recording after confirm
  - `checkoutService.ts`: `refundPaidOnce` records the refund and ledger reversal under its row lock, refunds only
    the remainder after a partial, returns the provider refund id
  - `payments/provider.ts`: `retrieveEvent`
  - `routes/vendorOperations.ts`: `POST /api/vendor/refunds`
  - `routes/admin.ts`: `/finance` mount
  - `commerce/catalog.ts`: ledger switch active
  - Two refund tests now also assert the returned `refundId`

**4. Database (additive).**
- New tables: `webhook_events` (unique provider + event id, summary only), `payment_records` (unique source,
  indexed by payment intent and session), `refunds` (unique idempotency key), `disputes` (unique dispute id).
- Ledger: `ledger_accounts` (22 accounts seeded), `ledger_entry_groups` (unique idempotency key), `ledger_entries`.
  **Foreign keys** link entries to groups and accounts (new tables only, B10).

**5. APIs.**
- **Finance admin, under `/api/admin/finance`:**
  - `GET /webhooks?status`, `POST /webhooks/:id/replay` (reason)
  - `GET /payments?ref`, `GET /refunds`, `POST /refunds` (any source, partial or remaining, reason, responsible party)
  - `GET /disputes`, `GET /ledger/groups`, `GET /ledger/balances`
- **Vendor finance role:** `POST /api/vendor/refunds` (own organisation's online orders only).
- **Webhook responses:**
  - duplicate delivery → 200 `duplicate`
  - concurrent delivery → 409 (the provider retries)
  - handler failure → 500 (retry), and after 5 attempts or an unmatchable event → 200 `parked` plus manual review

**6. UI.** None (finance screens are Stage 3).

**7–9. Tests.** `finance.test.ts` (16):
- unbalanced groups refused; idempotent posting; exact proportional reversal; ledger nets to zero
- legacy breakdown recovery across a range
- payment recorded once and posted (clearing 6400 = partner 5000 + VAT 1150 + fee 250, with partner party)
- partial €10 then remaining €54: the order stays paid until the end, and clearing and partner payable net to zero
- over-refund refused; cross-organisation vendor refund refused
- `refundPaidOnce` records and reverses
- `charge.refunded` doesn't double-count our own refund but records a Dashboard refund once, including when the
  event is replayed
- unknown payment → manual review
- dispute opened → lost: loss posted, recovery pending, late out-of-order update can't reopen it
- event store: duplicate and busy; summary carries no personal data; retry → park after 5; admin replay with a
  reason re-fetches from the provider

Results:
- Full server suite: **63 files, 670 passed, 23 skipped**.
- Client: 105 passed.
- Build clean.

**10. Security.**
- Events are stored without payloads or personal data. Replay re-fetches the event from the provider rather than
  trusting a stored copy.
- Processing claims are atomic.
- Refunds are row-locked end to end, so an in-app refund and a provider refund are never counted twice.
- Vendor refunds are limited to the organisation's own orders and the finance role.
- Every admin or vendor refund and every replay is audited with a reason.

**11. Data-migration impact.**
- Additive. Payment records start with payments confirmed after deploy; older payments have none, so a refund
  arriving from Stripe for one of them goes to manual review instead of guessing.
- The ledger is off by default (switch), so no postings happen until finance turns it on.

**12. Remaining risks.**
- Actual Stripe fees (balance transactions) aren't yet reconciled against estimates. That belongs with settlement
  (2d).
- A lost dispute is recorded as a loss with recovery **pending**. Recovering it from the partner happens in
  settlement (2d) or by transfer reversal (Stage 5).
- Host partial refunds for games (host route) aren't exposed yet; admin finance can refund any type.
- Pass refunds aren't supported (P2-6).

**13. Rollback.**
- Turn off `commerce.settlement_ledger` to stop new postings. Records and the event store keep working; they are
  additive and harmless.
- Code revert: the new tables are ignored by older code.

**14. Next.** Stage 2d: completion (session end + 48h), weekly settlement runs with the €25 threshold and
carry-forward, settlement allocations per vendor/venue/host, dispute recovery against pending payables, actual-fee
reconciliation, and the legacy-order snapshot backfill (dry run first). Still no transfers.

## Stage 2d — Completion, settlement, dispute recovery, fee reconciliation, backfill

**Built.**
- **Completion.** An order is complete at service end + `settlement.reviewHours`, resolved per partner. Service end
  depends on the type:
  - booking: date, time and duration
  - experience: session plus the experience's duration
  - game: session plus duration (default 120 minutes)
  - programme: end of the last session
  - registration: at payment (B13)
  - passes: excluded (B8)

  An order isn't released while it's cancelled with money held, or while a dispute is open. Release moves the
  order's net pending share to `partner_available` (`release:<type>:<ref>`), recorded once in
  `order_completions`.
- **Weekly settlement runs** (`runSettlement`):
  - The dry run is the default and previews exactly what the real run would release and settle.
  - Each run key completes once.
  - Payees at or above `minPayoutMinor` get a settlement (`settlement:<id>`: available → `settlement_payable`) with
    its items. Anything below the minimum, or negative, carries forward.
- **Refunds after completion** debit `partner_available`, so a balance can go negative and is netted later.
- **Lost disputes.** Finance decides who bears each one: the partner (recovered from available) or HelloCircle
  (absorbed).
- **Fee reconciliation.** Estimated card fees are accrued, then reversed and replaced by the provider's actual fee.
  The `estimate` and `actual` bases are reported separately.
- **Legacy backfill** (`commerce/backfill.ts`, `scripts/backfillLegacySnapshots.ts`): dry run by default,
  idempotent, refuses the prod database without approval, lists any unrecoverable rows.
- **APIs:**
  - `POST /api/admin/finance/settlements/run`, `GET /settlements[/:id]`
  - `POST /disputes/:id/recovery`, `POST /fees/reconcile`, `GET /partners/:kind/:id/balances`
  - `GET /api/vendor/earnings` (finance or analyst role)
  - `GET /api/games/host/earnings`
- **Schema:** `order_completions`, `settlement_runs`, `settlements` (row_version), `settlement_items` (unique per
  ledger group), `fee_reconciliations`, `disputes.responsible`, plus the `partner_available` and
  `settlement_payable` accounts. The provider gains `paymentFee()`, and `reverseGroup` gains `accountMap`.

**Tests.** `settlement.test.ts` (9):
- service end in Ireland time
- nothing settles before completion + 48h
- the dry run matches the real run; a run key settles once; an empty week settles nothing
- threshold override carries forward
- a 20% refund after completion takes exactly €10 from available
- an open dispute blocks release; partner recovery takes €64 and the decision is final
- fees: estimate nets to 0 and actual is €1.15
- backfill: dry run, then apply once
- vendor earnings view

Full suite: **64 files, 679 passed**. The ledger still nets to zero.

**Remaining.** Transfers and payouts (Stage 5). Settlements are recorded as **due**, and no money moves.

## Stage 3 — Pricing, calculators, earnings views, admin finance UI, field help

**Built.**
- **Public `/pricing` page** (footer link "Pricing for partners"):
  - Free and Pro plan cards plus the Pro break-even, all read from `/api/pricing/plans`. No rate is hard-coded in
    the client.
  - Two live calculators, debounced, with no submit button and `aria-live` results. The order calculator covers
    plan, price, places, venue split (fixed or %) and who funds a coupon. The Free-vs-Pro month comparison is
    neutral: it reports the cheaper plan and the break-even.
- **Field help (§19D).** A versioned `help_entries` table holds 16 seeded financial fields (definition, formula,
  example, who pays, when, refund behaviour, policy link).
  - `GET /api/help/fields` is public.
  - `PUT /api/admin/help/:key` (legal/super, reason required) adds a version; it never overwrites.
  - `<FieldHelp>` is an accessible ⓘ disclosure used on the pricing page and in earnings views.
- **Partner earnings.** The vendor Earnings tab and the host Earnings tab now lead with ledger balances: pending,
  available, settled and due, plus recent settlements, each with field help and an "Estimate an order"
  calculator. The old "Total paid" figure is relabelled as customer payments, since it includes VAT and fees and
  isn't earnings.
- **Admin → Finance tab** (sections shown by admin sub-role; the server enforces the same gates):
  - ledger balances and the balanced check, plus actual card-fee reconciliation
  - calculation simulator (partner-aware, shows the rule versions used and the margin warning)
  - weekly settlement (dry-run preview, then run)
  - payment events (needs review / failed, replay)
  - refunds (full, partial or remaining)
  - disputes (recover from partner or HelloCircle absorbs)
  - plans and promotions (partner plan look-up and change, campaign create and enrol)
  - field help editor
  - admin roles (super only)

  Every write asks for an audited reason.

**Tests.** `help.test.ts` (4): seeded fields with the €88.93 example; key filter rejects junk; only legal/super can
edit; an edit adds a version and keeps the old one. The client's Ireland-date guard caught a UTC
`toISOString()` run-key default, which is now fixed to use `irelandToday()`.
- Server: **65 files, 683 passed**. Client: **16 files, 105 passed**. Build OK.
- HTTP smoke test on a throwaway MySQL (the browser extension wasn't connected, so this was checked over HTTP, not
  by clicking):
  - `/pricing` served
  - finance, admin and help endpoints return 200 for super
  - the simulator returns T1 (pool €88.93, venue €35 / host €53.93)
  - settlement refuses while the ledger switch is off, and previews once it's on
  - a help edit creates v2

**Not done in Stage 3.** A visual click-through in a browser is still owed.
