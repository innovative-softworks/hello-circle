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
