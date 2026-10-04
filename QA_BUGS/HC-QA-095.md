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

## Phase 13 — diagnostics added; not reproduced (2026-10-04)

Status: **OPEN — diagnostics in place, classification UNKNOWN** (not closed: no failure occurred to classify).

- **Diagnostics (app):** new `server/src/stripeDiagnostics.ts`. Every failed provider call (`checkout.create.<type>`, `customer.create`, `refund`) logs one structured line:
  `[stripe] <operation> failed category=<timeout|connection|rate_limit|authentication|permission|invalid_request|idempotency|card|provider_api|unknown> type=… code=… status=… request_id=req_…`
  - The Stripe `message` is **never** logged: it can echo request parameters such as an email.
  - Keys and payment details are never logged.
  - Every recorded value is shape-checked.
  - A bounded in-memory list (last 50) keeps recent failures.
- **Diagnostics (harness):** the test-only backend wrapper exposes that list at `/api/__qa/stripe-failures`; it isn't in the production app. The Stripe specs' six checkout assertions now use `expectCheckoutCreated()`. On a non-201 it records `hc-qa-095-<label>` evidence and puts the category, code and request ID into the assertion message.
- **Tests:** `server/src/stripeDiagnostics.test.ts` (5) uses real `stripe` SDK error classes. It proves the classification and that a message containing an email and a key-like string never reaches the log or the record.
- **Re-run:** `npm run qa:stripe` 3 consecutive times, Stripe TEST mode: **34/34, 34/34, 34/34**. No checkout-creation failure recurred, so there's still no evidence to tell APP BUG / TEST BUG / NETWORK / STRIPE TEST ENVIRONMENT apart. The next occurrence will be classified automatically.
