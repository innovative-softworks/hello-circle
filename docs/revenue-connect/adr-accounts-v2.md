# ADR: Stripe Accounts v2 for connected accounts (v2-first, not v2-only)

- **Status:** accepted (Stage 5e, 2026-10-10)
- **Supersedes:** the Stage 5a choice of Accounts v1 (`POST /v1/accounts`, `controller` properties)

## Context

Stage 5d found that the HelloCircle sandbox platform (`acct_1UJMiOCJ5YFf911E`, Ireland, EUR) **refuses Accounts v1
account creation**. Stripe now requires Accounts v2 for new Connect platforms. Stripe's alternative, enabling "Accounts v1
support" in the Dashboard, was ruled out by the owner: it would only preserve the old implementation.

## Decision

Every **new** connected account is created with **Accounts v2** (`POST /v2/core/accounts`). Accounts v2 is used for:

| Concern | v2 call |
|---|---|
| Creation | `v2.core.accounts.create` |
| Configuration | `configuration.recipient` (receive transfers into the Stripe balance) |
| Legal identity and business information | `identity` (country, entity type). Collected by Stripe on its hosted page, never by HelloCircle |
| Requirements and verification state | `v2.core.accounts.retrieve` with `include: ["configuration.recipient", "requirements", "identity"]` |
| Hosted onboarding and update links | `v2.core.accountLinks.create` (`account_onboarding` / `account_update`) |
| Dashboard | `dashboard: "express"` |
| Account events | v2 thin events (`v2.core.account*`), re-fetched by id |

### Selected configuration (the commercial model is unchanged)

```
dashboard: "express"                                   partner's Express dashboard
defaults.responsibilities.fees_collector:   "application"  HelloCircle controls pricing
defaults.responsibilities.losses_collector: "application"  HelloCircle bears negative balances
configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested = true
                                                        the ONLY capability requested
(no merchant configuration, no card_payments)           HelloCircle stays the merchant:
                                                        separate charges and transfers
identity.country = "ie", identity.entity_type = company | individual (from the trader profile)
defaults.currency = "eur"
metadata: party_type, party_id, hc_creation_key (+ hc_qa_run in the QA Stripe profile only)
```

Stripe reports `requirements_collector: "stripe"` for this configuration (Express), verified in the sandbox. That is why
HelloCircle can't accept Stripe's terms for a partner (`tos_acceptance_on_behalf_not_allowed`), and why identity can't be
written once an Account Link has been issued.

## v1 compatibility endpoints (inventory)

Some operations have no Accounts v2 equivalent, either in the API or in `stripe-node` 22.x. Stripe documents the v1
endpoint, called with the v2 account id, as the supported way. Every such call lives in the provider adapter
(`server/src/payments/provider.ts`) or the QA harness, and is listed in code as `CONNECT_V1_COMPAT`. Nothing outside the
adapter knows which API generation performed an operation.

| v1 endpoint | Used for | Why it's still v1 | Stripe documentation | Removal detection |
|---|---|---|---|---|
| `POST /v1/transfers` | Platform → connected-account transfer | No v2 transfers API. Stripe accepts a v2 account as `destination` once `configuration.recipient…stripe_transfers` is active (the error message names that capability) | docs.stripe.com/connect/separate-charges-and-transfers | `SANDBOX-SPLIT` transfer legs |
| `POST /v1/transfers/:id/reversals` | Partial or full reversal (debt recovery) | No v2 reversal API | docs.stripe.com/connect/separate-charges-and-transfers | `SANDBOX-SPLIT` refund and dispute legs |
| `POST /v1/accounts/:id/login_links` | One-time Express dashboard link | No v2 login-link API | docs.stripe.com/connect/express-dashboard | `connect.test` dashboard link |
| `GET /v1/payouts` (`Stripe-Account`) | Reading bank payouts on the connected account | Payouts are v1 objects on the connected account | docs.stripe.com/connect/payouts-connected-accounts | `SANDBOX-SPLIT` and `SANDBOX-DELIVERY-G` payout legs |
| `POST /v1/accounts/:id` (`settings.payouts`) | Payout schedule. **QA harness only**, the app never changes it | Accounts v2 does not expose payout settings | docs.stripe.com/connect/manage-payout-schedule | `createVerifiedRecipient` (harness) |
| `POST /v1/accounts/:id/external_accounts` | Adding a test bank account. **QA harness only** (partners add theirs on Stripe's hosted page) | No v2 bank-account API in `stripe-node` 22.x | docs.stripe.com/connect/payouts-bank-accounts | `createVerifiedRecipient` (harness) |

Accounts created before Stage 5e (`connected_accounts.api_model = 'v1'`) are still read and linked through v1
(`accounts.retrieve`, `accountLinks.create`). None exist in production.

### How removal is detected and tested later

1. **Each endpoint is named in `CONNECT_V1_COMPAT`** with the test that exercises it. A unit test fails if an entry lacks
   a reason, a docs link or a test.
2. **When Stripe ships a v2 equivalent** (new `stripe-node` major version): implement it in the adapter, switch the named
   sandbox test to assert the v2 call, delete the entry, and run `npm run qa:stripe`. The reconciliation spec proves money
   still matches to the cent.
3. **If Stripe removes a v1 endpoint for v2 accounts first**, the named sandbox spec fails at that leg in the
   `qa:stripe` run, before any release.

## Consequences

- Hosted onboarding stays (decision B15). In test mode Stripe's hosted page shows an **hCaptcha challenge**, so automated
  tests cannot complete Express onboarding. Money-movement tests use labelled **test doubles**: v2 recipient accounts with
  `dashboard: "none"`, which makes Stripe report `requirements_collector: application`. The harness can then record the
  test ToS acceptance and Stripe's documented test identity. Transfers, reversals and bank payouts behave identically.
- Idempotent creation: a per-partner reservation (`connected_account_creations`) holds the Stripe idempotency key. The key
  has a random component fixed at reservation, so a reservation recreated later never collides with an older key still in
  Stripe's 24-hour window.
- State is never hardcoded. It is re-fetched from Stripe on creation, return, refresh and every event, and
  `last_synced_at` stops an older fetch overwriting a newer one.
