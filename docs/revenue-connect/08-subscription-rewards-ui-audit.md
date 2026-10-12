# Stage 5f audit — partner subscription, rewards and customer-credit UX

Audit only (Phase 1). No implementation changes were made. Baseline: `feature/commerce-engine` at `e5494db` (Stage 5e
complete).

Severity scale:
- **Critical:** money or entitlement can go wrong.
- **High:** a required state or flow is missing, or a rule is wrong.
- **Medium:** UX or configurability gap.
- **Low:** polish.

## Current implementation (what exists)

| Area | Server | Client |
|---|---|---|
| Plan and Pro | `commerce/subscriptions.ts` (checkout, webhooks, cancel/resume, sweep, overview), `commerce/plans.ts` (plan assignments, reward-funded Pro via `assignPlan` source `promotion`), `routes/partnerPlan.ts` (`/api/{vendor,host}/plan`) | `components/PlanCard.tsx`, shown **only** on the Earnings tab (`EarningsSummary.tsx`) |
| Rewards | `commerce/rewards.ts` (awards at settlement, split awards, reversals, points debt, redeem) | Balance line and a redeem button inside `PlanCard` |
| Customer credit | `commerce/credits.ts` (grant, reserve, sync, balance), `GET /api/credits/me` (lots only) | A checkbox in `pages/ExperienceDetail.tsx` only |
| Coupons | Engine and legacy coupons; experience quote accepts `couponCode` | Coupon field in `BookingFlow`, `RegistrationFlow`, `GameJoinCard`. **None in experience checkout** |
| Admin | `routes/adminCommerce.ts` (rules, versions, impact preview, switches with reason and audit), `routes/adminFinance.ts` (credits, subscriptions, settlements and more) | `AdminCommerce.tsx` (Rules, Switches, Audit, Shadow, Orders), `AdminFinance.tsx` ("Credits & Pro" tab and others) |
| Help | `help_entries` (25 keys, versioned, editable under the `legal` admin role) | `FieldHelp.tsx` (inline "?" popover) |
| Dashboards | — | `VendorDashboard.tsx` (overview tab = setup checklist + stats), `ManageHome.tsx` (overview tab) |

## Findings

Each finding lists its files, the roles affected, the recommended change and the testing requirement.

### F1 — Critical: two paid subscriptions are possible

- **Current behaviour:** every "Upgrade to Pro" click creates a new Stripe Checkout session; the earlier one is only
  marked `abandoned` locally. If a partner pays in two tabs, both `checkout.session.completed` events activate, giving two
  live Stripe subscriptions.
- **Expected:** never a second subscription.
- **Files:** `server/src/commerce/subscriptions.ts` (`startProCheckout`, `applySubscriptionCheckout`), `PlanCard.tsx`.
- **Roles:** vendor owner and finance staff; host.
- **Recommended change:**
  - Reuse an open checkout session for the partner and expire the old one at Stripe.
  - On completion, if another subscription is already live, cancel the new one immediately at Stripe and flag it for
    refund (manual review).
  - Disable the CTA while the request is in flight.
- **Testing:** unit test for two completions and a reused session; browser test for a double click.

### F2 — High: no processing state after the Checkout return

- **Current behaviour:** a static line says "Pro starts as soon as Stripe confirms…". There's no polling and no
  status check.
- **Expected:** a "Confirming your payment" state, polling, and a retry/status action after a timeout.
- **Files:** `PlanCard.tsx`, `partnerPlan.ts`.
- **Roles:** partners.
- **Recommended change:** a `GET /plan/checkout-status` endpoint plus client polling, with the state exposed by the
  overview.
- **Testing:** browser test with a delayed webhook (fake provider).

### F3 — High: no way to update the payment method

- **Current behaviour:** the past-due state shows text only; there is no Stripe Billing Portal link.
- **Expected:** "Update payment method" opens Stripe's billing portal.
- **Files:** `provider.ts`, `partnerPlan.ts`.
- **Recommended change:** `provider.createBillingPortalSession`, plus "View billing" and "Update payment method".
- **Testing:** unit test (stub) and sandbox test.

### F4 — High: grace period is a code constant

- **Current behaviour:** `GRACE_DAYS = 7` in code.
- **Expected:** versioned configuration.
- **Recommended change:** a new rule field (e.g. a `subscription_policy.graceDays` rule), frozen on the subscription
  when it goes past due.
- **Testing:** a unit test for the configured value.

### F5 — High: plan visible only on the Earnings tab

