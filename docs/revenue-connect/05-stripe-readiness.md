# 05 — Stripe readiness assessment

**No live or test Stripe API call was made for this audit.** Everything below comes from reading the code.

## What exists

| Capability | Status | Evidence |
|---|---|---|
| Platform account, Stripe Checkout (one-time `payment`) | ✅ | `checkoutService.ts:createCheckoutSession` |
| Webhook signature verification, fail-safe without a secret | ✅ | `stripeWebhook.ts:417-448`, `stripeWebhookPolicy.ts` |
| Idempotent confirm (row state), late-payment "refund required" | ✅ | `stripeWebhook.ts:settlePending` |
| Full refunds, idempotency key, external-refund reconciliation | ✅ | `checkoutService.ts:refundPaidOnce` |
| Stripe Customer per resident, saved cards | ✅ | `resolveStripeCustomer` |
| Provider seam (network-free stub) | ✅ partial | `qaProviderStubEnabled()`; not yet a full provider interface |
| Stripe Connect (accounts, onboarding, transfers, payouts) | ❌ | none |
| Webhook event store / replay / dead-letter queue | ❌ | none |
| Disputes, `charge.refunded`, `payment_intent.*`, `transfer.*`, `payout.*`, `account.updated` | ❌ | handler handles only `checkout.session.*` |
| Partial refunds | ❌ | full only |
| Stripe Billing (Pro subscription, invoices) | ❌ | none |
| Balance-transaction / actual-fee capture | ❌ | none |
| Test-mode guard against live keys | ⚠️ | no explicit `sk_live_` refusal in dev/staging |

## Recommended Connect configuration (confirmed by Stripe's Connect guidance)

- **Business model:** marketplace. HelloCircle collects every payment and is on the customer's statement.
- **Dashboard:** Express (lightweight view for sellers), with embedded components: `account_onboarding`,
  `notification_banner` (required), `account_management`, `payouts`.
- **Fee collection:** your platform manages pricing.
- **Negative balance liability:** your platform.
- **Charge pattern:** separate charges and transfers. This is the only pattern that supports a delivery-gated
  payout (transfer after completion + 48h) and **one payment split across two connected accounts**
  (venue + host).
- **Fee mechanics:** no `application_fee_amount` (incompatible with this pattern). HelloCircle keeps
  `charge − Σ transfers`. `transfer_group` is set to the order id. Transfers use `source_transaction` so a transfer
  can't run ahead of the funds.
- **Caution:** with this pattern partners can't handle refunds or disputes in their Express dashboard. Disputes are
  debited from HelloCircle first and recovered by **explicitly reversing transfers** (only refunds can reverse
  automatically). Webhook-driven recovery is mandatory.
- **Margin:** HelloCircle pays the card fee and Connect fees. Test vector 3 (€10, Free) leaves about €0.38
  contribution before the monthly active-account fee, and T7 is negative. The admin simulator and margin alerts
  are therefore required, not optional.
- **Wording:** "Transfer eligibility begins after the activity is completed and the configured review period has
  passed." Never say "escrow" or "held safely".

## Must be confirmed before Stage 5 (Sandbox)

| # | Item | Why it blocks | Default if unconfirmed |
|---|---|---|---|
| 1 | Platform Stripe account country | Connect availability, cross-border rules | **Stop** unless IE/EEA |
| 2 | Legal entity and country | Merchant of record, VAT, policies | **Stop** (needed for P0-2 anyway) |
| 3 | Partner countries | Cross-border transfer limits | IE only for the MVP; others blocked by configuration |
| 4 | Connect enabled and platform profile completed | Required to create accounts | Owner completes in the Dashboard (test mode) |
| 5 | Cross-border support | Only if non-IE partners | Disabled |
| 6 | Merchant of record | Separate charges make HelloCircle the merchant of record | HelloCircle as merchant of record (legal sign-off) |
| 7 | Statement descriptor | Customer recognition, dispute rate | "HELLOCIRCLE" + short activity suffix |
| 8 | `on_behalf_of` | Changes the merchant of record; outside this design | Not used |
| 9 | Tax/invoicing responsibility | Fee VAT invoices to partners; underlying-activity VAT | HelloCircle invoices fee + VAT. The partner is responsible for activity VAT |
| 10 | Contractual right to reverse transfers | Needed for refund/dispute recovery | Clause in the Vendor and Host agreements (Stage 4) before any live transfer |

## Keys and secrets

- Keys go only in `server/.env` (gitignored) or the server's protected env file. **Never paste them in chat.**
- At startup the server will **refuse `sk_live_`/`rk_live_` keys unless `APP_ENV=production` and an explicit
  `ALLOW_LIVE_STRIPE=true`** are both set (new guard).
- Connect webhooks need their own endpoint secret (`STRIPE_CONNECT_WEBHOOK_SECRET`) in addition to the account
  webhook secret.
