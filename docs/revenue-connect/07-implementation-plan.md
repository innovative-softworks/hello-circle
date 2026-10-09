# 07 — Proposed architecture, implementation phases and files

## Proposed architecture

```
                 ┌──────────────────── Versioned configuration (commerce_rule_versions, extended) ───────────────┐
                 │ plans · fees · tax · payment costs · settlement · rewards · credits · coupons · availability  │
                 │ draft → review → approved → scheduled → published → retired (audited, never edited in place)  │
                 └───────────────┬────────────────────────────────────────────────────────────────────────────────┘
                                 ▼
 Checkout / estimator / simulator / statements / refunds / reports ──▶ Calculation engine (server/src/commerce/money.ts, pe-2)
                                 │  fee_base, platform fee (min), fee VAT, partner pool, splits, coupons, credits, reserves
                                 ▼
 Order + immutable calculation snapshot (commerce_orders / pricing_snapshots, extended)
                                 │
          PaymentProvider interface ── StripeProvider (test mode only) │ StubProvider (tests, offline)
                                 │  checkout · refund(partial) · transfer · reverse · payout read · billing · onboarding links
                                 ▼
 Webhook ingress (verify → webhook_events unique id → handler → ledger posting; replay / manual-review queue)
                                 ▼
 Append-only double-entry ledger ──▶ settlements (weekly) ──▶ allocations (vendor | venue | host) ──▶ transfers ──▶ payouts
                                 ▲                                         reversals on refund/dispute (explicit)
 Coupons (campaigns, versions, funding) · Credits (liability) · Rewards (points after settlement) · Pro subscription (Billing)
 Policy CMS (documents, versions, acceptance, placeholders) · Help articles · Complaints & appeals · Trader profiles
```

Principles:
- The server is authoritative.
- Every money operation is idempotent (unique keys).
- Estimates and actual Stripe fees are kept as separate ledger lines, reconciled later.
- The legacy checkout stays the default until the flags move.

## Calculation (formula `pe-2`, all integer cents, half-up rounding, remainder rule documented)

```
fee_base           = service_subtotal − vendor/host/venue-funded discount − refunded service amount
platform_fee_net   = max(round(fee_base × plan_rate_bps), plan_minimum)      (0 for free events)
platform_fee_vat   = round(platform_fee_net × vat_bps)                        (mode: standard | exempt | reverse_charge)
partner_pool       = fee_base − platform_fee_net − platform_fee_vat           (must be ≥ 0, else block checkout)
customer_charge    = fee_base − HelloCircle-funded coupon − HelloCircle-funded credit (+ customer-facing tax only where configured)
split              = allocate(partner_pool, venue/host rule)  → fixed-then-remainder | percentage | custom (approved)
contribution_est   = platform_fee_net − card_estimate − payout_estimate − HC coupon − HC credit − reward_reserve − risk_reserve
```

Verified against all seven test vectors in the brief, to the cent:

| Vector | Fee | Fee VAT | Partner pool | Contribution |
|---|---|---|---|---|
| T1 | €9.00 | €2.07 | €88.93 | €6.93 |
| T2 | €7.00 | €1.61 | €91.39 | €4.92 |
| T3 | €0.90 | €0.21 | €8.89 | €0.38 |
| T4 | €0.75 (minimum) | €0.17 | €4.08 | — |
| T5 | venue €35.00 + host €53.93 = €88.93 | | | |
| T6 | €8.10 | €1.86 | €80.04 | — |
| T7 | €9.00 | — | €88.93 | **−€2.92** (customer pays €90): margin warning |

