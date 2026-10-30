# 05 · Booking and Stripe TEST reconciliation

**Commit under test:** web `0998764` for the Stripe batches (run 06:19–06:39, between fix 2 and fix 3). Fix 3 (`d22f4a6`) only touches the partner message composer, so these results hold for `d22f4a6`.
**Environment:** isolated QA container `hello_circle_test_<runid>` on port 13316 (`QA_PORT_OFFSET=10`), freshly reset and seeded at 05:47.
- Stripe **TEST** keys only. The backend refuses to start unless `balance.livemode === false`, and blocks every outbound connection except `api.stripe.com:443` and the QA DB.
- Webhook secrets are per-run (Stripe CLI `listen`).
- **Paid production checkout was not enabled.** No live key was present.

**Command:**
```bash
QA_PORT_OFFSET=10 npm run qa:db:reset && QA_PORT_OFFSET=10 npm run qa:db:seed
QA_PORT_OFFSET=10 QA_ONLY_BATCH=<batch> npm run qa:stripe     # each of the 19 stripe batches, in suite order
```

## Result: 19 batches, **51 passed, 0 failed, 0 skipped**

| Required scenario | Test(s) | Result |
|---|---|---|
| Free booking (no provider) | STRIPE-PREFLIGHT (free, cash and zero-total bypass Stripe) | PASS |
| Successful paid booking, each model | STRIPE-PAY-HALL / -CLUB / -PROGRAMME / -EXPERIENCE / -ACTIVITY; STRIPE-UI-DESKTOP / -MOBILE | PASS |
| Failed payment | STRIPE-DECLINE; STRIPE-PROVIDER-ERROR | PASS |
| Abandoned checkout and expiry | STRIPE-EXPIRY (real provider expiry → hold released; replay no-op) | PASS |
| Expired quote, or a price changed after the quote | `commerce/engine.test.ts` "refuses to charge a price that changed after the quote"; STRIPE-R3A-PROGRAMME-COUPON (expired code refused) | PASS |
| Duplicate webhook | STRIPE-PAY-* replays; SANDBOX-WEBHOOKS-G; SANDBOX-DELIVERY-G | PASS |
| Delayed or out-of-order webhook | STRIPE-PAY-* (out-of-order expiry no-op); SANDBOX-WEBHOOKS-G | PASS |
| Signature checks | STRIPE-WEBHOOK-SIGNATURE; HC-QA-048 (no header → rejected outside production) | PASS |
| Capacity hold | STRIPE-CONCURRENCY (capacity 1, six parallel checkouts → one hold, one session, each model); STRIPE-LATE-SUCCESS | PASS |
| Concurrent bookings | STRIPE-CONCURRENCY, STRIPE-CONCURRENCY-ACTIVITY; browser BK-*-CONCURRENT; STRIPE-COUPON-SINGLE-USE | PASS |
| Sold-out options | `participation.test.ts` "refuses … over-limit quantities" and "the webhook's capacity re-check refuses an order whose hold lapsed while its option filled up" | PASS (server) |
| Cancellation | STRIPE-CANCEL-BEFORE-PAYMENT-*; HC-GAP-STRIPE-*; STRIPE-REFUND-VENDOR-CANCEL | PASS |
| Refund (full) | STRIPE-REFUND-HALL, STRIPE-REFUND-CONCURRENT (four parallel → one provider refund), HC-QA-091-* (already refunded at Stripe → reconciled once) | PASS |
| Partial refund | Only where enabled. SANDBOX-MONEY-D and SANDBOX-SPLIT (admin finance, partial refund before and after transfer); HC-QA-091-PARTIAL (outside refund is not guessed at). Per-person partial cancel stays **locked** (`participation.partial_cancel`) and wasn't enabled. | PASS / not enabled |
| Rescheduling | BK-CENTRE-LIFECYCLE (reschedule, rebook); OG-19-DEPARTURES (customer-asked move) | PASS (unpaid paths) |
| Immutable order lines | `engine.test.ts` "immutable snapshot that matches the charge" and "history keeps its price"; `participation.test.ts` "receipt lists the purchased lines with their frozen prices" | PASS (server) |
| VAT and fee snapshots | SANDBOX-MONEY-B-H (fee snapshot → actual Stripe fee); SANDBOX-SPLIT snapshot | PASS |
| Ledger reconciliation | SANDBOX-RECONCILE: local records match Stripe **to the cent** | PASS |
| Suspended organisation, late payment | STRIPE-D10-4B, STRIPE-D01-HELD, STRIPE-D11-RECHECK, STRIPE-D11-DISPUTE | PASS |

## Independent reconciliation (worked example from SANDBOX-SPLIT)
One €40.00 game at a venue, hosted by a resident host, with a 66.67% venue split:

| Item | Expected (computed independently) | Recorded by the test |
|---|---|---|
| Net price | 4000 c | 4000 c |
| VAT 23% on net | 4000 × 0.23 = **920 c** | 920 c |
| Platform fee 5% on net | 4000 × 0.05 = **200 c** | 200 c |
| Customer total | 4000 + 920 + 200 = **5120 c** | 5120 c charged at Stripe |
| Venue share | 4000 × 0.6667 = 2666.8 → **2667 c** (1 c rounding to the venue) | 2667 c |
| Host share | 4000 − 2667 = **1333 c** | 1333 c |
| Transfer allocations | sum = venue settlement net | asserted equal |
| Partial refund after the venue transfer | the host had no transfer, so nothing is reversed; host debt 333 c stays open; one venue reversal | asserted |

Capacity and attendee counts are checked in the same specs: one hold per place under concurrency, and heads reconcile with lines (`participation2.test.ts` "heads reconcile with lines and capacity").

**Note on VAT:** the 23%-on-net plus a 5% fee model is the existing `pricing.ts` behaviour. The tests check that it's computed consistently; they don't decide that it's the right Irish VAT treatment for each listing type. That's an accountant decision (gate 14).

## SANDBOX-SPLIT: separate result and investigation
- **Result:** **PASSED** on the fresh database of this run (06:35:11). It ran after 200+ other batches on the same DB, none of which gave these two partners a transfer.
- **Why it can only pass once per database:** the spec asserts, as a precondition, that its two partners (QA_VENDOR_B's organisation and QA_HOST) start with **no `transfers` rows** (`stripe-sandbox-split.spec.ts:50-51`). Its debt assertions depend on that ("host had no transfer: nothing reversed").
  - Its `cleanParty` cleanup deliberately never deletes money rows (`transfers`, `transfer_reversals`, ledger entries), because they are append-only by design.
  - So after one run, the precondition is false on the same DB, and the spec stops with its own message: "provision a fresh QA database".
- **Verdict:** the **test is non-idempotent by contract**, not the application.
  - The application behaviour it relies on, immutable money records, is correct and intended.
  - No state-management defect was found: the re-run transfer call transfers nothing twice (line 142), and refunds after transfer create reversals or debts exactly once.
  - The test wasn't skipped or weakened.
- **Recommendation (P3, test harness):** make the spec create its own fresh synthetic venue organisation and host per run, so it can be re-run without a reset. Not done here: it's a harness change, not a defect.

## Findings
- **No payment corruption, double charge, double refund or capacity leak** was observed in any of the 51 Stripe TEST tests or in the booking batches.
- **No payment business rule** was changed during this validation.
