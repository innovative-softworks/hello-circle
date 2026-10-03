# HC-QA-048 — Unsigned Stripe webhook accepted and confirmed a booking outside production

Severity: P1. Category: SECURITY / WEBHOOK. Status: FIXED LOCALLY — NOT DEPLOYED.
Found in Phase 9 (Stripe TEST mode, isolated QA environment, 2026-10-01). No live keys, no live money.

- **Expected:** Any request to `/api/stripe/webhook` without a `Stripe-Signature` header is rejected (400) whenever a signing secret is configured.
- **Actual (before):** With the secret configured but the header missing, the handler fell through to the "dev: accept unverified" branch. In any `NODE_ENV` other than production (QA, staging, a mis-set deploy), a forged `checkout.session.completed` with `payment_status: "paid"` was accepted (200) and marked a pending club registration **paid without any payment**. In production it returned 503 (no mutation).
- **Financial invariant:** Forged paid confirmation: a booking marked paid with no money taken.
- **Fix:** Reject a missing signature with 400 when `STRIPE_WEBHOOK_SECRET` is set (`stripeWebhook.ts`). The documented local-dev mode with no secret configured is unchanged.
- **Verification:** Red: `{status:200, paymentStatusAfter:"paid"}`. Green: `{status:400, paymentStatusAfter:"pending"}`. Test: `HC-QA-048` in `stripe-findings.spec.ts`.
