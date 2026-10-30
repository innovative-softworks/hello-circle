# 08 · Communications, reminders and reporting

**Commit:** web `d22f4a6`.
**Test routing:**
- The QA backend has no SMTP and blocks all outbound connections except the QA DB (and `api.stripe.com` in the Stripe profile).
- Mail is recorded only as safe facts: recipient, subject and link origins, never bodies (`tests/integration/backend.ts`).
- Partner message e-mail to a non-test address is **held** outside production (`held_test_environment`).
- **No real person received anything.** All recipients are synthetic `@example.test` personas.

## 1. Partner messages (Phase K)

| Check | Result | Evidence |
|---|---|---|
| Correct audience (confirmed people of the chosen listing, by session or attendance) | PASS | Browser CFG-MESSAGES (after fix `d22f4a6`): the resident with a booking gets the in-app message; `vendorMessages.test.ts` "previews confirmed people once each, by session and attendance" |
| Correct booking and organisation | PASS | `audienceFor()` resolves only `ownedListing(req.vendorIds, …)`. Another organisation gets 403 (unit test, and the FINAL-SEC browser probe for preview and send) |
| Approved templates | PASS | `vendorMessages.test.ts` "refuses an unfinished template" (bracketed placeholders) |
| Send to myself | PASS | "'send me a test' reaches only the sender"; CFG-MESSAGES |
| Delivery status | PASS | "history shows delivery status; other organisations see none of it" |
| Retry handling | PASS | "retries a failed delivery, at most three attempts" (`MAX_ATTEMPTS`) |
| Duplicate prevention | PASS | "sends once per idempotency key"; `UPDATE … status IN ('queued','failed')` claims each delivery once |
| Failure reporting | PASS | Per-delivery `failed` status with an attempt count; background sweeps report through `reportException` (`a84b302`) |
| Cancellation behaviour | PASS | Audiences include confirmed (not cancelled) orders only (preview test) |
| Communication preferences | **POLICY OPEN** | `organiser_message` has no preference key in `PREF_KEY_BY_KIND` (`server/src/notifications.ts:59`): partner messages are treated as service messages about the person's own booking and always delivered in-app. This matches doc 22's stated model, but the consent model isn't approved (legal blocker 5 in [07](07-privacy-and-governance.md)). |
| Audit | PASS | `vendor_message.sent` with listing, recipient count, template and filter; never recipients or text |

## 2. Day-before reminders (Phase K): switch `participation.reminders`
**Where it ran:**
- **Switched on only inside the disposable server-test database** (`bookingReminders.test.ts`).
- There is no API to trigger the sweep, so it wasn't exercised through the browser harness.
- **The production default stays off:** `featureOn()` treats a missing row as false, and nothing in this branch writes the row.

| Check | Result | Evidence |
|---|---|---|
| Off by default: sends nothing | PASS | "does nothing while the switch is off" |
| Correct timezone and scheduled day | PASS (code review) | "tomorrow" = `irelandTodayIso()` + 1 day; session dates are Ireland wall-clock dates. No DST-boundary test exists (**missing coverage**). |
| No duplicate sends | PASS | A second sweep the same day sends nothing new (unit test) |
| Cancelled bookings excluded | PASS | Unit test; queries exclude `status = 'cancelled'` and cancelled sessions |
| Changed sessions | PASS (code review) | Reads the session's current date at sweep time, so a moved session reminds for the new date. The dedupe key includes the date. No test (**missing coverage**). |
| Retry behaviour | PARTIAL | A failure throws out of the sweep; the next 5-minute sweep picks up what wasn't sent. No explicit test. |
| Opt-out | PASS | "honours the setting" (`bookingReminders` preference) |
| **More than 200 due in one day** | **FAIL: DEF-03 (P2)** | `sweepBookingReminders` takes `slice(0, 200)` of all due rows **before** skipping those already reminded, with no `ORDER BY`. Once the first 200 are reminded, later sweeps keep re-selecting them and may never reach the rest. Not reachable while the switch is off. Fix: filter already-sent rows in SQL (or before slicing), then add a test with >200 due. |
| Guests (no resident account) | By design | Guests aren't reminded; their confirmation e-mail has the date |
| Cash-on-arrival orders | Note | Only `payment_status = 'paid'` orders are reminded. Free and cash paths are recorded as `'paid'`; pending online checkouts aren't reminded (correct). |

