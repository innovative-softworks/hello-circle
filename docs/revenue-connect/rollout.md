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

## Stage 4 — Policy CMS, acceptance, complaints and appeals, trader profiles

Nothing here is legal advice, and building this doesn't make HelloCircle compliant. Every document is a **structured
draft** for a solicitor to complete.

**Built.**
- **Policy CMS** (`server/src/policy/cms.ts`; tables `policy_documents`, `policy_versions`, `policy_values`,
  `policy_acceptances`):
  - All 18 documents are seeded idempotently as version-1 drafts (`policy/drafts.ts`). They use the mandatory
    placeholders and contain no rates: fee clauses link to `/pricing`, so a policy can't contradict the configured
    rules.
  - Workflow: draft → review → approved → **named legal sign-off** (legal/super only) → published → retired. With
    `require_second_approver` on, the author can't approve their own version.
  - **Publication is refused** while any `[[PLACEHOLDER]]` has no value, while editorial notes in square brackets
    remain, or before legal sign-off.
  - The published text is frozen with placeholders filled in and a SHA-256 fingerprint, so editing a value later
    never changes a published version.
  - Only one version per document can be in progress at a time. Drafts are edited with optimistic locking
    (`row_version`).
  - Admin UI: Admin → **Policies & trust**. It shows the "Draft — legal review required" banner, a source and
    preview editor, a blocker checklist and version history.
- **Public Policy Centre:**
  - `/policies` and `/policies/:key` show published versions only, with print support, version history,
    links to retired versions and the content fingerprint.
  - `/privacy` and `/cookies` show the CMS version once published, and the existing pages until then. The
    cookie-choice control stays either way.
  - Footer links: "Terms & policies" and "Complaints & appeals".
- **Acceptance and re-acceptance:**
  - Each document has an acceptance audience (partner, host or resident).
  - `GET /api/policies/acceptance/pending` and `POST /api/policies/:key/accept` (the version must be the current
    one).
  - The first publication, or any **material** version, asks people to accept again; a non-material fix doesn't.
  - `PolicyAcceptanceGate` is a modal for signed-in partners and residents. Policy, complaints, privacy and cookie
    pages stay reachable; closing the modal hides it only until the next page.
  - Nothing is published yet, so the gate is currently invisible.
- **Complaints, notices and appeals** (`complaints` table, public `/complaints` page):
  - Anyone can submit (rate-limited); signed-in people see their own requests and our reasons.
  - Support admins decide. Closing a request needs a **statement of reasons** of at least 20 characters.
  - An appeal of a moderation decision is refused if the same admin made the original decision.
  - Moderation reports now store a `statement_of_reasons`, `decided_by` and `decided_at`, entered in the existing
    Reports UI.
- **Trader profiles** (`trader_profiles`):
  - Vendor organisations (owner or finance staff) and hosts store DSA Art. 30 and DAC7 details.
  - The TIN is only ever returned masked; sending the masked value back keeps the stored TIN.
  - Changing the legal name, address or company number resets verification.
  - Self-certification is required before the "Seller information" panel appears on centre, club, experience and
    paid game pages. It never shows the TIN or date of birth.
  - Admins verify or request changes with a note (legal/support).

**Tests.**
- `policies.test.ts` (11): 18 drafts seeded; notes vs links; role gate; every publication block in order; frozen
  text and hash; acceptance, non-material and material re-acceptance plus history; one version in progress;
  complaint reasons and finality; appeal by a different admin; TIN masking and kept TIN; public trader view only
  after self-cert; verification role and note.
- `policyMarkdown.test.ts` (3): the renderer never injects HTML and refuses `javascript:` and `//` links.
- **Results:**
  - Server: **66 files, 694 passed** in two consecutive full runs. An earlier run had 9 failures in `manage.test.ts`
    that didn't reproduce, either alone or in two more full runs. The cause wasn't identified, but that file
    doesn't touch anything Stage 4 changed. Flagged as possibly flaky.
  - Client: **17 files, 108 passed**. Build OK.
- **HTTP smoke test** on a throwaway MySQL:
  - 18 drafts, none public
  - `/privacy` and `/cookies` still serve the old pages
  - all new routes return 200
  - a complaint is accepted and listed for the admin
  - the privacy draft's blockers name its 4 missing placeholders plus legal review
  - a restart leaves exactly 18 documents and versions (idempotent)

**Not done, deliberately.**
- Trader verification is recorded but **not yet enforced at checkout**. Enforcing it touches all five payment paths,
  so it's scheduled with Stage 5's Connect onboarding gate.
- DAC7 annual report generation is a later stage, as the register says.
- Publication waits on B1 (entity details) and a solicitor.

## Stage 5a — Stripe Connect: accounts, transfers, reversal recovery, payouts (against the stub)

**No Stripe API call was made.** Everything ran against the deterministic stub provider. Sandbox verification
needs B1 (the Stripe account country / legal entity) and B2 (a **test** key in `server/.env`, never in chat).

**Built.**
- **Provider:**
  - `createConnectedAccount` creates an Express account (`controller`: fees paid by the application, losses paid by
    the application, Express dashboard, Stripe collects requirements; `transfers` capability; idempotent per
    party).
  - Also new: `retrieveConnectedAccount`, `createOnboardingLink` (hosted Account Link), `createDashboardLink`
    (Express login), `createTransfer`, `reverseTransfer`, and `accountStatusFrom()` for API and webhook payloads.
  - No `application_fee_amount` anywhere.
  - The stub supports `setAccount` and `failNextTransfer`.
- **`payments/connect.ts`**, gated by the new `commerce.connect_v1` switch (default **off**):
  - **Onboarding:** country limited by the `availability` rule (IE).
  - **Readiness:** the account's transfers capability is active, payouts are enabled, and trader details are
    self-certified and not rejected. This is where the Stage 4 trader check is now **enforced** for being paid.
  - **`runTransfers`:** dry run by default; transfers each due settlement once, with key
    `settlement:<id>:<attempt>`.
    - A definitive refusal marks the attempt failed, and the next run opens a new attempt.
    - An outcome we didn't see is marked `unknown` and retried with the **same** key, so it can't double-pay.
    - Ledger: `transfer:<id>` debits `settlement_payable` and credits `stripe_clearing`. The settlement moves to
      `transferred`.
  - **`recoverByReversal`:** explicit (finance, with a reason), runs under a per-party lock and counts reversals
    already in flight. It reverses the newest transfers first, up to what's owed, and posts `reversal:<id>`
    (debit `stripe_clearing`, credit `partner_available`).
  - **Webhooks:**
    - `account.updated` mirrors the account status.
    - `payout.*` from known connected accounts is mirrored into `connected_payouts`.
    - `transfer.reversed` made outside HelloCircle goes to manual review.
    - The Connect endpoint secret `STRIPE_CONNECT_WEBHOOK_SECRET` is accepted alongside the account secret.
- **APIs:**
  - `/api/vendor/payouts` (owner or finance staff) and `/api/host/payouts`: GET, plus POST `onboarding`,
    `refresh` and `dashboard`.
  - Admin: `GET /api/admin/finance/connect/accounts`, `GET /transfers`, `POST /transfers/run`,
    `POST /partners/:kind/:id/recover`.
- **UI:**
  - "Payout account" card on the vendor and host Earnings tabs: what blocks payouts, a "Set up payouts with Stripe"
    or "Bank details and payouts" button, transfers received and bank payouts. It's hidden while the switch is
    off.
  - Admin → Finance → **Transfers**: preview and send, held/failed reasons, recent transfers, connected accounts,
    and "Recover balance…".
- **Schema:** `connected_accounts`, `transfers`, `transfer_reversals`, `connected_payouts`.
- **Decisions:** B14 (one net transfer per settlement) and B15 (hosted onboarding) are recorded in 07.

**Tests.** `connect.test.ts` (9):
- switch off → 409
- one account per organisation, non-IE refused, idempotent link
- readiness via `account.updated` and trader details
- dry run, then the real run: exact amount, group and key; ledger balanced; the second run sends nothing
- failed (new key) vs unknown (same key)
- role and reason required
- €30 dispute recovered as €25 + €5 reversals, newest first, ledger balanced, nothing left to recover
- Dashboard reversal → manual review
- payout mirroring, ignoring unknown accounts

Full: **67 files, 703 passed**. Client: 108 passed. Build OK.

**Next: Stage 5b.** Pro subscriptions on Stripe Billing, rewards, credits.

## Stage 5b — Pro on Stripe Billing, partner reward points, customer credits (against the stub)

