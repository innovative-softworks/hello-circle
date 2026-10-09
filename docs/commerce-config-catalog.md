# Commerce — configuration catalog

Source of truth: `server/src/commerce/catalog.ts`. Values live in `commerce_rule_versions` (versioned) and
`app_settings` (switches). Defaults below are **rule v1 = live behaviour at Phase 1**. They are seeds, not
constants: nothing reads them at runtime except through `resolveRule()` / `commerceSwitch()`.

## How a rule resolves

1. Scopes that apply to a quote, from least to most specific: **global → scenario → category → partner**
   (`org:<organisation id>`, then `host:<resident id>`).
2. At each scope, the published version with the latest `effective_from ≤ T` is in force (ties go to the higher
   version). If that version's `effective_to ≤ T`, the scope contributes nothing. An older version never comes
   back on its own.
3. Values merge field by field, so an override only changes the fields it sets.
4. If no global version is in force, resolution **fails closed** (`RuleResolutionError`).
5. The result carries `values`, the contributing `sources` (id/scope/version) and a sha256 `hash`. Phase 2 stores
   all three on every order snapshot.

## Lifecycle

`draft → (approved) → published`. A draft can also be `discarded`.

- Editing an approved draft voids the approval.
- `effective_from` defaults to now and can't be in the past (allowance: 1 minute of clock skew).
- Published rows are immutable. The one exception is `effective_to`: `/end` sets it to end a non-global override.
- Rollback publishes a **new** version that copies an earlier one's values.
- Two-person approval: when `commerce.require_second_approver` is on, publishing needs `approved_by` set to a
  different admin than `created_by`.
- Every write requires a reason of at least 5 characters. Each write adds an `audit_log` row in the same
  transaction, recording `actor_kind`, `reason`, `correlation_id` and `environment`.

## Rules

### `pricing`: Pricing & fees (scopes: global, scenario, category, partner)

| Field | Kind | Bounds | v1 (today) | Draft v2 (target, unpublished) |
|---|---|---|---|---|
| `customerFeeBps` | bps | 0–3000 | 500 (5%) | 0 |
| `successFeeBps` | bps | 0–5000 | 0 | 700 (7%) |
| `successFeeBase` | enum | `partner_net` \| `customer_goods` | partner_net | partner_net |
| `vatBps` | bps | 0–5000 | 2300 (23%) | 2300 |
| `vatMode` | enum | `added_on_top` \| `included_in_price` | added_on_top | included_in_price |
| `paymentCostBearer` | enum | `platform` \| `partner` | platform | platform |
| `paymentCostBps` | bps | 0–1000 | 150 (estimate) | 150 |
| `paymentCostFixedMinor` | minor | 0–500 | 25 (estimate) | 25 |
| `venueDepositMinor` | minor | 0–100000 | 10000 (€100) | 10000 |
| `dayRateMinHours` | int (hours) | 1–24 | 8 | 8 |
| `dayRateMultiplierBps` | bps | 10000–240000 | 65000 (6.5×) | 65000 |

The processing-cost fields are **estimates for contribution reporting**. They are never charged to a customer.
The 1.5% + €0.25 figure is Stripe's published standard EEA card rate; replace it with the real blended rate.

### `checkout`: Checkout holds (scope: global only)

| Field | Kind | Bounds | v1 |
|---|---|---|---|
| `pendingHoldMinutes` | int (minutes) | **30–1440** | 30 |

The bounds are technical: Stripe Checkout sessions must expire between 30 minutes and 24 hours, and the capacity
hold must not outlive the payment page.

### `cancellation`: Cancellation defaults (scopes: global, scenario, category)

| Field | Kind | Bounds | v1 |
|---|---|---|---|
| `cancellationHours` | int (hours) | 0–720 | 48 |
| `bookingWindowDays` | int (days) | 1–730 | 90 |

An organisation's own `org_policies` row still wins for that organisation (unchanged behaviour).

### Scenarios and categories

- Scenarios: `vendor_activity`, `host_activity`, `venue_host`, `venue_booking`, `free`, `programme`, `pass`,
  `experience`.
- Categories (resource types): `booking`, `registration`, `game`, `program`, `pass`, `experience`.

## Switches (`app_settings`, admin-toggled with a reason, audited)

| Key | Default | Read by | Effect |
|---|---|---|---|
| `commerce.require_second_approver` | off | Phase 1 (`rules.ts`) | A second admin must approve before publish |
| `commerce.paid_games_require_verified_host` | **on** | Phase 0.5 (`games.ts`) | Pricing an activity needs `host_status='verified'` |
| `commerce.shadow_pricing` | off | Phase 2 | Shadow-price every checkout and log diffs |
| `commerce.engine_v2` | off | Phase 2 | Engine quotes/orders for enabled types |
| `commerce.coupons_v2` | off | Phase 3 | Funding-aware coupons |
| `commerce.settlement_ledger` | off | Phase 4 | Ledger and payout allocations |
| `commerce.circle_credits` | off | Phase 5 | Partner reward points |
| `commerce.pro_subscriptions` | off | Phase 6 | HelloCircle Pro |
| `commerce.boost_vouchers` | off | Phase 7 | Boost vouchers |
| `commerce.venue_host_split_payout` | off | Phase 8 | Venue + Host single-fee split |

## Money conventions (`server/src/commerce/money.ts`)

- Amounts are integer minor units, and rates are integer basis points.
- Rounding is half-up per component. It is exhaustively identical to legacy `Math.round` from €0 to €50,000.
- `allocate()` splits by largest remainder, so parts always sum to the total.
- `priceBreakdown()` satisfies
  `customerPaid = partnerPayout + successFee + partnerPaymentCost + customerFee + vat + deposit`
  (property-tested).
- Pricing engine version: `pe-1`.

## Not yet configurable (net-new, later phases)

- Coupon policy (funding, min spend, max discount, per-customer limit): Phase 3
- Payout timing and refund policy: Phase 4
- Reward programme: Phase 5
- Subscription plan price and Stripe price mapping per environment: Phase 6
- Boost pricing: Phase 7
