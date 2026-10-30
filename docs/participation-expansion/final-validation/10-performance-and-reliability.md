# 10 · Performance and reliability

**Environment for every number below:**
- one MacBook;
- the isolated QA stack: the API through `tsx` (development server, not a compiled production build), MySQL 8 in a local container, and the client on the Vite dev server;
- for PERF-P13 only, the **production client build** served by `vite preview`.

These are **measurements on a local stack, not production capacity figures.** Nothing here claims an improvement: there is no before/after.

## 1. Server response times: new batch `booking-final-perf` (FINAL-PERF, **PASSED**)
- **Data:** a synthetic club with a published 5-question form (select, radio, checkbox, long text, text), then **30 registrations** made through the real checkout API.
- **Sampling:** 30 sequential samples per path after one warm-up; exports and messages had 10.
- **Timing:** wall time measured at the client. Raw data: `.qa-data/final-perf.json`, measured 2026-10-30 04:07 UTC.

| Operation | Endpoint | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
| Explore loading | `GET /api/discover` | 4 | 6 | 7 |
| Search | `GET /api/search?q=QA` | 11 | 17 | 21 |
| Listing detail with its form | `GET /api/clubs/:id` | 8 | 11 | 12 |
| Registration submission (validated answers, one transaction) | `POST /api/registrations/checkout` | 13 | 17 | 20 |
| Booking confirmation | `GET /api/registrations/status/:ref` | 2 | 3 | 4 |
| Attendee and answer list (30 people) | `GET /api/vendor/forms/club/:id/answers` | 17 | 21 | 22 |
| Door check-in | `POST /api/vendor/checkin/registration/:ref` | 3 | 4 | 4 |
| Report generation (90 days, whole organisation) | `GET /api/vendor/reports/participation` | 32 | 40 | 43 |
| Report detail (one listing) | `GET …/participation/detail` | 4 | 6 | 8 |
| Report export (CSV) | `GET …/participation.csv` | 31 | 37 | 37 |
| Answers export (CSV, 30 rows) | `GET …/answers.csv` | 15 | 17 | 17 |
| Message preview (30 recipients) | `POST /api/vendor/messages/preview` | 3 | 4 | 4 |
| Notification processing: send to 30 | `POST /api/vendor/messages` | 54 (single) | | |

**Integrity checks inside the same run:**
- 30 registrations made 30 distinct references, with **no duplicate rows**.
- 4 answer rows per registration: the empty optional answer isn't stored, by design.
- The answers CSV had exactly 30 data rows.
- Message delivery: 30 e-mail deliveries recorded as `skipped_no_transport`. The QA backend has no mail transport, so nothing left the machine.
- **Concurrency:** 20 parallel report reads returned 20 × `200` in 133 ms wall time.
- **Memory:** backend RSS went from 244 MB to 355 MB over the run. That's a dev server compiling on demand, so it isn't a leak test.

## 2. Page loading on the production client build: PERF-P13 (**PASSED**, `QA_PROD_BUILD=1`)
**Conditions:** CPU throttled 4×, 150 ms added latency.

**Layout shift (CLS) per route:**

| Route | Mobile 390 | Desktop 1440 |
|---|---|---|
| Home | 0 | 0.008 |
| Explore | 0.046 | 0.043 |
| Games | **0.098** | 0.028 |
| Circles | 0 | 0.008 |
| Activity detail | 0.006 | 0.014 |
| Login | 0 | 0 |
| My Life | 0.001 | 0.010 |
| Profile | 0.035 | 0.044 |

**Findings:**
- **Layout shift:** every route is under the 0.1 "good" CLS threshold. /games on mobile is close to it.
- **No unauthorised API calls** on any route.
- **Duplicate API calls (P3, DEF-08):**
  - `/circles` loads `/api/circles` twice;
  - My Life loads `/api/residents/me` and `/api/residents/me/participation` twice;
  - Profile loads `/api/residents/me` twice.

  Wasteful, not incorrect. Pre-existing pages, unchanged by this work.

## 3. Reliability investigations

| Area | Result | Evidence |
|---|---|---|
| Database locking and capacity | No overbooking under concurrency | BK-*-CONCURRENT, STRIPE-CONCURRENCY (6 parallel checkouts per model), HC-QA-041 (pending holds count against capacity) |
| Duplicate writes | None | FINAL-PERF (distinct refs); STRIPE-REFUND-CONCURRENT (4 parallel refunds → 1); HC-QA-046 (concurrent cancels → one change, one notice); message idempotency key |
| Long-running queries | None observed | Every path p95 ≤ 43 ms on the dataset above. Reports are bounded (detail 20,000 rows, form checks 1,000, both with `truncated` flags). The per-order loops in reports are O(orders) small queries: fine at pilot scale, and the first thing to batch at larger scale. |
| Queue retries | Bounded | Partner messages retry up to 3 attempts; webhook events are stored once and replayable (SANDBOX-WEBHOOKS-G) |
| API timeouts | None in the participation batches | The 9 browser timeouts in the regression are all baseline failures (same test on `f22294f`); see [11](11-defects-and-remediation.md) |
| Background job failures reach the error reporter | **Yes** | `a84b302`: the 9 scheduled sweeps call `reportException` (scrubbed `[error-report]` line, plus the optional webhook). Server suite passes. |
| Reminder sweep at scale | **Defect DEF-03** | More than 200 due in one day may starve; the feature is off |
| Rate limiting | Works, and is per process | Observed during this validation: repeated staff sign-ins in one spec were refused by the login limiter. That's correct behaviour, and the spec was restructured. In-memory and single-instance (known). |

## Commands
```bash
QA_PORT_OFFSET=10 npm run qa:db:reset && QA_PORT_OFFSET=10 npm run qa:db:seed
QA_PORT_OFFSET=10 QA_ONLY_BATCH=booking-final-perf npm run qa:booking
QA_PORT_OFFSET=10 QA_PROD_BUILD=1 QA_ONLY_BATCH=product-perf-p13 npm run qa:product
```

## Gate 11 (reliability)
**PASS for pilot scale, with DEF-03 open** (reminders stay off). **Not measured:** production hardware, multi-instance deployment, sustained load beyond 20 parallel requests.