**Built.** Each feature is behind its own switch, all **off** by default.
- **Pro subscriptions** (`commerce/subscriptions.ts`, `commerce.pro_subscriptions`):
  - Checkout uses `mode=subscription`. The price is the published `plan_pro` price plus VAT from `tax_vat` (€29.00 +
    €6.67 = €35.67/month).
  - Webhook routing carries a new `type: "subscription"` in metadata (`stripeWebhook.ts` updated in lockstep).
  - Pro starts only on a **paid** checkout; replays are no-ops.
  - `invoice.paid` posts `stripe_clearing` / `subscription_revenue` / `subscription_vat_payable`.
  - A failed payment means `past_due` plus a **7-day grace**. An hourly in-process sweep (and an admin button)
    cancels at Stripe and returns the partner to Free.
  - Cancelling is at period end; "Keep Pro" undoes it. `customer.subscription.deleted` returns the partner to Free.
  - Only Pro granted by *that* subscription is ended; a promotion or admin plan is left alone.
- **Reward points** (`commerce/rewards.ts`, `commerce.circle_credits`):
  - Awarded once per settlement (when it's created) on the settled GMV: what customers paid for the released
    orders, less refunds, × `pointsPerEuro`.
  - Each award is a lot that expires after `expiryMonths`.
  - Redeeming `redemptionPoints` (oldest lots first) gives one month of Pro. If Pro is already running, the month
    starts when it ends. Redeeming is refused while on a paid subscription.
- **Customer credits** (`commerce/credits.ts`, `commerce.customer_credits`):
  - Finance grants credit with a reason and an expiry from the `credits` rule.
  - A resident can apply it on **engine-priced** experience bookings: "Use my HelloCircle credit" on the booking
    form, applied to both the quote and checkout.
  - It works as a HelloCircle-funded discount: the partner's payout is unchanged, and the ledger books it to
    `coupon_expense` through the order snapshot.
  - Uses follow the coupon lifecycle: reserved → confirmed on payment, or released/reversed (credit restored) on
    failure or refund. No cash value.
- **UI:**
  - Plan card on the vendor and host Earnings tabs: plan, price incl. VAT, Upgrade / Cancel / Keep Pro, grace
    warning, reward points and Redeem.
  - Credit checkbox on experience booking.
  - Admin → Finance → **Credits & Pro**: grant and look up credit, subscriptions list, grace check.
- **Schema:** `partner_subscriptions`, `reward_lots`, `reward_redemptions`, `credit_lots`, `credit_uses`.

**Tests.** `billingRewardsCredits.test.ts` (11):
- switch off
- exact price, and Pro only after a paid checkout (replay-safe)
- invoice ledger 3,567 / −2,900 / −667, balanced
- grace: nothing ends before day 7, Free after, cancelled at Stripe
- cancel at period end, then deleted → Free
- 123 points for €123.45 GMV, awarded once
- redemption refused short of points, then a month of Pro with 23 points left
- credit grant requires a reason
- credit quote and checkout reserve €10, snapshot funds €10, confirmed on payment, ledger balanced
- failed checkout restores the credit
- no credit without opting in, or with the switch off

Full: **68 files, 714 passed**. Client: 108 passed. Build OK.

**Known limits (deliberate).**
- Credits apply only to engine-priced bookings (experiences today). Legacy paths ignore `useCredits`.
- Points aren't clawed back when an order is refunded after its settlement.
- Points can't be redeemed during a paid subscription; applying them as a Stripe invoice credit is a follow-up.

## Stages 6–8 — not started (need you)

The code side of Stages 2–5 is complete, local and unpushed. What remains needs people or production access:

| Stage | What it needs | Blocked on |
|---|---|---|
| 5 sandbox check | Run the Connect, Billing and webhook flows against a **Stripe test account** | B1 (entity / Stripe country), B2 (test key + Connect enabled + both webhook secrets in `server/.env`, never in chat) |
| 6 Staging | Push the branch, deploy to staging.hellocircle.ie, five test partners, reconciliation, UAT | Your explicit push/deploy instruction |
| 7 Pilot | Live keys, a few real partners, switches on one by one | Solicitor sign-off on the 18 policies (+ B1 placeholder values), tax advice (VAT, DAC7), Stripe live review |
| 8 General release | All switches on, legacy pricing retired | Pilot results |

## Stage 5c — Pre-staging hardening

Commits (local, unpushed): `ef10e09` (1/3), `3640b1a` (2/3), `f26a569` (3/3), `1f8cdaf` (soak fix).

**No Stripe API call, no `git push`, no deployment.**
- All server tests run in disposable Docker MySQL containers on the network-free stub provider.
- All browser tests run in the guarded QA harness (isolated Docker MySQL) on the same stub. Revenue batches never
  receive the Stripe test key; it is loaded only in the separate `qa:stripe` mode, which was not run.

### What changed, by requirement

1. **Reward points reversed after settlement.**
   - Each awarded order is recorded in `reward_awards` (GMV, refunds at the time of award, points).
   - A refund (`postRefund`, every refund path) or a lost dispute (`recordDispute`) re-derives
     `reversed = floor(points × min(gmv, refunds since award + lost disputes) / gmv)` and reverses only the
     difference. Replays are no-ops.
   - Points come out of the order's own lot first, then other unexpired lots oldest-first. Points already redeemed
     become a points debt (`reward_debts`).
   - While a debt is open, redemption is refused ("N points are owed…"), and new awards repay the debt before
     adding spendable points.
2. **Pro stored excluding VAT.**
   - `plan_pro.subscriptionMonthlyMinor` (€29.00) is the net price.
   - VAT comes from the versioned `tax_vat` rule resolved for this partner. A partner scope can set
     `vatMode = exempt | reverse_charge`, which means no VAT.
   - Net, VAT, rate, mode and both rule hashes are frozen on `partner_subscriptions`.
   - Stripe gets the net price plus an exclusive tax rate. €35.67 is only the IE standard-rate example, not a
     universal charge.
   - Invoice ledger postings use the VAT Stripe reports on the invoice, else the rate frozen on the subscription,
     never today's rule.
3. **Processing-fee estimates preserved.**
   - The estimate is fixed when the payment is confirmed (`payment_records.fee_estimate_minor` + the
     `payment_costs` rule hash) and accrued then (`fee:estimate:` group). It is never reversed or rewritten.
   - Reconciliation clears the accrual at the estimate (`fee:actual:`) and posts `actual − estimate` as a separate
     variance group (`fee:variance:`, account `processing_fee_variance`).
   - `fee_reconciliations` keeps the estimate, actual, variance and estimate source (`at_payment` / `late` for
     payments recorded before this change).
   - Booking pricing snapshots are not touched.
4. **Transfers separated from bank payouts.**
   - Data: `transfers` (HelloCircle → the partner's Stripe account; ours) and `connected_payouts` (Stripe → bank;
     mirrored only).
   - API: `/api/{vendor,host}/payout-account` returns `transfers` and `bankPayouts` separately.
     `partnerBalances` now returns `transferDueMinor` and `transferredMinor` (it was `settledDueMinor`).
   - Help texts get v2 entries ("Settled — transfer due", "Minimum weekly transfer", "Your earnings").
   - UI: the pricing page, partner cards and the calculator ("Partner earnings") say *transfer* and *bank payout*,
     never "payout" for both.
5. **Per-booking allocations.**
   - When a transfer is created, `transfer_allocations` gets one immutable row per settlement item: kind
     `booking`, `refund` or `adjustment`, plus the booking's source.
   - The rows must sum to the transfer amount, or the transfer's bookkeeping is refused.
   - Reversals are recorded beside allocations (`transfer_allocation_reversals`), never by editing them.
   - Partial reversal of one allocation: `POST /api/admin/finance/allocations/:id/reverse`.
6. **Partner debt** (`commerce/debts.ts`, `partner_debts`):
   - An admin opens a debt (reason ≥ 10 characters; one open debt per partner) for what the partner owes, which is
     their negative available balance.
   - This **freezes** their earnings: settlement runs carry them forward with `frozenByDebtId`, and the transfer
     run holds them.
   - It then **attempts reversal** of the partner's *own* newest allocations. Recovered and unrecovered amounts are
     recorded, and a refused reversal leaves the debt open (retry: `POST /debts/:id/retry`).
   - Whatever isn't recovered is **offset** by the partner's own future earnings: when their available balance is
     back to ≥ 0 at a settlement run, the debt closes as `offset` and the freeze lifts.
   - Every query is scoped to the debt's own party, and tests assert that no reversal touches another partner's
     transfer.
   - This replaces the 5a "recover balance" action.
7. **Separate consents.** `consent_records` is an append-only log with one purpose per row: `privacy_notice_ack`,
   `marketing_email`, `analytics_cookies`, `advertising_cookies`. Contractual acceptance stays in
   `policy_acceptances`.
   - **Marketing:** recorded at every sign-up path and only when it actually changes in settings. It is removed
     from the notification-preferences JSON. `residentAllows(…, "marketing")` used to default to *on* and now
     requires an opt-in record.
   - **Privacy notice:** acknowledged, not accepted (`policy_documents.acceptance_kind = 'acknowledge'`). The gate
     shows two sections with two checkboxes. Accepting the notice is refused, and contracts can't be
     "acknowledged".
   - **Cookies:** the banner offers Necessary only / Choose… (analytics and advertising separately) / Accept all.
     Google Consent Mode v2 defaults everything to denied. Old stored choices migrate ("accepted" → analytics only).
     Choices are recorded server-side per browser and per signed-in person.
8. **`manage.test.ts` flake.** See the diagnosis below.
9. **Browser tests.** `npm run qa:revenue`: 14 journeys × desktop and mobile = 28 tests in the guarded harness.
10. **Negative paths.** See the mapping table below.
11. **Docs.** This section, plus 07 (decisions B16–B21, blockers).

### Bugs found and fixed during 5c

- **`ledger_entries` declared database foreign keys** (Stage 2c).
  - This breaks the codebase's no-foreign-keys rule, and schema setup fails for a database user without the
    `REFERENCES` privilege. The QA harness user has no such privilege, and the production user may not either,
    which would have failed the first boot after deploy.
  - Constraints removed; `postGroup` refuses unknown accounts before writing anything.
  - The table has never shipped (unpushed), so its CREATE block was corrected in place.
- **`GET /api/games/host/earnings` was registered twice** (Stage 2d). Hosts never received their ledger balances,
  and their earnings card crashed. Balances moved to `/host/balances`, with a regression test. A scan of all
  routers found no other duplicates.
- **Migration order:** a 5c column was being added to `policy_documents` before the table was created on a fresh
  database. Moved after creation; caught by the isolated server tests.
- **Mobile:** the admin policy versions table widened the whole page on phones. Now wrapped in a scroll container.
- **Cross-file test-order dependency**, found by the shuffled soak (seed `1456911154`). Each test file's stub
  provider numbered Connect accounts from 1, so two files both created `acct_stub_1`, and one cleaned up payouts
  under a guessed id. Stub Connect ids now carry a per-process tag, and cleanup uses the real account. That seed
  passes now. Test-only issue; production ids come from Stripe.

### Files changed (56 code and test files in `9097bd9..1f8cdaf`, plus these two docs)

- **New, server:**
  - modules: `commerce/debts.ts`, `consent.ts`, `routes/consents.ts`
  - tests: `commerce/negativePaths.test.ts`, `routes/consents.test.ts`
- **Changed, server:**
  - commerce: `commerce/{payments,rewards,settlement,subscriptions,ledger}.ts`
  - payments: `payments/{connect,provider}.ts`
  - policy: `policy/{cms,drafts}.ts`
  - routes: `routes/{adminFinance,games,policies,residents,auth,manage}.ts`
  - other: `residents.ts`, `notifications.ts`, `index.ts`, `db/index.ts`
  - tests: `commerce/{billingRewardsCredits,settlement,finance}.test.ts`, `payments/connect.test.ts`,
    `routes/{games,manage}.test.ts`
- **New, client:** `cookieConsent.ts` (+ test)
- **Changed, client:**
  - components: `CookieNotice`, `PolicyAcceptanceGate`, `AdminFinance`, `AdminPolicy`, `EarningsSummary`,
    `PayoutAccountCard`, `PlanCard`, `PricingCalculator`
  - pages: `CookiePolicy`, `Pricing`, `AdminDashboard`
  - API: `api/{admin,public,resident,vendor}.ts`
- **QA harness:**
  - new: `revenue-fixture.ts`, `specs/revenue-{public,partner,resident,admin,admin-b}.spec.ts`
  - changed: `run.ts` (`revenue` mode), `reporter.ts`, root `package.json` (`qa:revenue`)
- **Docs:** this file and `07-implementation-plan.md` (B16–B21)

### Migrations (all additive, idempotent, in `initSchema()`; no down path)

| Change | Kind |
|---|---|
| `payment_records.fee_estimate_minor`, `fee_estimate_rule_hash`, `fee_estimated_at`; `fee_reconciliations.variance_minor`, `estimate_source` | ensureColumn |
| ledger account `processing_fee_variance` | INSERT IGNORE |
| `partner_subscriptions.net_minor`, `vat_minor`, `vat_bps`, `vat_mode`, `plan_rule_hash`, `tax_rule_hash` | ensureColumn |
| `reward_awards`, `reward_reversals`, `reward_debts` | CREATE TABLE IF NOT EXISTS |
| `transfer_allocations`, `transfer_allocation_reversals`, `partner_debts`; `transfer_reversals.debt_id` | CREATE TABLE / ensureColumn |
| `consent_records`; `policy_documents.acceptance_kind` (+ privacy notice set to `acknowledge`, audience `all`) | CREATE TABLE / ensureColumn / UPDATE |
| `help_entries` v2 rows for 4 terminology entries | INSERT IGNORE |
| `ledger_entries`: foreign keys removed, index on `account_code` | edit of an unshipped CREATE block |

### Calculations

- **Fee variance:** `variance = actual − estimate`. The estimate is fixed at payment as
  `applyBps(amount, cardBps) + cardFixedMinor`.
  - Example (test): €64 → estimate 121, stub actual 115 (1.4% + 25), variance −6.
  - The `stripe_clearing` total equals the actual fee.
- **Pro VAT:** `vat = applyBps(net, vatBps)` when `vatMode = standard`, otherwise 0.
  - IE standard: 2,900 + 667 = 3,567.
  - Invoice split: `net = amount_paid − reported tax`, else `divRoundHalfUp(gross × 10,000, 10,000 + frozen vatBps)`.
- **Reward reversal:** `floor(points × min(gmv, refunds since award + lost disputes) / gmv) − already reversed`.
  - Example: a 123-point award with half refunded (6,172 / 12,345) reverses 61; the rest refunded reverses 62 more.
- **Allocations:** Σ allocation amounts = transfer amount, otherwise the transfer's bookkeeping is refused.
  - Reversible room per allocation = amount − its in-flight or created reversals, capped by the transfer's room
    (amount − reversed − in flight).
- **Debt:** `outstanding = opened − recovered − offset`.
  - At settlement, a frozen partner with net ≥ 0 closes the debt as offset (`offset = opened − recovered`).
  - Example (test): €4.00 owed, €1.50 recovered by reversing one booking's allocation, €2.50 offset by €10 of new
    earnings → €7.50 carried (below the €25 minimum).

### Test evidence

- **Server:** 70 files, **740 passed** (23 skipped, pre-existing); 26 new tests in 5c.
- **Client:** 18 files, **110 passed**.
- **Build:** OK.
- **Browser (`qa:revenue`):** **28 / 28 passed in one run**: public 6, partner 6, resident 6, admin 4, admin-b 6.
  - Covers pricing and calculators, cookie choices, Policy Centre and complaints, the gate (accept vs
    acknowledge), vendor balances, payout onboarding, plan card, trader details, Pro upgrade, host earnings, credit
    at checkout, admin simulator, transfer preview, debts, credits, policies and trust, settlement preview, payment
    events, refunds, disputes, plans, roles, opening a debt (refused reversal), allocations, and field-help editing.
  - Checked at 1440×900 and 390×844, with no horizontal overflow.

| Negative path | Test |
|---|---|
| Duplicate weekly run | `negativePaths.test.ts` "duplicate weekly run"; `settlement.test.ts` |
| Duplicate webhook | `negativePaths.test.ts` "duplicate webhook" |
| Out-of-order webhook | `negativePaths.test.ts` (dispute stays lost; subscription update after deletion ignored) |
| Partial refund | `finance.test.ts` "partial then remaining refund…"; points: `billingRewardsCredits.test.ts` |
| Refund after transfer | `negativePaths.test.ts`; `connect.test.ts` allocation partial reversal; browser `REV-ADMIN-B-DEBT-*` |
| Reversal failure | `negativePaths.test.ts`; `connect.test.ts`; browser `REV-ADMIN-B-DEBT-*` |
| Negative partner balance | `negativePaths.test.ts` (carried, never settled; debt needs a reason) |
| Failed payout | `negativePaths.test.ts` (mirrored with reason, shown to partner) |
| Failed Pro renewal | `negativePaths.test.ts`; `billingRewardsCredits.test.ts` |
| Points redeemed before refund | `negativePaths.test.ts`; `billingRewardsCredits.test.ts` |
| Policy material change | `policies.test.ts` (re-accept only after a material version) |
| Expired credit | `negativePaths.test.ts` |
| Insufficient credit | `negativePaths.test.ts` (nothing half-reserved) |
| Incomplete seller verification | `negativePaths.test.ts`; browser `REV-VENDOR-EARNINGS-*` |

### `manage.test.ts` flake — diagnosis

- **Observed once** (Stage 4): 9 of its 10 tests failed together. The only one that passed is the only test that
  makes no HTTP request. The error text wasn't kept, because my filter printed only test names.
- **Ruled out:**
  - Shared module state (e.g. the in-memory, IP-keyed `magicLinkLimiter`): vitest 4 isolates every test file
    (`isolate: true` default, confirmed in its source).
  - A commit race in `/link/request`: the token is written before the response.
  - A database outage: the test server doesn't load `express-async-errors`, so a failing query would *hang* to the
    15 s timeout, but the failures took 1–8 ms.
- **Not reproduced** in 3 normal and 10 file-shuffled full runs before the fix, nor in the soak below.
- **Remaining explanation:** environmental. Requests got fast, unexpected HTTP answers during one run, most likely
  a local Docker/port-forward hiccup.
- **Hardening:** every status assertion in `manage.test.ts` now prints the URL, the actual status and the response
  body (`expectStatus`), so any recurrence identifies itself.
- **Requirement — 20 consecutive clean runs with randomised order:** **20 / 20 consecutive clean full-suite runs** at `1f8cdaf` (740 passed, 23 skipped, 0 failed each), from a frozen worktree with file order shuffled; seeds 153057334, 1892028422, 2649614846, 2061921752, 1810818249, 238411027, 150916117, 2580317822, 2629520853, 1288912768, 81608872, 3001522733, 675029194, 1749713411, 103916557, 419012132, 49173989, 1693419682, 608822214, 15615500. An earlier soak attempt at `f26a569` failed on its first run; that failure was a real cross-file order bug (stub id collision, see "Bugs found"), fixed in `1f8cdaf` before this clean series was started. `manage.test.ts` passed in all 20 runs. Vitest shuffles the *order
  of test files* with a recorded seed. Tests *within* a file aren't shuffled, because many files are deliberately
  sequential (request → confirm, award → refund → redeem). That's the "where supported" limit.

### Unresolved blockers (unchanged by 5c unless noted)

- **B1:** legal entity, registered address and Stripe account country. These block policy publication (all
  placeholders) and any live Connect use.
- **B2:** a Stripe **test** sandbox check of Connect, Billing and both webhook endpoints, which needs the owner's
  go-ahead. The harness's `qa:stripe` key exists locally but was deliberately not used.
- Solicitor sign-off on the 18 policy drafts and on the new consent wording; tax advice on Pro VAT for non-IE or
  B2B partners (reverse charge is configurable per partner, but not decided) and on DAC7.
- **New (B19):** confirm whether the production DB user may hold `REFERENCES`. 5c removed the need, so this is
  informational now.
- Stages 6–8 need an explicit push/deploy instruction.

## Stage 5d — Local Stripe sandbox validation (2026-10-10)

Run with `npm run qa:stripe` against a disposable QA MySQL container only. The test key was read from
`~/.config/hellocircle-qa/stripe-test.json` and never printed, logged or written. No push, no deploy, and no
`hello_circle_dev` / `hello_circle` access. Evidence (secret-scanned: 0 matches) is in
`.qa-data/<run>/evidence/stage5d-<tag>.json`; the primary clean run is tag `qa_stripe_3f975b6211a391a3`.

### 1. Account country and test mode
- Platform `acct_1UJMiOCJ5YFf911E` ("HelloCircle sandbox"): **country IE**, default currency EUR.
- `balance.livemode === false`, checked by the preflight and again by the backend before any Stripe object is created.
  A live key is refused by `stripeTestProfileIssues`.
- Webhook secrets are generated locally for each run (`whsec_qa_<64 hex>` for platform and Connect). No webhook
  endpoint is registered at Stripe: real Stripe events are fetched by id, re-signed locally and POSTed to
  `/api/stripe/webhook`.
- Outbound traffic: the backend socket guard allows only `api.stripe.com:443` plus the QA MySQL port. Browser
  contexts may reach only the local origin and Stripe hosts.
- Every created object carries `metadata.hc_qa_run = qa_stripe_<16 hex>` (`qaRunMetadata()`, active only in the
  QA Stripe profile). This covers checkout sessions and their PaymentIntents, refunds, customers, tax rates,
  subscriptions, dispute evidence updates and account probes. Test clocks have no metadata field, so their *name*
  carries the tag.

### 2. Scenarios
| Flow | Result |
|---|---|
| A — connected accounts | **BLOCKED** (reported as skipped, not passed): this sandbox refuses Accounts v1 creation; the v2 path was proven to work (see 8) |
| B — direct vendor booking | PASS: payment, fee snapshot = charge, actual fee reconciled from Stripe's balance transaction, not released before 48 h, settled; transfer **held** ("No payout account connected"); bank payout event blocked by A |
| C — venue/host split | **NOT IMPLEMENTED**: only the pricing calculation supports a split; there is no split checkout, allocation or transfer path to test |
| D — refunds | PASS before transfer: full, partial, proportional points reversal after settlement, credit restored. Refunds after a transfer, and reversal recovery, are blocked by A |
| E — disputes | PASS: created, earnings frozen, won and released; a delayed dispute after settlement, lost, points reversed proportionally, partner debt left fully unrecovered (no transfer to reverse), partner frozen; duplicate webhook is a no-op. Transfer reversal is blocked by A |
| F — Pro | PASS: €29 net + 23% IE VAT = €35.67; exempt partner → €29.00; renewal via test clock; failed renewal → past_due with a 7-day grace → sweep cancels; cancel at period end; free month for 10k points; points debt blocks redemption |
| G — webhooks | PASS: valid, invalid and missing signatures; duplicate; out of order (`charge.refunded` before payment → `manual_review` → admin replay → processed); delayed redelivery; unknown type stored as ignored; no duplicate ledger groups |
| H — weekly settlement | PASS: preview settles nothing, execute, rerun of the same key → 409, two bookings combined, items = settlement net, €10 booking carried below €25, frozen partner excluded. Failed transfer and "verification becomes incomplete" are blocked by A |

The 33 pre-existing Stripe specs (checkout amounts, payments for all five models, declines, refunds, external
refunds, concurrency, browser checkout) also passed with the run tag in place.

### 3. Stripe objects created (primary run; all tagged and in test mode)
- Payments: `pi_3UOyB6CJ5YFf911E1x7aIRSL`, `pi_3UOyBICJ5YFf911E0Ztlj0Zx` (B), `pi_3UOyDFCJ5YFf911E0mqxLcTq`,
  `pi_3UOyDaCJ5YFf911E0ssCh6Yc` (E), `pi_3UOyFQCJ5YFf911E0V8L4HrU` (G), plus each pre-existing spec's checkout sessions.
- Refunds: `re_3UOyC1CJ5YFf911E1goQvLdJ` (full), `re_3UOyCICJ5YFf911E0FhUFq6g` (partial), `re_3UOyFQCJ5YFf911E0eI7s7nL` (G).
- Disputes: `du_1UOyDHCJ5YFf911Eczm3cfjH` (won), `du_1UOyDcCJ5YFf911EOsycNwIa` (lost).
- Billing: tax rate `txr_1UOwhlCJ5YFf911Ec1LSYDOR` (reused across runs); subscriptions `sub_1UOyE6CJ5YFf911EOnplLm9W`,
  `sub_1UOyEGCJ5YFf911EuaOEtguG`, `sub_1UOyEgCJ5YFf911E9K0b2emg`; test clocks `clock_1UOyEFCJ5YFf911EK0mISf1W`,
  `clock_1UOyEfCJ5YFf911EeAKHdWtR` (deleted on cleanup); customer `cus_VPnqXWsyjNDLwV`.
- Accounts v2 probes: `acct_1UOwLnCJ5YrB9U72`, `acct_1UOwVXCJ5YeStQA6`, `acct_1UOyAkCJ5YKgbg5Q` (recipient, Express,
  IE, transfers `restricted` until onboarding). One probe per Connect run; they're inert and tagged. **Not deleted**,
  per "do not delete objects"; delete them in the Dashboard if wanted.
- Nothing pre-existing was read beyond the account itself, and nothing pre-existing was modified or deleted.
  Cleanup touched only this run's own subscriptions and test clocks.

### 4. Expected vs actual (cents)
| Item | Expected | Stripe / actual |
|---|---|---|
| B booking 1: charge / partner share / VAT / customer fee | 5120 / 4000 / 920 / 200 | 5120 / 4000 / 920 / 200 |
| B booking 2 | 3200 / 2500 / 575 / 125 | 3200 / 2500 / 575 / 125 |
| B card fee: estimate → Stripe actual | 102 / 73 | 229 / 155 (variance 127 / 82 recorded; the test card is non-EEA, so international pricing applies) |
| H settlement net (2 bookings) | 6500 | 6500, 2 items |
| H points awarded | ⌊5120/100⌋ + ⌊3200/100⌋ = 83 | 83 |
| H €10 booking carried | 1000 | 1000 carried, not settled |
| D full refund / partial refund | 3840 / 1234 | 3840 / 1234 |
| D points reversed after €10 refund of a 51-point order | 9 | 9 |
| D credit used → restored | 700 → 700 | 700 → 700 |
| E dispute won | 4308 | 4308, released after win |
| E dispute lost: disputed amount (Stripe disputes 5538 of the 5760 charge) | 5538 | 5538 |
| E points reversed: ⌊57 × 5538 / 5760⌋ | 54 | 54 |
| E dispute fee | 2460 | 2460 (ledger), kept after a win as at Stripe |
| E partner debt | 5538 unrecovered | 5538 unrecovered, recovered 0 |
| F Pro net / VAT / gross | 2900 / 667 / 3567 | 2900 / 667 / 3567 (4 invoices) |
| F exempt partner | 2900 / 0 / 2900 | 2900 / 0 / 2900 |
| F failed renewal grace | 7 days | 7 days |

### 5. Webhook results
Valid signature → 200; invalid → 400; missing → 400 (nothing stored); Connect secret → 200; unknown type →
stored `ignored`; duplicate → `duplicate: true` with no side effects. An out-of-order `charge.refunded` parks as
`manual_review` (acknowledged with 200 so Stripe stops retrying); after the payment confirms, admin replay
re-fetches the event from Stripe → `processed`, 2 attempts, refund recorded once. Further replays and
redeliveries change nothing. A delayed `checkout.session.completed` redelivery and duplicate dispute events
are no-ops, and the ledger has no duplicate groups.

### 6. Reconciliation
`SANDBOX-RECONCILE` (new) compares every Stage 5d-tagged payment in the QA database with Stripe, cent for cent:
charge, total refunded, refund ids, actual card fee, dispute status, amount and fee, and Pro invoice cash and
VAT against the ledger.
- Latest run: **41 payments and 8 invoices, 0 unexplained mismatches.**
- One known exception is reported, not hidden: HC-QA-091-PARTIAL makes a €1 refund directly at Stripe and
  deliberately withholds its webhook, to prove the app refuses to guess. That refund is now labelled at Stripe
  (`hc_qa_purpose: webhook-withheld`) and listed under `flaggedExceptions`.
- The clean run before that fix shows the same item as a mismatch, because its refund predates the label.
- Every ledger transaction balances (`ledgerBalanced` after each flow).
- Reruns: the same flows were run repeatedly on a database that already held earlier runs' data, and the
  assertions are delta-based. Rerunning a settlement key → 409. Webhooks are duplicate-safe.

### 7. Bugs fixed
1. **Stripe-side refunds recorded without their Stripe id.** `charge.refunded` now lists the charge's refunds and
   records each new one under its own `re_…` id; if amounts don't match exactly, it falls back to the old
   amount-based row. HelloCircle refunds that reconcile against an already-refunded charge now also keep Stripe's
   refund id (`issueStripeRefund` → `chargeRefunds`).
2. **Dispute fee missing from the ledger.** Stripe's dispute fee (€24.60 here) is now posted once per dispute to
   `dispute_fee_expense`. It's kept when the dispute is won, matching Stripe. New ledger account; new unit test.
3. **Onboarding refusal surfaced as a bare 500.** It's now a 502 with Stripe's error class and a clear message.
4. **Run tag and connected-account type.** The run tag is added to every Stripe object in the QA profile, and
   PaymentIntents now carry the checkout metadata, so disputes trace back to their booking. Onboarding passes
   `business_type` (company or individual) from the trader profile. A `payouts=refresh` return now mints a new
   onboarding link instead of a dead end.
5. Test-side: grace window compared in UTC; dispute points expectation made proportional to the disputed amount;
   settlement and carry assertions made rerun-safe; pre-existing specs expect the run tag.

### 8. Blockers
- **B1 — Accounts v1 disabled for this platform.** `accounts.create` is refused, and Stripe requires Accounts v2
  for new Connect platforms. This blocks A, and every transfer, payout, transfer-reversal, failed-transfer and
  verification-incomplete path in B, D, E and H. Proven alternative: a v2 recipient account (identity IE,
  Express dashboard, fees and losses collected by the application, `stripe_balance.stripe_transfers` requested)
  plus a v2 hosted onboarding link that accepts our local return and refresh URLs.
  **Owner decision:** migrate `createConnectedAccount` and account links to v2 (recommended), or enable
  "Accounts v1 support" in the sandbox Dashboard.
- **Flow C** (venue/host split) is not implemented.
- **Final end-to-end rerun interrupted.** The last consolidated rerun (with the reconciliation label fix) was cut
  off because the Mac was on battery and kept entering maintenance sleep. Each flow has passed on a clean
  database (run `qa_stripe_3f975b6211a391a3`), and the reconciliation fix passed on its own. Repeat
  `npm run qa:db:reset && npm run qa:db:seed && npm run qa:stripe && npm run qa:revenue` on mains power before
  relying on a single all-green run.

### 9. Files and migrations
- Server: `payments/provider.ts`, `payments/connect.ts`, `commerce/payments.ts`, `checkoutService.ts`,
  `routes/stripeWebhook.ts`, `db/index.ts`, `commerce/finance.test.ts`; client: `PayoutAccountCard.tsx`.
- Harness: `run.ts` (sandbox batches, per-run Connect secret and run tag), `backend.ts` (secret and tag validation),
  `stripe-sandbox-preflight.ts`, `stripe-sandbox-fixture.ts`, specs `stripe-sandbox-{connect,money,disputes,billing,webhooks,reconcile}.spec.ts`;
  pre-existing `stripe-{checkout,payment,refund-external}.spec.ts` updated for the run tag.
- Migration (additive, idempotent, in `initSchema()`): ledger account `dispute_fee_expense` (expense). No other schema change.
- Tests: server 741 passed / 23 skipped; client 110 passed; build clean; harness type-check clean.

### 10. Confirmation
No live Stripe call (live keys refused; `livemode:false` checked before any object), no push, no deployment,
no access to `hello_circle_dev` or `hello_circle`, no production feature flags. Every run used only the
disposable QA container; feature switches were set and restored inside it. No secret value appears in code,
logs, evidence or this document. Not proceeding to staging.

## Stage 5e — Stripe Accounts v2, connected-account validation, venue/host split (2026-10-10)

**Status: Stage 5e automated verification passed in one uninterrupted combined run.
Manual Express onboarding remains pending before staging sign-off.**

The gate ran this exact command on AC power, from a clean disposable database:

```
caffeinate -i sh -c 'npm run qa:db:reset && npm run qa:db:seed && npm run qa:stripe && npm run qa:revenue'
```

It ran on commit `5aeaf66`, from 18:01:37 to 18:25:14 UTC (no sleep in the window), against database
`hello_circle_e2e_qa_2219ab4d0834b4c9`. Run tag: `qa_stripe_303abb022622920f`.

Result: **23 of 23 batches passed, 73 tests passed, 0 failed, 0 skipped, exit 0.**

Three earlier gate attempts failed and are **not** counted. Each failure was fixed and committed, and the whole sequence
was restarted from `qa:db:reset`:

| Attempt | Failure | Fix |
|---|---|---|
| 1 | Waiting for Stripe's hosted page load | `1257e0a` |
| 2 | Cross-suite balance in the split spec | `0c15936` |
| 3 | Transfer-reversal idempotency key collision, a real bug; then two revenue specs assuming zero balances | `0c15936`, `5aeaf66` |

### 1. Commits (local only, `feature/commerce-engine`)

| Commit | Content |
|---|---|
| `0daef8f` | Accounts v2 connected accounts, normalized Connect events, v2 thin-event endpoint, venue/host split engine |
| `0aefc37` | Payout-account states UI, split UI, harness (Stripe CLI secret), sandbox Connect/split/delivery specs |
| `143ac26` | ADR `adr-accounts-v2.md`, runbook `connect-operations.md`, plan and rollback docs |
| `6771d4f` | Split-booking reward points per partner; VAT liability recorded (provisional) |
| `a3f2b33` | Split gated by `commerce.venue_host_split_payout` (default off) |
| `1257e0a` | Hosted-onboarding navigation wait (test) |
| `0c15936` | **Fix:** globally unique transfer/reversal idempotency keys; robust split assertions |
| `5aeaf66` | Revenue browser specs independent of balances left by `qa:stripe` |
| *(this commit)* | Stage 5e report |

### 2. Files and migrations

43 files changed, +3128 / −249.

- **Server:**
  - new: `commerce/allocations.ts`, `routes/venueSplits.ts`, `payments/connectV2.test.ts`, `commerce/split.test.ts`;
  - changed: `payments/provider.ts`, `payments/connect.ts`, `commerce/payments.ts`, `commerce/settlement.ts`,
    `commerce/rewards.ts`, `commerce/catalog.ts`, `db/index.ts`, `routes/stripeWebhook.ts`, `routes/adminFinance.ts`,
    `routes/payouts.ts`, `stripe.ts`, `index.ts`.
- **Client:**
  - new: `components/VenueSplitsCard.tsx`;
  - changed: `PayoutAccountCard.tsx`, `EarningsSummary.tsx`, `api/vendor.ts`, `api/resident.ts`.
- **Harness:**
  - new: `stripe-sandbox-split.spec.ts`, `stripe-sandbox-delivery.spec.ts`, `revenue-split.spec.ts`;
  - changed: `run.ts`, `backend.ts`, `runtime.ts`, the fixtures, `integration-safety.ts`, and the connect, billing,
    reconcile, revenue-partner and revenue-admin-b specs.

Migrations are all additive and idempotent, inside `initSchema()`, with no down path:
- **`connected_accounts` columns:** `api_model` (default `'v1'`, so existing rows stay readable), `configuration_type`,
  `dashboard_type`, `business_type`, `onboarding_state`, `charges_capability`, `payouts_capability`,
  `requirements_past_due`, `requirements_pending`, `onboarding_completed_at`, `last_synced_at`, `last_event_id`,
  `last_event_created_at`, `creation_key` (unique).
- **New tables:** `connected_account_creations`, `connected_account_syncs`, `venue_split_agreements`,
  `allocation_snapshots` (+ `vat_liability_owner`, `vat_treatment_status`, `vat_rule_hash`), `allocation_lines`,
  `order_party_releases`, `dispute_recovery_allocations`, `reward_split_awards`, `reward_split_reversals`.
- **New versioned rules (v1 seeded):** `venue_split` (rounding owner = venue, max venue share 90%), `split_rewards`
  (basis = eligible allocation, rounding = floor total + largest remainder, timing = after settlement), `vat_treatment`
  (owner = HelloCircle, **status = provisional pending Irish tax review**).
- **New editable help entries (v1):** `connect_state_*` ×7, `connect_transfer_vs_payout`, `venue_split`.
- **Switch:** `commerce.venue_host_split_payout` is now functional, default **off**.

### 3. Accounts v2 architecture

All new connected accounts are created with Accounts v2 `POST /v2/core/accounts`:
- `dashboard: express`;
- `defaults.responsibilities.fees_collector` and `losses_collector` both `application` (HelloCircle prices and bears
  negative balances);
- `configuration.recipient` requesting **only** `stripe_balance.stripe_transfers`. There is no merchant configuration;
  HelloCircle stays the merchant with separate charges and transfers;
- `identity.country = ie`, entity type company or individual from the trader profile.

Stripe reports `requirements_collector: stripe`, verified in the sandbox. Onboarding and update links use v2 Account
Links. Creation is idempotent: a per-partner reservation row carries a Stripe idempotency key with a random part fixed
at reservation, so retries, timeouts after acceptance and concurrent requests resolve to one account. State is always
re-fetched from Stripe, and `last_synced_at` stops an older fetch overwriting a newer one. Every sync is logged.

Seven partner states: `not_started`, `onboarding_incomplete`, `under_review`, `more_information_required`,
`transfers_unavailable`, `payouts_unavailable`, `enabled`. Transfers and bank payouts are kept apart in data, API and UI.

Webhooks: v1 snapshot and v2 thin events map to normalized internal events (`connect.account.changed`,
`connect.onboarding.returned`, `connect.bank_payout.changed`, `connect.transfer.reversed_externally`). The v2 endpoint
`/api/stripe/webhook/v2` verifies, stores once, and re-fetches the event and the account. Admin replay works for v2
events. Bank-payout mirrors never move backwards. Full decision record: `adr-accounts-v2.md`.

### 4. `CONNECT_V1_COMPAT` inventory

These endpoints are listed in `server/src/payments/provider.ts`, each with a reason, a docs link and its detecting test:

| v1 endpoint (called with the v2 account id) | Why | Used by |
|---|---|---|
| `POST /v1/transfers` | No v2 transfers API; Stripe accepts a v2 recipient as destination | App |
| `POST /v1/transfers/:id/reversals` | No v2 reversal API | App |
| `POST /v1/accounts/:id/login_links` | No v2 login-link API | App |
| `GET /v1/payouts` (Stripe-Account) | Payouts are v1 objects on the connected account | Reconciliation, tests |
| `POST /v1/accounts/:id` `settings.payouts` | v2 has no payout settings | QA harness only |
| `POST /v1/accounts/:id/external_accounts` | No v2 bank-account API in stripe-node 22.x | QA harness only |

### 5. Stripe test objects and run tags

All objects are test mode on platform `acct_1UJMiOCJ5YFf911E` (IE, EUR). Each carries `hc_qa_run` (or, for test clocks,
the tag in the name).

| Object type | Gate run IDs |
|---|---|
| Express accounts (app) | `acct_1UP4jLCJ5YK61jbs` (company vendor), `acct_1UP4jUCJ5YoGURyw` (individual host) |
| Verified v2 test doubles (`dashboard: none`) | `acct_1UP4pRCJ5YcRwG9H` (venue, company), `acct_1UP4pnCJ5YIuxFdo` (host), `acct_1UP4tSCJ5Yai1ucU` (delivery) |
| Split payments | `pi_3UP4qbCJ5YFf911E1gpatPGw`, `pi_3UP4r5CJ5YFf911E1v0DHsjV`, `pi_3UP4rgCJ5YFf911E0V29vSwH`, `pi_3UP4sHCJ5YFf911E1FnCvNO6` |
| Transfers | `tr_1UP4rBCJ5YFf911EJGpyNx17`, `tr_1UP4rmCJ5YFf911EXWVtuYsu`, `tr_1UP4rnCJ5YFf911E4WmDVecS`, `tr_1UP4sPCJ5YFf911ESleEry21` |
| Reversals | `trr_1UP4rFCJ5YFf911Ec7sMceuQ` (667), `trr_1UP4rqCJ5YFf911EWa63FKRQ` (2667), `trr_1UP4rrCJ5YFf911ERVJt0sLf` (333), `trr_1UP4sYCJ5YFf911Eg2kHurxv` (2667), `trr_1UP4sZCJ5YFf911Ef3xhbxFn` (615) |
| Dispute | `du_1UP4sKCJ5YFf911EgTSsV2tJ` |
| Bank payouts | `po_1UP4saCJ5YcRwG9HE3gZDEX0` (paid), `po_1UP4scCJ5YIuxFdo5fcgwgkd` (failed), `po_1UP4tmCJ5Yai1ucUZ27HiYVQ` (paid) |
| Pro | `sub_1UP4nXCJ5YFf911EIXf8FNM9`, test clocks `clock_1UP4nkCJ5YFf911EaEhdnZCL`, `clock_1UP4oICJ5YFf911EJeBzZXsy` (deleted after use) |

Earlier development runs and probes created further tagged test objects (listed in §11); none were attached to real users.

### 6. Scenario outcomes

| Flow | Result |
|---|---|
| **A — Accounts v2** | Company and individual created through the app. Retry → same account; 3 concurrent → 1 account. Real requirements (41 past due) → `onboarding_incomplete`. Real v2 event delivered (valid, duplicate, invalid → 400). Hosted refresh mints a new link; return re-syncs. "Completed onboarding" proven with verified v2 doubles (`enabled`). Requirements later due, restricted and verification failure are unit-tested only (§11). |
| **B — single-partner booking** | Payment, fee snapshot = charge, actual fee reconciled, 48-hour hold, settlement, transfer held without an account (5d). With an account: transfer, then a Stripe bank payout (paid / failed) on the split doubles. |
| **C — venue/host split** | Snapshot frozen and equal to the Stripe charge. Two connected accounts. Independent eligibility (venue transferred, host held for trader details). Aggregated weekly transfers with per-booking allocations. Partial reversals. |
| **D — refunds** | Before transfer, full and partial (5d). After only the venue was transferred: ¼ refund recovered 667 from the venue's own B1 allocation; the host's 333 had no transfer to reverse, stayed open and frozen, then was offset by its own next earnings. After both were transferred: full refund recovered 2667 (venue) and 333 (host), each from its own B2 allocation. Coupon funded by HelloCircle or the partner (unit). Credits restored (5d). |
| **E — disputes** | Opened, frozen, won and released; lost after settlement (5d). Split B4 lost after settlement: venue 3282 and host 1641 of 4923 disputed; Stripe's actual fee 2460 posted; venue debt recovered by reversals 2667 + 615. Lost before settlement (unit). |
| **F — Pro** | IE VAT €29 + €6.67 = €35.67; exempt €29.00; **reverse charge €29.00, VAT 0**; renewal; failed renewal and 7-day grace; cancel at period end; free month for 10k points; points debt blocks redemption. |
| **G — webhooks** | Valid / invalid / missing signature; duplicate; out of order (manual review → replay → processed); delayed; unknown; **real Stripe deliveries** (§8). |
| **H — settlement** | Preview = execution; duplicate run key → 409; below-€25 carry (host 1000); frozen partner excluded (host `Earnings frozen`); one eligible and one ineligible split partner; failed bank payout leaves the transfer unchanged. |

### 7. Split and points calculations (exact cents)

**Booking split:** €40 game at 66.67% venue, rounding owner = venue. Charge 5120 = HelloCircle 200 + venue 2667 + host
1333 + VAT 920 + deposit 0. Venue ⌊4000 × 6667 / 10000⌋ = 2666, host ⌊4000 × 3333 / 10000⌋ = 1333, remainder 1 →
venue. Identical for all four bookings, and equal to Stripe's charge.

**Refunds and disputes:**
- **¼ refund (1280):** venue 667, host 333, fee 50, VAT 230 (largest remainder).
- **Dispute 4923 of 5120:** recovery split by allocation, 4923 × 2667 / 4000 = 3282.35 → **3282** and
  4923 × 1333 / 4000 = 1640.6 → **1641** (the remainder cent goes to the larger fraction).

**Points** (rate 1 per €1; rule `split_rewards` v1):
- **B1 / B2 at settlement:** ⌊(2667 + 1333) / 100⌋ = 40 → venue **27**, host **13**. No whole-booking award.
- **B1 after the ¼ refund:** eligible 2000 / 1000 → 30 → targets 20 / 10 → reversed **7** (venue), **3** (host).
- **B2 after the full refund:** eligible 0 / 0 → reversed **27** and **13**.
- **B4 lost dispute:**
  - disputed shares by allocation of 2667 / 1333 / 1120 → 2564 / 1282 / 1077;
  - eligible 103 / 51 → ⌊154 / 100⌋ = 1 → venue keeps 1, reversed **26**;
  - the host's B4 share was carried, so no host award existed yet.
- **Coupon funded by HelloCircle (unit):** €10 off → eligible 2000 / 1000 → 20 / 10.
- **Browser journey:** €70 at 60% → 42 / 28.

**VAT:** every snapshot records `vat_liability_owner = helloCircle`, `vat_treatment_status =
provisional_pending_irish_tax_review`. No VAT calculation was changed.

### 8. Real webhook delivery vs fixture tests

**Real Stripe-generated deliveries** via `stripe listen` (test-mode CLI session; two listeners, because the CLI won't
send snapshot and thin events to the same URL; nothing hand-signed):

| Event | Stripe event ID | Result |
|---|---|---|
| `checkout.session.completed` | `evt_1UP4t4CJ5YFf911EDcoomDt1` | Booking confirmed |
| `charge.refunded` | `evt_3UP4t3CJ5YFf911E0O8jl5p2` | Refund recorded once |
| `charge.dispute.created` | `evt_1UP4tPCJ5YFf911E0gP4VQ4R` | — |
| v2 `v2.core.account[identity].updated` | — | `processed`; account re-synced |
| v2 events for an account not yet linked | — | `ignored` |
| `transfer.created` | `evt_1UP4tfCJ5YFf911EwVvPK5Ns` | — |
| `transfer.reversed` (made outside HelloCircle) | `evt_1UP4tiCJ5YFf911EoLjHIJNT` | `manual_review` |
| `payout.created`, `payout.paid` | — | `processed` |

No event was processed twice.

**Re-signed real events:** real Stripe event IDs and objects, signed locally with the run's CLI test secret, for ordering
control. Used in the disputes, billing, split payout and v2 Connect tests.

**Fixture events:** synthetic, signed locally, for deterministic negative and ordering tests: invalid, missing and
tampered signatures, unknown types, out-of-order refunds, and duplicate replays.

### 9. Reconciliation (`SANDBOX-RECONCILE`, same run)

- **Payments:** 38 checked; **38 of 38 run-tagged Stripe payments represented locally**. Charge, refunds (by id), actual
  card fee and disputes match to the cent. **0 mismatches.**
- **Pro invoices:** 4 match ledger cash 3567 and VAT 667.
- **Transfers:** 4, each with Stripe amount = local = settlement = Σ allocations, and Stripe `amount_reversed` = local
  reversals:

  | Transfer | Amount | Reversed |
  |---|---|---|
  | `tr_…ryNx17` | 6334 | 3334 |
  | `tr_…uYsu` | 2666 | 333 |
  | `tr_…VecS` | 2667 | 615 |
  | `tr_…ry21` | 2667 | 2667 |

- **Debts:** each spec closes its debts; debt recovery equals reversals in-spec.
- **Ledger:** every group balances.
- **Connected accounts:** every run-tagged account is explained: 2 app-created Express accounts and 3 labelled test
  doubles.
- **Intentional exception, listed:** `HB-372830` is a €1 refund made directly at Stripe by HC-QA-091-PARTIAL, whose
  webhook is withheld on purpose (labelled `webhook-withheld` at Stripe).

### 10. Test, build, browser and combined-run results

| Suite | Result |
|---|---|
| Combined gate | 23 batches / 73 tests passed, 0 failed, 0 skipped, uninterrupted |
| `qa:stripe` | 9 sandbox specs + 33 Stripe integration specs |
| `qa:revenue` | 30 browser journeys |
| Browser journeys in the gate | 32 at desktop and mobile viewports: Stripe UI, revenue partner/admin/resident, split |
| Server suite | 72 files, **760 passed**, 23 skipped |
| Client suite | **110 passed** |
| QA harness check | **97 passed**, type-check clean |
| Production build | Clean |

### 11. Limitations and outstanding manual checks

- **Manual Express onboarding is pending.** Stripe's hosted onboarding shows an **hCaptcha challenge** in test mode, so
  automation can't complete it. Before staging sign-off, **a person must complete one company or individual Express
  onboarding** through the app's "Set up payouts with Stripe" link, and record the account id, final state and a
  screenshot here. Money-movement tests used labelled `dashboard: none` v2 test doubles, which differ only in dashboard
  type and requirement collection.
- **Some Stripe test triggers had no effect.** `address_no_match`, DOB `1900-01-01` and `https://inactivity.stripe.com`
  didn't change a v2 recipient account's capability status in this sandbox. "Requirements later due", "restricted" and
  "verification failure" states are covered by unit tests only.
- **Expired-link timing isn't tested.** Links expire after about 5 minutes; the refresh path (mint a new link) is tested,
  not the wall-clock expiry.
- **Credits on split bookings:** games don't accept customer credits; credit restoration is validated on experiences
  (5d).
- **Tax review needed.** VAT treatment is **provisional pending Irish tax review** (rule `vat_treatment`). Reverse charge
  and exempt are configured per partner but need tax advice before use.
- **Points rule differs by booking type.** Split bookings follow the owner's per-partner decision; single-partner
  bookings keep the 5b GMV-based points rule.
- **Earlier probe objects are inert and tagged.** They are kept, not deleted: probe and test-double accounts from
  development runs (e.g. `acct_1UOwLnCJ5YrB9U72`, `acct_1UP22eCJ5Ym58ZTv`, `acct_1UP254CJ5YUyvpCK`,
  `acct_1UP275CJ5YQtOn0n`, `acct_1UP2VACJ5YKdDOw2`).

### 12. Safety confirmation

- **Stripe:** test mode only. `livemode: false` and the IE platform `acct_1UJMiOCJ5YFf911E` were confirmed before
  creating objects. No live key and no live-mode request.
- **Webhook secrets:** a per-run local secret, or the Stripe CLI's test-mode secret held in memory. No webhook endpoint
  was registered at Stripe, and "Accounts v1 support" was not enabled in the Dashboard.
- **Repository:** no push, no deployment, no staging.
- **Databases:** only disposable QA containers. `hello_circle_dev` and `hello_circle` were never accessed.
- **Switches and policies:** every feature switch stays off by default, and no policies were published.
- **Secrets:** no key or webhook secret appears in code, fixtures, evidence, logs or this report (evidence files scanned:
  0 matches).
- **Stripe data:** no other Stripe test data was modified or deleted. Only this run's test clocks and subscriptions were
  cleaned up.

## Stage 5f — Partner subscription, rewards and customer-credit UX (2026-10-11)

**Status: built and verified locally against the fake provider. Not pushed, not deployed; every feature switch stays
off by default.** Specification: [08 — audit](08-subscription-rewards-ui-audit.md), [09 — UX](09-subscription-rewards-ux.md).

### 1. Commits (local only, `feature/commerce-engine`)

| Commit | Content |
|---|---|
| `76574f0`, `32d8068` | 1 — Audit (22 findings) and UX specification (docs 08, 09) |
| `b814b16` | 2 — Partner dashboard and Pro flows: shared "Plan & rewards" panel, Pro details page, rewards history page |
| `3b4c1ff` | 3 — Rewards, credit and coupon flows: credit wallet, ordered checkout breakdown, coupon reasons, proportional credit restoration |
| `e35e8dd` | 4 — Admin and help experience: sectioned commercial rules, switch dependencies, Finance tabs, credit-grant form |
| *(this commit)* | 5 — Tests and rollout evidence |

### 2. Existing behaviour reused

- Pro checkout, cancel/resume, grace sweep and invoices on Stripe Billing (5b); the stub and Stripe providers.
- Reward lots, awards, FIFO redemption and points debt (5b); split points per partner (5e).
- Credit lots and the reserved → confirmed → released/reversed lifecycle (5b); engine-priced experience checkout.
- Versioned commercial rules with drafts, review, publish, effective dates, impact preview and audit (Stage 3).
- Versioned field help (Stage 3), the `Drawer`, `ConfirmDialog` and consent-aware analytics.

### 3. Existing behaviour corrected

| Finding (doc 08) | Correction |
|---|---|
| F1 — two paid subscriptions possible | An open checkout is reused (one session per click storm); a second completed checkout is cancelled at Stripe on arrival and marked `duplicate` (audited) |
| Expired/abandoned checkouts blocked a retry | Stale sessions are expired at Stripe and replaced |
| Paid Pro during a reward month double-counted | Checkout uses `trial_end` = reward end; billing starts after the reward month (D3) |
| Grace period hard-coded (7 days) | Rule `subscription_policy.graceDays`; frozen on the subscription when the payment fails |
| Finance staff could change the plan | Owner-only for every plan action, server-enforced (403); finance staff view only (D2) |
| Split reversals used today's rate | Reversal uses the rate frozen on the award |
| Same-second history entries skipped across pages | `(before, beforeId)` cursor |
| Coupon errors were generic | Every rejection carries a reason (`invalid`, `expired`, `limit`, `min_spend`, `not_applicable`, …) |
| Partial refunds never returned credit | Credit restored in proportion to the refunded share, incrementally and idempotently (D1) |
| Credit grants could double on a re-submit | Per-dialog idempotency key, unique in the database; capped by `credits.maxGrantMinor` |
| Switches could be turned on without prerequisites | `SWITCH_DEPENDENCIES`, refused with 409 `switch_dependency`, prerequisite named |
| A rule field added later broke older published versions | Missing fields take the catalog v1 default before validation |
| "Circle credits" label confused with customer credit | Shown as "Partner reward points" (internal key `commerce.circle_credits` kept) |
| "Pro ends on " with no date before Stripe sends the period end | Copy falls back to "the end of this billing period" (found by the browser tests) |
| Credit expiry chosen as 31 March showed "1 April, 00:59" (UTC end of day, seen in Irish summer time) | A date-only expiry is the end of that day in Ireland (`endOfIrelandDay`), server-side (found in the screenshot review) |

### 4. New UI

- **Plan & rewards panel** (vendor overview, Host Manage overview, full on Earnings): states free, processing,
  paid active, reward month, Pro granted, cancelling, payment failed, unavailable; points available, pending, this
  month, progress, debt and redemption state.
- **Pro details page** (`/vendor/pro`, `/manage/pro`): 12 sections, exact price with the partner's tax row (standard,
  exempt, reverse charge), terms checkbox, "Continue to Stripe", test-card hint only in test mode, cancel with "Keep Pro".