- **Current behaviour:** no plan or rewards on the vendor or host overview.
- **Expected:** a shared "Plan & rewards" section on both overviews, with the detailed version on Earnings.
- **Files:** `VendorDashboard.tsx`, `ManageHome.tsx`, `EarningsSummary.tsx`.
- **Recommended change:** one domain component, `PlanRewardsPanel`, with `compact` and `full` variants.
- **Testing:** browser tests for every state at desktop and mobile.

### F6 — High: Free state sends the partner straight to Stripe

- **Current behaviour:** "Upgrade to Pro" goes straight to Stripe. There are no benefits, no plan review and no terms
  acknowledgement.
- **Expected:** "Explore Pro", then a Pro details page, then "Continue to Stripe".
- **Recommended change:** shared pages `/vendor/pro` and `/manage/pro`, following the existing `/vendor/...` and
  `/manage/...` conventions.
- **Testing:** browser tests.

### F7 — High: historical points can be recalculated with a new rate

- **Current behaviour:** split-points reversal re-derives targets with the **current** `rewards.pointsPerEuro`. A rate
  change after the award alters old bookings.
- **Expected:** use the frozen allocation.
- **Files:** `server/src/commerce/rewards.ts`.
- **Recommended change:** freeze the rate (and rule hash) on `reward_split_awards`; reverse with the frozen rate.
- **Testing:** unit test: change the rate after the award, then refund.

### F8 — High: no pending points, earned-this-month, progress or history

- **Current behaviour:** only the balance and the debt are returned.
- **Expected:** available, pending, earned this month, threshold progress, recent activity and full history, with the
  history distinguishing:
  - earned at settlement;
  - venue split share;
  - host split share;
  - refund reversal;
  - dispute reversal;
  - debt repayment;
  - redemption;
  - manual adjustment.
