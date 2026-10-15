# HelloCircle — Completion validation (2026-10-14)

_Validation of the UI-completion work in `hellocircle-ui-completion.md` (first pass and the same-day second pass).
Everything ran locally against the **guarded disposable environment**:
- a Docker MySQL database per QA run (`qa_d925d1322c536fbe` for the final run)
- fresh backend per batch
- real login rate limiter
- QA personas with `example.test` addresses
- Stripe **test mode** only
- no SMTP (emails are logged, not sent)

Nothing touched `hello_circle_dev`, `hello_circle`, staging or production. Nothing was committed, pushed or deployed.
No real payment, refund or payout was made._

Result key: **PASS** = ran and passed against the real stack; **FAIL** = ran and failed; **BLOCKED** = can't run
here, with the reason; **NOT TESTED** = in scope but not exercised.

---

## 1. Final run on the final code (second pass)

One scripted run, in order: type checks, unit tests, harness tests and build, then the eight browser/permission
suites, then `qa:db:reset` + `qa:db:seed` (clean isolated data), then the complete Stripe test-mode suite.

### 1a. Static checks and unit tests

| Check | Result |
|---|---|
| `tsc` client, server, `tests/` | PASS |
| Client production build | PASS (existing >500 kB mapbox chunk warning) |
| Server Vitest (isolated container profile) | PASS: **865 passed, 23 skipped** (888) |
| Client Vitest | PASS: 270 |
| Harness self-tests (`qa:check`) | PASS: 97 |

### 1b. Browser and permission suites (real stack, Chromium)

| Suite | Result | Passed | Skipped (why) |
|---|---|---|---|
| `qa:auth` | PASS | 20 | — |
| `qa:authorization` | PASS | 83 | — |
| `qa:security-gate` | PASS | 39 | — |
| `qa:product` | PASS | 68 | 1: PERF-P13 only measures the production build (`QA_PROD_BUILD=1`), which wasn't used, so it's **NOT TESTED** here |
| `qa:validation` (all six completion batches) | PASS | 18 | — |
| `qa:booking` | PASS | 38 | 2 by design: each REM-046 variant runs in its own limiter batch and skips in the other, so both ran and passed |
| `qa:lifecycle` | PASS | 52 | — |
| `qa:revenue` | PASS | 38 | — |

**356 passed, 0 failed.** Passing permission suites show the server enforces **today's** rules, not that those rules
are right (`hellocircle-operating-decisions.md`, D-01 to D-11).

### 1c. Stripe test mode — full suite on clean data (reported separately from reruns)

**Full run:** 38 passed, **1 failed** (`SANDBOX-CONNECT-A`). The runner stops a suite at the first failed batch, so the
seven batches after it (money, disputes, billing, webhooks, split, delivery, reconcile) **did not run in the full
run**.

**Why CONNECT-A failed:** after a partner returns from Stripe's hosted page *without finishing*, the test expected the
payout state `onboarding_incomplete`. It got a different state because Stripe hadn't listed the account's requirements
yet. Stripe computes them lazily, and it reports transfers as "pending" both before anything is submitted and while it
reviews a submission. In that case the app, which since the first pass counts "returned from Stripe" as having
submitted, shows **Under review**. Earlier runs passed only because Stripe had listed requirements by then. The real
risk for partners: someone who left Stripe's pages early could be told Stripe is checking their details, with no way
back.

**Fix (client):** while onboarding hasn't completed, the payout card keeps **Continue setup with Stripe** available in
the under-review state, with a one-line explanation (`PayoutAccountCard.tsx`). The server's state model is unchanged.
The spec now asserts the partner-relevant invariant: the state is `onboarding_incomplete` or `under_review`, and
Continue is offered.

**Individual reruns after the full run** (same clean data, `QA_ONLY_BATCH=…`, final code):

| Batch | Result |
|---|---|
| stripe-sandbox-money | PASS (2) |
| stripe-sandbox-disputes | PASS |
| stripe-sandbox-billing | PASS |
| stripe-sandbox-webhooks | PASS |
| stripe-sandbox-split | PASS |
| stripe-sandbox-delivery (real Stripe CLI deliveries, incl. paid checkouts through the agreement check) | PASS |
| stripe-sandbox-reconcile | PASS |
| stripe-sandbox-connect (with the fix above) | PASS |

So every Stripe batch had passed on the final code, but not in one uninterrupted run.

**Uninterrupted clean runs afterwards (2026-10-14, after the suspend-dialog copy fix; `qa:db:reset` + `qa:db:seed`
before each):**

| Attempt | Result |
|---|---|
| 1 | Stopped after 6 batches: 24 passed, **1 timed out** (HC-QA-091-PROGRAMME, the "payment already fully refunded at Stripe" reconciliation, 5-minute limit). Re-run on its own straight after: all 6 tests in that batch PASS. It also passed in both earlier full runs, with no relevant code change, which points to intermittent Stripe test-mode latency. The harness withholds diagnostics, so which step stalled wasn't seen |
| 2 | **PASS: 47 passed, 0 failed, 0 skipped, all 18 batches, one uninterrupted run** |