- **Rewards history** (`/vendor/rewards`, `/manage/rewards`): every kind (earned, venue/host share, refund and dispute
  reversal, debt repayment, redemption, adjustment), paginated.
- **Customer credit**: wallet on `/profile` (balance, reserved, next expiry, history); experience checkout with coupon
  apply/remove and the ordered breakdown "price + taxes/fees − coupon − credit = card payment due".
- **Admin**: Commercial rules in sections; "Needs: …" under dependent switches; Finance tabs Reward points (history,
  audited idempotent adjustments), Coupons (usage), Bank payouts; credit grant with currency, type, funding owner,
  optional expiry, idempotency and confirmation; outstanding credit summary.
- **Help**: 19 editable entries (inline line, "Learn more" drawer, policy link).

### 5. Remaining policy and tax decisions (provisional defaults in place)

D1 proportional credit restoration · D2 finance staff view-only · D3 reward month then paid billing ·
D4 admin roles unchanged · D5 VAT provisional pending Irish tax review (exempt and reverse charge need tax advice
before use). Pro terms, cancellation and refund wording are help entries, not published policies — legal review is
still needed before publishing.

### 6. Automated tests

| Suite | Result |
|---|---|
| Server unit (`npm run test --workspace server`, isolated container) | 774 passed, 23 skipped (includes 14 new in `stage5f.test.ts`) |
| Client unit | 110 passed |
| Harness checks (`qa:check`) | 97 passed |
| Build (server + client) | clean |
| Combined browser gate, fake provider: `qa:db:reset && qa:db:seed && qa:revenue && qa:booking` | **22 of 22 batches passed, 76 tests passed, 0 failed, exit 0** (2 by-design skips: the REM-046 batches each run one of a pair), 2026-10-10 19:48–19:53 UTC, AC power, database `hello_circle_e2e_qa_bf116a75118810bc`, on the final code |