- **Files:** `rewards.ts`, `partnerPlan.ts`.
- **Recommended change:**
  - a history endpoint (a union of awards, split awards, reversals, split reversals and redemptions);
  - record debt repayment explicitly (it is currently implicit in a lot's remaining points);
  - an admin manual adjustment with a reason;
  - pending points estimated from unsettled orders with the per-order rule.
- **Testing:** unit and browser tests.

### F9 — High: no customer wallet

- **Current behaviour:** the balance is visible only as a checkbox in experience checkout. There's no history, no
  record of where credit was used, and no restoration record.
- **Expected:** a "Credit" section under the resident's account, with balance, expiry, history, source, booking used and
  restoration.
- **Files:** `credits.ts`, `partnerPlan.ts` (`residentCreditsRouter`), `Profile.tsx`.
- **Recommended change:** a history endpoint (lots + uses) and a `Credit` section in the account page.
- **Testing:** browser tests.

### F10 — High: experience checkout has no coupon field and no ordered breakdown

- **Current behaviour:** the server accepts `couponCode`, but the UI has no field. The price line mixes VAT and fee, and
  coupon and credit aren't itemised in order.
- **Expected:** activity price + taxes and fees − coupon − credit = card due, with coupon errors (invalid, expired, limit
  reached, not applicable).
- **Files:** `ExperienceDetail.tsx`.
- **Testing:** browser tests for the 15 checkout cases.

### F11 — High: credit restoration on partial refund is undefined

- **Current behaviour:** credit is released when an unpaid hold ends and reversed (restored) on a full refund. A partial
  refund doesn't restore credit.
- **Expected:** a defined refund-method order.
- **Recommended policy (needs owner decision):** restore credit in proportion to the refunded share; refund the card
  portion to the card.
- **Testing:** unit test.

### F12 — High: finance staff can subscribe and cancel

- **Current behaviour:** `vendorPlanRouter` uses `requirePlatformRole("finance")`, so invited finance staff can
  subscribe, cancel and redeem. Other staff get a 403 and the card silently disappears.
- **Expected:** owner manages the plan; finance staff view only; others see a neutral message.
- **Recommended change:** server-side owner check for `checkout`, `cancel`, `resume`, `redeem` and the billing portal;
  a read-only overview for finance staff.
- **Testing:** authorization tests.

### F13 — Medium: no switch-dependency validation

- **Current behaviour:** e.g. `circle_credits` can be enabled without `settlement_ledger`, and `customer_credits` without
  `engine_v2` / `engine_v2_experience`.
- **Recommended change:** a dependency table in `catalog.ts`, enforced in `PUT /switches/:key` and shown in the UI.
- **Testing:** unit and browser tests.

### F14 — Medium: credit grant lacks idempotency, currency and funding owner

- **Current behaviour:** the €500 cap is hardcoded; there's no idempotency, no currency and no funding owner, and expiry
  can't be chosen.
- **Recommended change:** an idempotency key and confirmation; currency from the `availability` rule; a funding-owner
  enum; optional expiry; the cap moved into the `credits` rule.
- **Testing:** unit tests.

### F15 — Medium: Admin → Commercial rules is one long rule list

- **Recommended change:** sections for Switches, Pro pricing, Reward points, Customer credit, Coupons, VAT/tax, Help and
  Version history. Rule versioning and impact preview already exist and are reused.

### F16 — Medium: one admin role covers everything financial

- **Current behaviour:** commercial rules, refunds, settlements and credit grants all need admin role `finance`; help
  needs `legal`.
- **Recommended change:** a capability layer, or a documented mapping. Needs owner decision.

### F17 — Medium: missing help topics

- **Current behaviour:** none for Pro features, subscription price, VAT, reverse charge, points earning, pending vs
  available, split points, points debt, redemption, cancellation, failed payment, customer credit, coupons or refund
  restoration.
- **Recommended change:** seed v1 entries and add a "Learn more" drawer.

### F18 — Medium: test-card hints aren't tied to test mode

- **Recommended change:** the server exposes `testMode` (key prefix `sk_test_` / stub) and the UI shows hints only then.

### F19 — Medium: no analytics events

- **Current behaviour:** no events for Explore Pro, checkout started/returned, cancel, keep, redeem or credit applied.
- **Recommended change:** add them to the consent-aware `analyticsEvents.ts`.

### F20 — Low: switch label still shows the code suffix

- **Current behaviour:** the label is "Partner reward points (CIRCLE_CREDITS)"; the internal key stays.
- **Recommended change:** drop the code suffix.

### F21 — Low: vendors without an organisation never earn points

- **Current behaviour:** `awardForSettlement` skips `vendor` kind. This is legacy; all vendors are backfilled to an org.
- **Recommended change:** document it.

### F22 — Medium: reward month and paid Pro can overlap

- **Current behaviour:** a partner on a reward-funded month can still start paid Pro, so the two overlap.
- **Recommended change:** decide whether paid Pro starts after the reward month (preferred) or replaces it, and show the
  state clearly.

Accessibility, loading and mobile in the existing plan card:
- buttons are labelled;
- loading shows nothing (the card is hidden while loading);
- errors show raw server text.

Requirement: skeleton, empty and error states with an `aria-live` status on every new surface.

## Content inventory and classification

| Item | Current source | Classification |
|---|---|---|
| Pro net price | `plan_pro.subscriptionMonthlyMinor` (rule) | Commercial configuration ✓ |
| VAT rate and mode | `tax_vat` (rule, partner-scoped) | Commercial configuration ✓ |
| Grace period (7 days) | Code constant | **Must become commercial configuration** |
| Redemption threshold, rate, expiry | `rewards` rule | Commercial configuration ✓ |
| Split points basis and rounding | `split_rewards` rule | Commercial configuration ✓ |
| Credit expiry | `credits` rule | Commercial configuration ✓ |
| Credit grant cap (€500) | Code | **Must become commercial configuration** |
| Credit kinds and funding owner | Code enum | Technical constant (enum), shown with help |
| Currency (EUR) | `availability` rule | Commercial configuration ✓ |
| Pro benefits (3 bullets) | Not present | **Must become editable help content** (`pro_benefit_1..3`) |
| Pro FAQs | Not present | **Must become editable help content** |
| CTAs ("Explore Pro", "Keep Pro"…) | — | Technical constant (UI copy) |
| Explanations (price, VAT, reverse charge, points, debt, cancellation, failed payment, credit, coupons, refund restoration, transfer vs payout) | Mostly missing | **Must become editable help content** |
| Coupon rules (min spend, limits, funding) | Coupon records | Commercial configuration ✓ |
| Eligibility rules (who earns points, redemption blocked by debt or paid subscription) | Code | Technical constant, described by help |
| Policy URLs (`/policies/...`) | Code | Technical constant |
| Test-card hint | Hardcoded in docs only | Technical constant, shown only in test mode |

## Decisions needed from the owner

1. Partial-refund credit restoration order (F11).
2. Finance-staff plan permissions (F12; recommended view-only).
3. Overlap between a reward month and paid Pro (F22).
4. Admin capability split (F16).
5. VAT treatment, still provisional pending Irish tax review.