Open point: HC-QA-091-PROGRAMME timed out once in four full or batch runs. Worth watching; if it recurs, add step
markers (as was done for COMPLETE-HOST) to find the slow call.

### 1d. Changes after the 1b run, and what was re-run

- **Payout card "Continue setup" (above):** re-ran `revenue-partner` (6/6 PASS), client tests and the build.
- **Copy fix in the payment-event investigation text** (it quoted the customer message wrongly): re-ran
  `validation-completion-c` (3/3 PASS).

## 2. What each new check verifies

### Second pass
| ID | Verifies | Result |
|---|---|---|
| COMPLETE-QUEUES | Claim record opened from a **filtered** queue with Claim and Partner account statuses; related-record buttons; the approve confirmation states the ownership consequence; Back restores the search. Host application by direct URL; Decline confirmed; the page shows the decided state and the DB says `rejected`; after reload the URL explains it can't be reopened. Place suggestion from the "all" view; Back keeps `view=all` and the search. | PASS |
| COMPLETE-FINANCE | A parked `checkout.session.completed` (reconciliation mismatch) opens from Payment events as a record: Needs review status, the stop reason, the **investigation path** ("no override"), Replay offered. Its order record shows Payment, Refunded, Disputes and Release separately, with "No payment recorded". Back returns to the events list still filtered to *Needs review*. An unknown finance record shows the missing state. | PASS |
| COMPLETE-REVIEW-STATE | A pending pass with a checkout agreement and a parked mismatch event: the customer's confirmation page (mobile) says "Your payment needs a quick check", never "You're all set!". A failed status request shows "We couldn't check your payment just now" with **Check again** (**UI interception**, one request); retry reaches the real server; the DB row stays `pending`. | PASS |
| COMPLETE-FORMS | Centre editor: "Fields marked * are required"; `required` on controls; a failed validation focuses the summary (4 problems, since the fixture centre has no area/county), opens the collapsed Location section, sets `aria-invalid` and `aria-describedby`, and summary links focus their field; editing clears only that field's message. A server failure (**UI interception**) keeps every typed value and puts the reason in the summary; **two clicks send one request**; the sidebar's Overview link asks "Leave without saving?" and **Keep editing** stays. | PASS |
| COMPLETE-MENUS | Host row: the main action stays visible. Keyboard: ↓ opens on the first item, End goes to the last, ↓ wraps, Escape closes and focus returns to the menu button. At 390×844 the menu sits inside the viewport. An outside click closes it. | PASS |
| COMPLETE-SILENT | Experience page with the credit check and the review-eligibility check failing (**UI interception**): the credit check failure is "couldn't check… pay by card" and the credit option isn't offered; the eligibility check failure is "couldn't check whether you can review" and not the "not eligible" text. Both retries reach the real server. | PASS |
| HC-QA-069-ADJACENT (updated) | Host cancel now goes through the row menu by keyboard; the confirm traps focus; Escape returns focus to the menu button | PASS |
| REV-ADMIN-B-DEBT (updated) | A transfer's allocations show on its record page (was a modal); the partner-debt flow is unchanged | PASS |

### Server tests added in the second pass (`checkoutAgreement.test.ts`, now 9)
These go through the real event store, the same steps the webhook route takes:
- A mismatch is **parked** (acknowledged, so Stripe stops retrying), never marks the order paid, creates no payment
  record, and `paymentUnderReview()` reports it.
- A **redelivery** of the same event is acknowledged as a duplicate without reprocessing (attempts stay 1).
- A **second event for the same session** (`async_payment_succeeded`) parks too.
- An **admin replay** re-checks against the same agreement and parks again: there's no override path.
- A matching payment confirms and isn't flagged.

### First pass (kept for the record; all re-ran green in §1)
COMPLETE-ADMIN, COMPLETE-PARTNER, COMPLETE-HOST, COMPLETE-RESIDENT and HC-QA-066-VENDOR: record pages with return
context, confirmations, missing, failed and signed-out states, the mobile sections menu. Details are in
`hellocircle-ui-completion.md`.

## 3. Payment review state — what was confirmed

| Requirement | Evidence | Result |
|---|---|---|
| A mismatched payment event can't mark the order paid | unit (real DB) + COMPLETE-REVIEW-STATE (DB still `pending`) | PASS |
| It leaves a discoverable operational record | the event is in Finance → Payment events → *Needs review* (default filter); the admin overview shows **Payment events needing review** (finance/super); the record page shows the reason | PASS (the overview metric is code-reviewed, not separately browser-tested) |
| The customer sees an accurate state | "Your payment needs a quick check", not booked, don't pay again | PASS |
| Retries and duplicates are safe | unit: parked → acknowledged; redelivery is a duplicate; a second event parks; replay re-parks | PASS |
| There's a documented investigation path using existing operations | the event page's five steps + `hellocircle-operating-decisions.md` (Dashboard refund) | PASS (documented) |
| No override bypasses verification | none added; replay re-verifies | PASS |
| **Gaps (not built; decisions)** | the place stops being held after 30 minutes (D-10); there's no in-app close-out after a Dashboard refund (D-11) | open |

## 4. The 23 skipped server tests

