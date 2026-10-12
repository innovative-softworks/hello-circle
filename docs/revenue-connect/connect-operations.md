# Connect operations runbook (Stage 5e)

For finance and support. Explanations shown to partners come from editable help entries (Admin → Help: `connect_state_*`,
`connect_transfer_vs_payout`, `venue_split`). Amounts come from versioned rules (`settlement`, `venue_split`, `tax_vat`,
`payment_costs`). Change them there, not in code.

## 1. Funds flow

```
 Customer card ──charge──▶ HelloCircle platform account (HelloCircle is the merchant)
                               │  allocation snapshot frozen at payment:
                               │  gross = HelloCircle retained + venue + host + VAT + deposit
                               ▼
                     ledger: partner_payable / host_payable (pending)
                               │  activity ends + 48 h review (settlement.reviewHours)
                               ▼
                     partner_available (per partner, independently)
                               │  weekly settlement run, per partner, ≥ €25 (settlement.minPayoutMinor);
                               │  below → carried; open debt → frozen
                               ▼
                     settlement (due) ──transfer run──▶ TRANSFER (tr_…): HelloCircle → partner's Stripe balance
                               (one per settlement; per-booking allocation rows)
                                                              │  Stripe's schedule
                                                              ▼
                                               BANK PAYOUT (po_…): Stripe → partner's bank
```

## 2. Connected-account states

| State | Meaning | What to do |
|---|---|---|
| `not_started` | No payout account | Partner: "Set up payouts with Stripe" |
| `onboarding_incomplete` | Stripe needs details (identity, bank, terms) | Partner continues on Stripe's hosted page. Expired links renew automatically |
| `under_review` | Everything submitted; Stripe is verifying | Wait |
| `more_information_required` | Stripe asked an onboarded partner for more | Partner opens the update link on the payout card |
| `transfers_unavailable` | Stripe isn't accepting transfers into the account | Settlements stay due (held). Partner checks the Express dashboard or support |
| `payouts_unavailable` | Transfers arrive, but Stripe can't pay the bank yet | Money waits in the partner's Stripe balance; transfers are **not** held |
| `enabled` | Transfers and bank payouts active | — |

State is always re-fetched from Stripe: on creation, on return from Stripe, on "refresh", and on every account event.
An older event or fetch never overwrites a newer state (`connected_account_syncs` logs every attempt, `applied=0` when
skipped). Transfers are held only by: no account, transfers capability not active, an open partner debt, or trader
details not self-certified.

## 3. Transfer vs bank payout

- **Transfer** (`transfers`, `tr_…`): made by HelloCircle's weekly transfer run. One per settlement, split into immutable
  per-booking `transfer_allocations`. Can be partially reversed (`trr_…`) to recover a debt.
- **Bank payout** (`connected_payouts`, `po_…`): made by Stripe from the partner's Stripe balance on Stripe's schedule.
  Mirrored from `payout.*` events. A payout status never moves backwards (a late older event is ignored; `paid → failed`
  is allowed).
- A sent transfer **does not** mean the bank was paid. A failed bank payout **does not** change the transfer.
  Verified in the sandbox: venue payout on `IE29…` → `paid`; host payout on `IE89…` → `failed`, its transfer unchanged.

## 4. Venue/host split, with exact cents

A host's paid game at a partner venue. The host proposes; the venue organisation accepts (or declines with a reason).
The agreement in force **when the booking is paid** is frozen in `allocation_snapshots` / `allocation_lines`.

**€40 game, 66.67% venue, rounding owner = venue (default):** charge 5120 = HelloCircle 200 (5% fee) + VAT 920 + partner
pool 4000. Venue ⌊4000×6667/10000⌋ = 2666, host ⌊4000×3333/10000⌋ = 1333, remainder 1 → venue: **venue 2667, host
1333**. Check: 200 + 2667 + 1333 + 920 + 0 = 5120.

| Variant | Venue | Host | HelloCircle | Note |
|---|---|---|---|---|
| Rounding owner = host | 2666 | 1334 | 200 | |
| Rounding owner = platform | 2666 | 1333 | 201 | Cent kept as fee revenue |
| Fixed venue €15 | 1500 | 2500 | 200 | |
| €10 coupon funded by HelloCircle | 2667 | 1333 | −850 | Customer pays 3840; partners whole; `coupon_expense` 1000 |
| €10 coupon funded by the partner | 2001 | 999 | 150 | Pool is the discounted 3000 |

