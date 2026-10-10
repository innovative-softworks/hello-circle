# Stage 5f — Partner plan, rewards and customer-credit UX specification

This spec follows the audit (`08-subscription-rewards-ui-audit.md`). It uses one shared domain component per concept,
never two parallel systems for vendors and hosts.

## Provisional owner decisions (defaults until confirmed)

| # | Decision | Default implemented | Where to change |
|---|---|---|---|
| D1 | Credit on a partial refund | Restored **in proportion** to the refunded share of the booking; the card share goes back to the card | `credits.ts` (`restoreCreditForRefund`) |
| D2 | Vendor finance staff and the plan | **View only.** Organisation owner subscribes, cancels, redeems and manages billing. Server-enforced | `partnerPlan.ts` `requireOwner` |
| D3 | Paid Pro during a reward month | Allowed: Stripe Checkout with `trial_end` = reward month end, so **billing starts when the reward month ends** (no double Pro, no lost points) | `subscriptions.ts` |
| D4 | Admin permissions | Unchanged: `finance` = commercial rules, credit grants, refunds and settlements; `legal` = help. A capability split stays open | `routes/admin.ts` |
| D5 | VAT | Provisional pending Irish tax review (rule `vat_treatment`) | Rule |

## Information architecture

```
Vendor dashboard  /vendor (Overview)  ─┐
Host Manage       /manage (Overview)  ─┼─▶ "Plan & rewards" (PlanRewardsPanel, compact)
                                       │      └─ Explore Pro ▶ /vendor/pro | /manage/pro (ProDetailsPage)
Earnings tab      ?tab=earnings       ─┘      └─ View rewards ▶ /vendor/rewards | /manage/rewards (RewardsHistoryPage)
                                        (PlanRewardsPanel, full)
Resident account  /profile ── "Credit" section (CreditWallet), never called points
Experience page   checkout ── price → +tax/fees → −coupon → −credit → card due
Admin             Commercial rules (sectioned) · Finance (Pro, rewards, credit, coupons…)
```

Routes follow the existing `/vendor/...` and `/manage/...` conventions. A single component receives `scope: "vendor" | "host"`.

## Plan states (server-derived `state`; the client never infers it)

| State | Headline | Primary CTA | Secondary |
|---|---|---|---|
| `free` | Your plan: Free | Explore Pro | How rewards work |
| `processing` | Confirming your payment | Check status (after 30 s) | — |
| `paid_active` | Pro active (Paid subscription badge) | Manage plan | View billing · View rewards |
| `reward_active` | Pro — reward month | Explore paid Pro | View reward history |
| `cancelling` | Pro ends on {date} | Keep Pro | View cancellation details |
| `payment_failed` | Payment needs attention | Update payment method | Grace end and days left; consequence |
| `unavailable` | Section hidden when both Pro and rewards are off; neutral line when only one is | — | — |