**Gate status:** reminders stay **disabled**; enabling them is **blocked** by the consent decision and DEF-03.

## 3. Reporting (Phase L)

### Deterministic dataset, expected vs actual
`server/src/routes/vendorReports.test.ts` builds a fixed synthetic dataset for organisation A:
- one hall with a confirmed booking (6 guests, checked in, two days ago) and a cancelled one;
- one club registration, missing a required answer;
- one event booking for 2 people, with 1 checked in;
- the same e-mail on all three orders.

The expected values below were computed by hand from that dataset:

| Measure | Expected (by hand) | Actual (asserted) |
|---|---|---|
| Hall orders, active, cancelled, people | 2, 1, 1, 6 | 2, 1, 1, 6 |
| Hall cancellation rate | 1 / 2 = 50% | derivable (1 of 2) |
| Club registrations | 1 order, 1 active | 1, 1 |
| Event orders, people | 1, 2 | 1, 2 |
| Event attendance: expected, attended, unmarked | 2, 1, 1 | 2, 1, 1 |
| Hall attendance: expected, attended | 1, 1 (the cancelled one isn't expected) | 1, 1 |
| Capacity utilisation (event session) | 2 taken / 10 offered = 20% | offered 10, taken 2 |
| Form completion | 1 checked, 0 complete, 1 incomplete | 1, 0, 1 |
| Orders over time | 4 | 4 |
| Repeat participation | 1 person, 1 returning | `{ people: 1, returning: 1 }` |
| Per-listing filter (hall) | orders 2, cancelled 1, attended 1 | same |
| Another organisation | all zero; no listing | all zero; `perListing: []` |

**Filters and limits:**
- Dates: an out-of-range span returns 400.
- Listing filter: per-listing detail.
- Organisation filter: always the caller's own organisation, which can't be overridden.
- **Empty results** come back as zero rows.
- **Large result sets** are bounded:
  - detail at 20,000 rows, with a `truncated` flag;
  - form checks at 1,000 orders, also with `truncated`.
- **Live timings** for a 30-registration listing are in [10](10-performance-and-reliability.md).

**Export permissions:**
- The analyst and finance can read the report; communications can't.
- Answer exports are for the listing's managers and the owner only. Finance, other managers and other organisations are refused.
- Contact details and non-exportable classes are excluded.
- Every export is audited with row and question counts, never values. FINAL-SEC checks this in the browser stack.
- The CSV neutralises formulas (`'=` prefix), also checked by FINAL-SEC.

### Inconsistencies found
- **DEF-04 (P2): event no-shows count orders, not people.** In `vendorReports.ts` (lines 82–90), "Events and experiences (people)" counts `expected` and `attended` in **people** (party size, per-attendee check-ins). `noShow` counts **bookings** with a no-show row. A party of 4 marked no-show shows 1 no-show and 3 "unmarked". Fix: count `party_size` for no-show bookings, or record no-shows per attendee.
- **DEF-05 (P3): club check-ins missing from the summary.** Club check-ins (`attendance.kind = 'registration'`) appear in the per-listing detail but not in the summary attendance table. That table only has events, halls and programmes.
- **Programme completion:** "finished" means every session is in the past (doc 25, O2). No attendance threshold is applied (owner decision), so "completion rate" isn't a reported measure.
- **No duplicate counting** was found:
  - repeat people are deduplicated by e-mail;
  - per-listing rows are one per order;
  - the 30-registration perf batch found no duplicate references or answer rows.

## Commands
```bash
npm run test --workspace server   # vendorMessages, bookingReminders, vendorReports, governance (disposable MySQL)
QA_PORT_OFFSET=10 QA_ONLY_BATCH=booking-config-messages npm run qa:booking
QA_PORT_OFFSET=10 QA_ONLY_BATCH=booking-final-security npm run qa:booking
```