Each share is released, settled (each with its own €25 minimum and carry), frozen and transferred independently.

**Reward points on a split booking** (rule `split_rewards`, rate from `rewards.pointsPerEuro`):
- Both partners earn, each only on its own settled eligible allocation, issued at that partner's settlement.
- Eligible means the partner's allocation minus its share of HelloCircle-funded coupons and customer credits, minus what
  refunds took from it, minus its share of lost disputes. VAT, HelloCircle fees and Stripe fees are never part of a
  partner allocation.
- The booking's points are ⌊Σ eligible × rate ÷ 100⌋, divided by largest remainder, so the partners together never earn
  more than the booking would. Examples:
  - €40 at 66.67%: venue 2667, host 1333 → 40 points → venue 27, host 13.
  - After a ¼ refund: eligible 2000 / 1000 → 30 points → reversal of 7 (venue) and 3 (host).
- Each partner's points are re-derived and reversed separately after refunds or disputes. A reversal the partner can't
  cover becomes that partner's own points debt.

## 5. Refund and dispute responsibility

- **Refund:** reverses the original payment line by line, in proportion (largest remainder). Each partner loses only
  their own share. Example: €12.80 of €51.20 → venue 667, host 333, fee 50, VAT 230.
- **Refund after transfer:** the partner's available balance goes negative. Open a debt per partner (Admin → Finance →
  partner → "Open debt", reason required, preferably naming the booking). It reverses **that partner's own** transfer
  allocation for that booking first, then their newer ones. Never another partner's. Anything unrecovered stays open,
  freezes that partner, and is offset by their own future earnings (the debt then closes as `offset`).
- **Lost dispute:** finance chooses who bears it:
  - `partner`: venue and host in proportion to their frozen allocations. Sandbox: €49.23 disputed → venue 3282, host 1641.
  - `venue` or `host`: that partner alone.
  - `platform`: HelloCircle absorbs it.

  Recorded in `dispute_recovery_allocations` and the ledger (`dispute_recovery:<du_…>`). Stripe's **actual** dispute fee
  is posted separately (`dispute_fee_expense`, from the dispute's balance transactions, never a constant) and is kept even
  if the dispute is won, as at Stripe.

## 6. Reconciliation procedure (weekly, after the transfer run)

1. Admin → Finance → Webhooks: no `failed` or `manual_review` items left unexplained. A `transfer.reversed` made outside
   HelloCircle always lands in manual review. Reconcile the ledger by hand.
2. For each transfer: Stripe amount = local amount; Stripe `amount_reversed` = local `reversed_minor`; allocation rows sum
   to the transfer; the settlement net equals the transfer.
3. For each debt: recovered = sum of its created reversals.
4. For each payment: Stripe charge, refunds (each by id), actual card fee and disputes (amount and fee) match locally.
5. Pro invoices: cash and VAT match the ledger.
6. Ledger: every group balances (trial balance 0).

`npm run qa:stripe` runs all of this against the sandbox (`SANDBOX-RECONCILE`). Known intentional exception: the
HC-QA-091-PARTIAL test withholds one webhook on purpose and is reported under `flaggedExceptions`.

## 7. Rollback and feature switches

| Switch (Admin → Settings) | Off means |
|---|---|
| `commerce.connect_v1` | No onboarding, no transfer runs, no debt recovery. Ledger and settlements keep accruing |
| `commerce.settlement_ledger` | No postings or settlements (Connect needs it) |
| `commerce.circle_credits` | No reward points |
| `commerce.venue_host_split_payout` | No split proposals or decisions; every game booking pays the host alone (accepted agreements are kept but not applied) |

All default **off**; nothing in Stage 5e turns any on. Rolling back code: schema changes are additive (new nullable
columns and new tables only), so an older build ignores them. Accounts created as v2 stay valid at Stripe. Disable
`commerce.connect_v1` before rolling back past Stage 5e, because the older build would try to read them as v1.
Split agreements only affect bookings paid while one is accepted; to stop splitting, the venue or host withdraws it (new
proposal) and later payments are single-partner again.
