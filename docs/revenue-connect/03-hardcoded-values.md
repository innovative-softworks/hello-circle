# 03 — Hardcoded-values inventory (delta)

The full inventory is in `docs/commerce-hardcoded-values.md` (H1–H25, C1–C7). This page records the **current
status** and the **values the new brief adds**.

## Still hardcoded on live paths

| Value | Where | Becomes |
|---|---|---|
| VAT 23% (customer-facing, added on top) | `pricing.ts:5`, `client/src/api/public.ts:291` | `tax_rules` (effective-dated). Under the new model there's no VAT added on top; VAT applies to the **platform fee** |
| 5% customer platform fee | `pricing.ts:8`, client | Removed (the brief: no customer fee). The plan's success fee replaces it |
| €100 deposit | `bookings.ts:52`, `BookingFlow.tsx:49` | Rule value (already in `pricing` rule v1). The deposit model is per §8E |
| Day rate 6.5× / 8h | `bookings.ts:48`, `BookingFlow.tsx:160` | Rule value (already in rule v1) |
| 30-minute hold | `bookingIntegrity.ts:14` | Rule value (already in the `checkout` rule) |
| 48h cancellation default | `db/queries.ts:509` | Cancellation policy configuration (§21.6) |
| "Refunded within 5 days" text | `checkoutService.ts:67` | Policy/help content |
| `currency: "eur"` | `checkoutService.ts:149` | Order currency |
| Labels "VAT (23%)", "Platform fee" | `checkoutService.ts:63-65`, `BookingFlow.tsx:675`, `RegistrationFlow.tsx:640` | Generated from the resolved rule |
| Privacy/Cookie page text, contact placeholders | `PrivacyPolicy.tsx`, `CookiePolicy.tsx` | Policy CMS |
| `TERMS_VERSION = "2026-09-25"` | `terms.ts` | `policy_versions` |
| Help guide copy | `pages/helpGuide/*` | `help_articles` |

## Already configurable on this branch (versioned rules)

`customerFeeBps`, `successFeeBps`, `vatBps`, `vatMode`, `paymentCostBps/Fixed`, `venueDepositMinor`, `dayRate*`,
`pendingHoldMinutes`, `cancellationHours`, `bookingWindowDays`, plus the coupon funding and limits per coupon.

## New values the brief requires (none exist today)

| Group | Values |
|---|---|
| Plans | Free: success fee 9%, minimum fee €0.75. Pro: €29/month ex VAT, 7%, minimum €0.50. Enterprise (flagged off) |
| Plan rules | Upgrade timing (immediate or next booking), downgrade at period end, grace period 7 days |
| Tax | VAT rate 23% (effective-dated), VAT modes (standard, exempt, reverse charge), tax-inclusive display |
| Payment costs (estimates) | EEA card 1.5% + €0.25, Connect payout 0.25% + €0.10, monthly active account fee, instant payout 1.25% (min €0.75), FX and cross-border pass-through |
| Settlement | Review period 48h after completion, weekly payout, minimum payout €25, carry-forward |
| Reserves | Refund reserve, dispute reserve, margin-warning thresholds |
| Rewards | 1 point per €1 settled GMV, 10,000 points = 1 free Pro month, 18-month expiry |
| Credits | Expiry per credit type, terms version |
| Coupons | Budget cap, stacking, eligibility (roles, categories, listings, customers, new-customer-only), timezone, approval |
| Availability | Countries and currencies (IE / EUR for MVP) |
| Promotions | Founding partner: Pro waived 90 days for the first 20–30 approved partners |

All of these become versioned configuration with the draft → review → approve → schedule → publish → retire
workflow. **Rounding:** half-up per component on integer cents. It's proven identical to legacy maths from €0 to
€50k, and produces every value in the brief's test vectors (see 07 §Calculation).