All 23 are gated on `HC_LIVE_PROVIDER_TESTS=1`. They need **real Cloudflare R2 / Cloudinary credentials**, which the
isolated test profile deliberately scrubs.

| File | Skipped | What they cover |
|---|---|---|
| `routes/media.test.ts` | 20 | Real R2 upload authorisation for one's own avatar, host, organiser, org owner and same-org member, and club org; content-type validation against live R2; `release` refusing a URL from another entity (403) or one still in use (409); `finalize` validating real uploads; signed GET redirects for members/organisers and variant signing; the local-processing upload route |
| `routes/adminMedia.test.ts` | 2 | Cloudinary reported as configured; the Cloudinary runtime switch round-trip |
| `routes/residents.test.ts` | 1 | Attaching an avatar URL under the resident's own R2 key prefix |

**Launch impact:** none of these cover booking, payment, refund, payout or permissions outside media. They **do**
cover media upload authorisation, including the cross-entity release refusal (an earlier session fixed a real
cross-tenant delete bug in that area). Before launch, run them once against a **test** R2 bucket and Cloudinary
account (`HC_LIVE_PROVIDER_TESTS=1` with test credentials, never production). Until then, media upload security
against live R2 counts as **NOT TESTED** here.

## 5. Mock and interception boundaries

- **UI interception (Playwright `page.route`)** only injects one failed or slow response to show an error or
  in-flight state: bookings list and receipt (first pass); centre save, payment status, credit check and review
  eligibility (second pass); plus VAL-UX-ERRORS. These verify **the UI's handling**, not the server's failure path.
- **Synthetic rows:** COMPLETE-QUEUES, COMPLETE-FINANCE and COMPLETE-REVIEW-STATE insert their records (claim,
  pending host application, suggestion, parked webhook event, agreement, pending pass) straight into the isolated DB
  and remove them afterwards. Creating them through their real flows needs other actors or a real mismatched Stripe
  charge. Everything the browser then does goes through the real server.
- **Provider stub:** the revenue and booking-provider batches use the harness's Stripe stub. Only `qa:stripe` talks
  to Stripe (test mode).
- **Email:** no SMTP; nothing is sent.

## 6. Blocked / not tested

| Area | Status | Why / what unblocks it |
|---|---|---|
| Google sign-in | BLOCKED | Firebase isn't configured in QA |
| Maps (Mapbox) | BLOCKED | Map token disabled in QA; list views tested |
| Email delivery and templates in an inbox | BLOCKED | No SMTP by design |
| Cloud media (R2 / Cloudinary), incl. the 23 live-provider server tests | BLOCKED | No provider credentials in QA; see §4 |
| Hosted Stripe Connect onboarding completion | BLOCKED | Needs a person to solve hCaptcha (not bypassed). The exact manual steps and the tests to re-run afterwards are in `hellocircle-operating-decisions.md` → external configuration |
| One uninterrupted green `qa:stripe` run on final code | PASS | §1c: second clean attempt, 47/47, 18 batches (first attempt had one timeout) |
| Firefox / Safari / real devices | NOT TESTED | Chromium only, at 1440 / 820 / 390 |
| Screen reader (VoiceOver / NVDA) | NOT TESTED | Automated role, name, focus and heading checks only |
| Production-build performance (PERF-P13) | NOT TESTED | Needs `QA_PROD_BUILD=1` |
| Admin overview "Payment events needing review" metric in a browser | NOT TESTED | Code-reviewed; the endpoint behind it is covered |

## 7. Defects found and fixed

**First pass**
1. `Button` dropped `aria-*` props (TypeScript doesn't check hyphenated props).
2. A stray "0" next to booking actions (MySQL `0` in `{x && …}`).
3. Two Stripe Connect onboarding defects and the webhook reconciliation gap.
4. The resident `NavSidebar` slid in from the side.
5. A timing race in the `SANDBOX-DELIVERY-G` spec.

**Second pass**

6. **The centre, club and experience editors had no load-failure handling.** A failed load left a blank, saveable
   form that could overwrite the real listing. They now show a load error with retry instead of a form.
7. Adding or editing a room swallowed failures; room Save could be double-submitted.
8. Partner listing table rows had four **icon-only buttons with no accessible name**.
9. The reviews list had no failure handling, and the review form's inputs had no labels.
10. A failed payment status check said "We couldn't find that booking".
11. The **Stripe dashboard button** showed for v2 accounts that hadn't finished onboarding, where the server always
    refuses (409).
12. The **ambiguous under-review state after an abandoned Stripe onboarding** (§1c) left no way to continue.
13. Two former silent failures (credit balance, review eligibility); see the UI completion doc §4.

## 8. Evidence

- Screenshots: `docs/hellocircle-ui-completion/` (27 PNGs; QA personas and synthetic data only).
- Sanitised results: `.qa-data/qa_d925d1322c536fbe/evidence/` (final run up to the Stripe reset), and the run
  directory created by that reset for the Stripe suite and reruns. Both are gitignored.
- The harness withholds raw diagnostics by design. `QA_ONLY_BATCH=<name>` re-runs one batch under the same guards.