`pe-1` (today's +5% / +23% on top) stays available, so shadow comparison and the legacy flow are unaffected.

## Phases (the brief's stages 2–8). Each phase is flagged and ends with the 14-point report

| Stage | Scope | Flags | Needs |
|---|---|---|---|
| **2a** Config and roles | `users.admin_role` (super/finance/support/legal; existing admins → super). Config statuses `review`/`retired` plus `reviewed_by`. New rule keys: plans, tax, payment costs, settlement, rewards, credits, availability. `pricing_plans` and `plan_entitlements`. Founding-partner campaign as a versioned promotion | `plans.v1` | — |
| **2b** Calculation engine | `pe-2` formula, splits, coupons (vendor/host/venue/HC/shared), credits, reserves, margin warnings. Test vectors as golden tests. `PaymentProvider` interface (Stripe and Stub) wrapping all Stripe calls | `pricing.pe2` | — |
| **2c** Ledger and webhooks | `ledger_accounts` / `ledger_entries` with posting rules. `webhook_events` (store, verify, replay, manual queue). Handlers for every event in brief §11 (non-Connect ones live now). `refunds` (partial) and `disputes` tables | `ledger.v1` | — |
| **2d** Settlement (offline) | Completion = session end + 48h (D6). `settlements` / `settlement_allocations` computed weekly with €25 threshold and carry-forward. Legacy-order snapshot backfill (dry run first). **No transfers yet** | `settlement.v1` | — |
| **3** UX | Public pricing calculator. Vendor earnings calculator (live, no submit). Admin simulator. Partner earnings and settlement statements. Revenue/GMV/contribution dashboard. Help articles with field help from the CMS | `ux.pricing`, `ux.earnings` | — |
| **4** Policy system | Policy CMS (statuses, hash, placeholders, sanitised Markdown, history, print). 18 structured drafts. Acceptance and re-acceptance gating. Footer and dashboard links. Complaints, appeals and moderation reasons. Trader profiles (DSA/DAC7 data) | `policy.cms` | B1 for publication only |
| **5** Stripe Sandbox | Connected accounts (Express, embedded onboarding). Separate charges and transfers with `transfer_group`/`source_transaction`. Transfers after settlement. Payout mirroring. Dispute recovery by explicit transfer reversal. Pro on Stripe Billing (grace 7 days, downgrade at period end). Rewards (points after settlement, 10k = free month). Credits at checkout. Coupon campaigns v2 | `connect.v1`, `billing.pro`, `rewards.v1`, `credits.v1`, `coupons.v2` | **B1, B2** (test key via env) |
| **6** Staging | Five test partners, reconciliation, payout simulations, UAT | — | Explicit push/deploy instruction |
| **7** Pilot | 20–30 founding partners, IE/EUR, Pro waived 90 days, weekly finance review | — | Legal, tax and Stripe approval |
| **8** General release | After all sign-offs | — | All sign-offs |

## Blocking decisions (recommended default and impact)

| # | Decision | Recommended default | Impact if the default is taken |
|---|---|---|---|
| B1 | Legal entity, registered address, contacts, Stripe account country | None. Placeholders stay and **policy publication plus Stage 5 are blocked** | Stages 2–4 proceed. Nothing goes public |
| B2 | Connect enabled in Stripe **test mode**; test secret placed in `server/.env` by you (never in chat) | Stage 5 waits. Everything before it runs on the StubProvider | No delay to Stages 2–4 |
| B3 | **Customer repricing.** Today: list + 5% fee + 23% VAT on top. Brief: the displayed price is what the customer pays | Listing price = total customer price (VAT-inclusive where the partner charges VAT). Rolled out per resource type behind `pricing.pe2`, with partner notice beforehand. **Listings are not auto-uplifted** | Customers pay about 22% less for the same listing. Partner receives about 88.9% (Free) of the listed price instead of 100%. Partners may re-price |
| B4 | HelloCircle VAT registration | Fee VAT is configurable and effective-dated. Defaults to 23% as in the brief. Shown on invoices only once a VAT number exists | Fee-VAT figures are estimates until an accountant confirms |
| B5 | Admin sub-roles for existing admins | All current admins → `super` | No access change today |
| B6 | Venue deposit (€100 today) under the new model | Deposit is a separate line, not commission-bearing. Released by partial refund after the event (§8E for host-funded venue deposits) | Needs partial refunds (2c) |
| B7 | Cash payments | Cash orders accrue a **commission receivable** netted against the partner's next settlement. Otherwise invoiced | Removes the uncollected 5% gap (P1-5) |
| B8 | Passes (prepaid packs) | Treated as one order. Settlement eligibility per redeemed session (pro-rata). Unused credit settles at expiry | Fixes P2-6 |
| B9 | Open Booking (joiners pay on top today) | Keep current behaviour behind a flag. Revisit with split rules | No change |
| B10 | Foreign keys on legacy tables | No. FKs only among new finance tables | Avoids failing migrations on historical orphans |
| B11 | Earlier brief's commercial defaults (customer fee, 7% success, Circle Credits) | **Superseded** by this brief. Infrastructure reused | Earlier target-model draft gets discarded and replaced by Free/Pro plans |
| B12 | Founding-partner commission. §29 says "commission is not waived"; §28 says "9% commission remains active" while Pro is waived | The campaign carries a **commission plan**, default **Free (9%)**, with Pro features and no subscription for 90 days. Set it to Pro to give 7% instead | Partners get Pro features. HelloCircle keeps the 9% rate during the waiver |
| B13 | When is a club registration "completed"? Club sessions are weekly and recurring, with no end date | Completed at payment, then the review period (48h) | Club partners can settle about 2 days after payment |
| B14 | Transfer shape: one transfer per order (with `source_transaction`), or one per weekly settlement? | **One net transfer per settlement** (`transfer_group = settlement:<id>`, no `source_transaction`). A settlement nets refunds and recoveries, which a per-charge transfer can't represent. Transfers only run 48h+ after completion, so the funds are normally available; an "insufficient balance" refusal is recorded and retried with a new attempt | Platform balance must cover each run. Monitor the failed-transfer list |
| B15 | Embedded onboarding components (`@stripe/connect-js`) or Stripe-hosted onboarding? | **Hosted** (Account Links + Express dashboard login link) for now; this avoids adding a client dependency without approval. Embedded components can replace it later without server changes | Partners briefly leave the site to finish onboarding |

## Exact files expected to change

**Server: new**
- `src/commerce/plans.ts`, `src/commerce/tax.ts`, `src/commerce/calc.ts` (pe-2 and splits), `src/commerce/ledger.ts`
- `src/commerce/settlement.ts`, `src/commerce/credits.ts`, `src/commerce/rewards.ts`, `src/commerce/subscriptions.ts`
- `src/payments/provider.ts`, `src/payments/stripeProvider.ts`, `src/payments/stubProvider.ts`
- `src/payments/webhooks.ts` (event store and dispatch), `src/payments/connect.ts`
- `src/policy/cms.ts`, `src/policy/placeholders.ts`, `src/policy/sanitize.ts`
- Routes: `src/routes/adminFinance.ts`, `src/routes/adminPolicy.ts`, `src/routes/policies.ts` (public), `src/routes/partnerFinance.ts`, `src/routes/pricingPublic.ts`, `src/routes/help.ts`, `src/routes/complaints.ts`
- `src/scripts/backfillLegacySnapshots.ts`, `src/scripts/seedPolicyDrafts.ts`, and tests alongside each

**Server: modified**
- `src/db/index.ts` (additive schema)
- `src/commerce/{catalog,money,rules,engine}.ts`
- `src/checkoutService.ts` (moves behind the provider), `src/routes/stripeWebhook.ts` (delegates to the event store)
- `src/bookingIntegrity.ts`, `src/pricing.ts`
- `src/routes/{bookings,registrations,programs,games,passes,experiences}.ts` (engine branch behind flags)
- `src/routes/{vendorOperations,vendorPrograms,vendorExperiences}.ts` (partial refunds)
- `src/routes/admin.ts` (admin_role gates), `src/auth.ts` (`requireAdminRole`), `src/audit.ts` (`actor_role`)
- `src/terms.ts` (reads policy versions), `src/stripe.ts` (live-key refusal, Connect webhook secret), `src/index.ts` (mounts)

**Client: new**
- `src/pages/Pricing.tsx`, `src/pages/PolicyPage.tsx`, `src/pages/PolicyIndex.tsx`, `src/pages/HelpCentre.tsx`
- `src/components/EarningsCalculator.tsx`, `src/components/AdminFinance*.tsx` (overview, simulator, accounts, transfers, payouts, settlements, refunds, disputes, credits, rewards, subscriptions)
- `src/components/AdminPolicy*.tsx`, `src/components/PolicyAcceptanceGate.tsx`, `src/components/FieldHelp.tsx`
- `src/components/VendorEarnings.tsx`, `src/components/VendorPlan.tsx`, `src/components/ConnectOnboarding.tsx`

**Client: modified**
- `src/App.tsx` (routes), `src/pages/AdminDashboard.tsx` (tabs), `src/pages/VendorDashboard.tsx` (tabs)
- `src/components/Footer.tsx`, `src/components/MagicLinkCompleteAccount.tsx`, `src/components/AccountSetupGate.tsx` (real policy links and versions)
- Checkout pages (`BookingFlow`, `RegistrationFlow`, `ProgramDetail`, `ExperienceDetail`, `GameJoinCard`, `ClubDetail`): server quote, supplier identity, total price
- `src/pages/PrivacyPolicy.tsx` / `CookiePolicy.tsx` (CMS-backed with fallback)
- `src/api/{public,admin,vendor,resident}.ts`

**Docs**
- `docs/revenue-connect/*`, `README.md` env table (new vars), `CLAUDE.md` (architecture notes)