New browser specs: `revenue-plan` (Pro journey + admin), `revenue-rewards`, `revenue-credit`; each at desktop and mobile.
Older specs updated for deliberate 5f UI changes (no direct "Upgrade to Pro" button; ordered checkout breakdown;
points shown in the new panel): `revenue-partner`, `revenue-resident`, `revenue-split`, `booking-findings-b` (HC-QA-042
now reads the total next to the booking button). Earlier gate attempts failed only on those outdated assertions, the
missing-date bug in §3, and two test-data assumptions (QA_HOST's existing split history); each was fixed and the
whole gate restarted from `qa:db:reset`. The credit-expiry fix in §3 came from reviewing the screenshots after a passing
gate, so the gate was run again on the final code. `qa:stripe` was not run in this stage (no Stripe changes beyond the stub's
hosted URL and the provider methods unit-tested here).

See the UI-state matrix in [09](09-subscription-rewards-ux.md#ui-state-test-matrix-desktop--mobile-fake-provider-stripe-test-mode-only-in-qastripe).
Browser screenshots for every main state, desktop and mobile: [evidence/stage5f](evidence/stage5f/README.md)
(32 downscaled captures from the final gate; QA personas only).

### 7. Manual checks still to do (in Stripe test mode, not done here)

- Real Stripe Checkout for Pro end to end (`qa:stripe` covers 5b Pro; the 5f reuse/duplicate/trial-end paths are
  verified against the fake provider only).
- Stripe billing portal configuration as seen by a partner (cancel and payment-method update).
- Screen-reader pass (VoiceOver) on the panel, Pro page and checkout breakdown; automated checks cover roles,
  labels, `aria-live` and keyboard activation only.
- Manual Express onboarding (carried over from 5e).

### 8. Safety confirmation

No push, no deployment, no staging. Fake provider only; no Stripe key used in this stage. Only disposable QA
databases; `hello_circle_dev` and `hello_circle` were never accessed. Every feature switch stays off by default; no
policies were published. No secret appears in code, fixtures, evidence or this report.