Each state also shows:
- **Price:** net, the tax row (label from the partner's tax rule: VAT x% / reverse charge / exempt) and the total. Values
  come from the current `plan_pro` and `tax_vat` rules for this partner, never a hardcoded Irish example.
- **Rewards:**
  - available points;
  - pending points (estimated on unsettled bookings);
  - earned this month;
  - progress toward `rewards.redemptionPoints`;
  - a points-debt warning;
  - recent activity (3 items) with a link to the full history.
- **Help:** a short inline line plus "Learn more", which opens a drawer with the editable help entry.
- **Read-only staff** (D2): the same information, with actions replaced by "Only the organisation owner can change the
  plan".

### Redemption CTA states

| State | When |
|---|---|
| available | — |
| not_enough | Shows points still needed |
| debt | — |
| paid_active | — |
| cancelling_active | — |
| reward_active | — |
| processing | — |
| disabled | — |

After redemption, show: points spent, Pro start and end dates, remaining points, and "No paid subscription was
created".

## Pro details page (`ProDetailsPage`)

1. Overview
2. Free vs Pro comparison: success fee and minimum fee from the `plan_free` / `plan_pro` rules
3. Price and tax breakdown (the frozen current rules)
4. Reward-funded month
5. Billing cycle
6. Cancellation
7. Failed-payment grace (`subscription_policy.graceDays`)
8. Refunds and disputes vs points
9. Benefits (help `pro_benefit_1..3`)
10. FAQs (help `pro_faq_*`)
11. Terms checkbox
12. "Continue to Stripe"

Test-card hint appears only when `testMode`.

Flow: Free dashboard → Explore Pro → review → Continue to Stripe → Stripe Checkout → `?pro=success` → `processing`
(polls `/plan/checkout-status` every 3 s up to 60 s, then "Check status") → webhook → `paid_active`.

**Duplicate protection:**
- The CTA is disabled while in flight.
- The server reuses an open checkout session and expires the older one at Stripe.
- A second completed checkout is cancelled at Stripe and flagged for review.

## Rewards history (`RewardsHistoryPage`)

Entry kinds and labels:

| Kind | Label |
|---|---|
| `earned` | Earned at settlement |
| `venue_share` | Venue split share |
| `host_share` | Host split share |
| `refund_reversal` | Refund reversal |
| `dispute_reversal` | Dispute reversal |
| `debt_repayment` | Debt repayment |
| `redemption` | Pro redemption |
| `adjustment` | Manual adjustment |

Every row shows the date, booking ref where relevant, and signed points. Split points always come from the frozen
award (the rate and rule hash are stored with it).

## Customer credit (`CreditWallet`, `/profile`)

- **Shows:**
  - available credit and expiry;
  - history: granted (with reason/source), used (booking ref), restored (refund), expired.
- **Wording:** "HelloCircle credit", never "points".
- **Checkout order (experience):**

  ```
  Activity price + taxes/fees − coupon − credit = Card payment due
  ```

  It shows the coupon name, discount, credit used, remaining credit and card amount.
- **Errors:**
  - coupon invalid, expired, usage limit reached, not applicable;
  - insufficient credit (the quote recalculates);
  - duplicate submission (button disabled, server quote idempotent).
- **Zero card payment:** confirmed without Stripe.
- **Failed or expired payment:** the reserved credit is released (existing lifecycle).

## Admin

**Commercial rules** has sections:
1. Feature switches
2. Pro pricing
3. Reward points
4. Customer credit
5. Coupons
6. VAT/tax
7. Help content
8. Version history

Rule versions keep draft → published, effective date, reason, admin, audit and impact preview (existing).

**Switch dependencies, enforced server-side** (refused with the missing prerequisite named):
- `circle_credits` → `settlement_ledger`
- `customer_credits` → `engine_v2` + `engine_v2_experience`
- `venue_host_split_payout` → `settlement_ledger` + `connect_v1`
- `connect_v1` → `settlement_ledger`
- Turning off a switch that another enabled switch depends on is refused too.

**Finance** shows Pro subscriptions, reward points (per partner: available, debt, recent), credit balances and grants,
coupon usage, settlements, transfers, bank payouts, refunds, disputes and webhooks.

**Credit grant fields:**
- customer email
- amount
- currency (from `availability`)
- type (goodwill / promotional / refund)
- funding owner (helloCircle / partner)
- reason
- optional expiry
- idempotency key (client-generated per dialog)
- confirmation step

## Help topics (editable, v1 seeded)

| Topic | Key |
|---|---|
| What Pro includes | `pro_benefit_1..3` |
| Pro FAQs | `pro_faq_cancel`, `pro_faq_refund_points`, `pro_faq_reward_month` |
| Subscription price | `pro_price` |
| VAT on your plan | `pro_vat` |
| Reverse charge | `pro_reverse_charge` |
| How points are earned | `points_earning` |
| Pending vs available points | `points_pending` |
| Split-booking points | `points_split` |
| Points debt | `points_debt` |
| Redeeming a free Pro month | `points_redeem` |
| Cancelling Pro | `pro_cancellation` |
| Failed payment and grace | `pro_failed_payment` |
| HelloCircle credit | `credit_customer` |
| Coupons | `credit_coupons` |
| Credit back after a refund | `credit_refund_restoration` |
| Transfer vs bank payout | `connect_transfer_vs_payout` (exists) |

No QA or test instructions are kept in help.

## Permissions (server-enforced)

| Role | Plan view | Subscribe / cancel / resume / redeem / billing portal | Credit |
|---|---|---|---|
| Vendor org owner | ✓ | ✓ | — |
| Vendor finance staff | ✓ | ✗ (403, D2) | — |
| Other vendor staff | ✗ (403; panel shows a neutral line) | ✗ | — |
| Host (the resident) | ✓ | ✓ | — |
| Resident | — | — | Own credit only |
| Admin `finance` | — | — | Grants; rules; finance |
| Admin `legal` | — | — | Help |

## Analytics (consent-aware, no personal data)

- `plan_explore_pro`
- `plan_checkout_started`
- `plan_checkout_returned`
- `plan_cancel`
- `plan_keep`
- `plan_billing_portal`
- `rewards_redeemed`
- `rewards_history_viewed`
- `credit_applied`
- `coupon_applied`
- `coupon_rejected`

## UI-state test matrix (desktop + mobile, fake provider; Stripe test mode only in `qa:stripe`)

| # | State or case | Unit | Browser |
|---|---|---|---|
| 1 | Free, standard VAT 23% | ✓ | ✓ |
| 2 | Exempt partner | ✓ | ✓ |
| 3 | Reverse-charge partner | ✓ | ✓ |
| 4 | Checkout return → processing → active (delayed webhook) | ✓ | ✓ |
| 5 | Duplicate CTA click → one session | ✓ | ✓ |
| 6 | Paid Pro active | ✓ | ✓ |
| 7 | Reward-funded Pro | ✓ | ✓ |
| 8 | Cancel → cancelling → Keep Pro | ✓ | ✓ |
| 9 | Renewal failure → payment_failed with grace days | ✓ | ✓ |
| 10 | Grace expiry → Free | ✓ | — |
| 11 | Zero points / pending points / redemption eligible / points debt | ✓ | ✓ |
| 12 | Split-booking points history (venue and host share) | ✓ | ✓ |
| 13 | Refund and dispute reversal in history | ✓ | — |
| 14 | Customer credit wallet (grant, use, restore) | ✓ | ✓ |
| 15 | Coupon + credit checkout; full-credit (zero card) checkout | ✓ | ✓ |
| 16 | Invalid / expired / limit / not-applicable coupon | ✓ | ✓ |
| 17 | Full and partial refund restore credit | ✓ | — |
| 18 | Invalid switch combination refused | ✓ | ✓ |
| 19 | Unauthorized staff (finance view-only, other staff 403) | ✓ | ✓ |
| 20 | Keyboard navigation, labels, aria-live, loading/empty/error | — | ✓ |
