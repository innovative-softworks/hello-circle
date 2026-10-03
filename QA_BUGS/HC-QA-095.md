# HC-QA-095 — Stripe TEST gate fails intermittently at checkout creation; the provider error isn't captured

Severity: P3. Category: QA-INFRA / PAYMENTS (test reliability). Status: OPEN — recorded only (Phase 11A, 2026-10-03).

**Observed across the Phase 11A full runs of `npm run qa:stripe`** (same code each time):

| Run | Result |
|---|---|
| 1 | 32/32 |
| 2 | `STRIPE-PAY-PROGRAMME` failed |
| 3 | `STRIPE-CHECKOUT-AMOUNTS` failed: "hall checkout", expected 201, received **400** |
| 4 | 32/32 |

The failing tests differ between runs. Neither touches code changed in Phase 11A: the HC-QA-091 change is in the refund path only, and checkout creation is unchanged. A direct probe of the Stripe TEST API from the same machine right afterwards succeeded 5/5 in 0.4–1.0 s. Earlier phases saw the same gate fail on external timeouts (Phase 10: hosted-page and backend-start timeouts).

**Why it matters:** 400 is what `createCheckoutSession()` returns when the Stripe API call throws ("Couldn't start checkout — please try again"). The harness evidence doesn't record the provider error *class* (timeout, rate limit, API error), so an intermittent provider fault can't be told apart from an application regression without rerunning.

**Recommendation (not applied):**
- Have the guarded harness record the Stripe error type/code (never the message body or keys) when checkout creation fails.
- Optionally give the server a structured `[stripe] checkout create failed type=<…> code=<…>` log line.
- Treat a single-test checkout-creation 400 as a provider-side candidate only after the error class confirms it.
