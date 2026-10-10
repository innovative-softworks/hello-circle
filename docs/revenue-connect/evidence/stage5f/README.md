# Stage 5f browser evidence

Captured by the browser specs during the final combined gate (2026-10-10 19:48–19:53 UTC, fake payment provider,
disposable QA database `hello_circle_e2e_qa_bf116a75118810bc`). QA personas and `example.test` addresses only.
Downscaled JPEG copies; the full-size originals stay in the QA run's `evidence/stage5f/` folder (not in git).
Each state is captured at desktop (`-desktop`) and mobile 390 px (`-mobile`).

| File | State | Spec |
|---|---|---|
| `free-dashboard` | Free, standard VAT 23%, progress toward a free month | `revenue-plan` |
| `pro-details` | Pro details: comparison, exact price + tax, test-card hint, terms | `revenue-plan` |
| `processing` | Back from Stripe before the webhook: "Confirming your payment" | `revenue-plan` |
| `paid-active` | Paid Pro active | `revenue-plan` |
| `cancelling` | Cancelling, "Keep Pro" | `revenue-plan` |
| `payment-failed` | Renewal failed, grace days, "Update payment method" | `revenue-plan` |
| `rewards-eligible` | 10,000 points + pending points; redemption available | `revenue-rewards` |
| `reward-month` | Reward-funded Pro month | `revenue-rewards` |
| `rewards-history` | History: redemption, host split share | `revenue-rewards` |
| `points-debt` | Points debt blocks redemption, with the reason | `revenue-rewards` |
| `reverse-charge` | Reverse-charge partner's Pro price | `revenue-rewards` |
| `credit-wallet` | Customer credit wallet | `revenue-credit` |
| `checkout-coupon-credit` | Coupon + credit, card payment due "none needed" | `revenue-credit` |
| `credit-used` | Wallet history after the booking | `revenue-credit` |
| `admin-switch-refused` | Invalid switch combination refused, prerequisite named | `revenue-plan` (admin) |
| `admin-credit-grant` | Credit grant with currency, funding owner, expiry; outstanding credit | `revenue-plan` (admin) |
