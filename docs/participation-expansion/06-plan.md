# 06 · Implementation phases, test plan, risks, decisions and rollback

## 1. Phases and dependencies

Each phase:
- is additive and sits behind its own `participation.*` switch (default off, dev on only after QA);
- runs tests only against an isolated `hello_circle_test_<runid>` container, never `hello_circle`.

There are no commits or deploys without your explicit word.

| Phase | Scope | Depends on | Switch | Types |
|---|---|---|---|---|
| **0** | This audit | — | — | — |
| **1** | **Options and lines on experiences, plus the `event` kind.** `offering_options`, `order_lines`; quote and checkout accept `lines`; engine and legacy pricing from lines; capacity by heads and per-option caps; editor "Several options" level; booking box options step; My Life and receipt show lines; `/events` alias + taxonomy family; partial cancellation by line (card only) | PD-1, PD-2 | `participation.options`, `participation.events` | experience, event, volunteer (shifts) |
| **2** | **Attendees and questions.** `order_attendees` (dual-read seat names), household pick, `listing_questions`/`order_answers` (normal + sensitive; special-category waits on PD-6), safety-critical blocking, occurrence record page (Overview, Attendees, Check-in), `attendee_attendance`, door mode for partner staff | 1 | `participation.attendees`, `participation.questions` | experience, event, volunteer |
| **3** | **External payments.** `external_payments`, hold predicate, `settleExternal()`, Payments to verify queue, booker claim flow, `cash_due`, door "payment pending" + finance record-cash, ledger `external_receipts` | 1, PD-4, (PD-5 for cash) | `participation.external_payments` | experience, event |
| **4** | **Donations.** Donation line, Stripe line item, ledger `donations_payable`, statement and export line, refund rule | 1, **PD-3 + D-04 part B** | `participation.donations` | event, experience (cause) |
| **5** | **Volunteers, door roles, game guests.** `occurrence_roles`, door API for non-staff, duties with caps and vetting flag, hours; games `allow_guests` + co-host | 2 | `participation.roles`, `participation.game_guests` | event, volunteer, game |
| **6** | **Programmes and venues.** Options on programmes (early bird, drop-in, add-ons) and room packages and add-ons; attendee roles (parent + baby); questions on bookings | 1–3 | `participation.options` per type | programme, venue |
| **7** | **Family orders on clubs and programmes.** Checkout groups + `registration_group` webhook type (lockstep), family plans, proof-gated options | 6, **PD-8** | `participation.checkout_groups` | club, programme |
| **8** | **Reporting and retention.** Per-occurrence exports (attendees, lines, payments, answers), statements with donations, retention job | 2–4, **D-07/DEC-14** | `participation.exports` | all |

Later or unscheduled:
- E1 deposit and balance;
- E3 invoice billing;
- E4 offline door pack;
- E7 attendee self-complete;
- E8 group-fit waitlist;
- pass + paid seat mix;
- donation-only listings.

```
PD-1,PD-2 ─▶ P1 ─▶ P2 ─▶ P5
              │     └───▶ P8 ◀── D-07
              ├─▶ P3 ◀── PD-4 (PD-5)
              ├─▶ P4 ◀── PD-3 + D-04B
              └─▶ P6 ─▶ P7 ◀── PD-8
```

The paid launch is still governed by `PAID_CHECKOUT` and D-04. None of these phases opens paid checkout in production.

## 2. Test plan

### 2.1 Unit tests (Vitest, pure)
- Line pricing:
  - sum and rounding;
  - add-on caps;
  - bundles fix bands;
  - a sale window at a boundary (23:59:59 vs 00:00:00 Europe/Dublin, using `irelandTime.ts`);
  - coupon excludes donation;
  - engine `lines[]` matches legacy `computePricing(sum)` while the shadow switch is on.
- Capacity:
  - heads across options, free infants counted, per-option cap;
  - `occupiesCapacitySql` gives the same result for every existing fixture with the switch off.
- External state machine: `due→claimed→verified`, `rejected`, `expired`, a stale `row_version` returns 409,
  `hold_until` is never extended.
- Partial refund: the X-01 worked example (€402 paid, €153 refunded, donation €0) and the cap at paid minus refunded.
- Question visibility: the role × sensitivity matrix in `05-rules.md` §6.

### 2.2 Server integration (isolated profile, `server/TESTING.md`)
- **Checkout with lines:**
  - two concurrent checkouts for the last 4 heads, so exactly one succeeds;
  - an option cap race.
- **Webhook:**
  - a paid session with lines confirms;
  - an agreement mismatch goes to `payment_reviews` (unchanged);
  - a session with a donation line where the sum equals the agreement.
- **External payment:**
  - verify confirms only once;
  - verify after the organisation was suspended is refused (D-01);
  - verify after the start time is refused;
  - expiry releases the place.
- **Door API:**
  - an occurrence role reads only the door projection (assert that no `email`, `phone`, amount or answer keys are
    present);
  - an expired role gets 403;
  - finance can record cash, the door role can't.
- **Permissions:** walk the new routes the way `adminPermissions.test.ts` does for admin; partner role tests in the
  style of `vendorPiiRoles.test.ts`.
- **Regression:** every existing suite stays green with all `participation.*` switches off *and* on.

### 2.3 Payment QA (`npm run qa:stripe`, Stripe TEST mode)
- KNOTS end to end by card: Pooja + Darshan; the donation part runs only once Phase 4 is approved.
- Partial cancellation refunds through Stripe.
- No new live-mode path.

### 2.4 Browser (Playwright specs alongside the existing ones)
- EV-01 on a phone (375px): options, attendees, questions, review, bank-transfer confirmation shows "Awaiting
  confirmation".
- Door mode: search, partial check-in, "payment pending" row.
- Editor: Simple → Several options → Full registration, and downgrade blocked when orders exist.
- Casual game host and join: **no new required field, same number of steps**.

### 2.5 Acceptance criteria (sign-off)
| # | Criterion | Scenario |
|---|---|---|
| A1 | One checkout holds several options; the stored total equals the server sum of lines and equals the checkout agreement | EV-01 |
| A2 | Every option shows "per person" or "per booking" before payment | EV-01 |
| A3 | Capacity counts heads across all options, including free ones; no oversell under concurrency | EV-02 |
| A4 | An external-payment order never shows as booked, never gets a QR and never counts as paid until verified by finance; every change is audited | EV-01, EV-03 |
| A5 | An expired external hold releases the place and never refunds by itself | EV-01 |
| A6 | A door role sees names, heads and arrival only; the API never returns amounts, contacts or sensitive answers to it | X-03 |
| A7 | Partial check-in: one QR checks in any subset of seats; counts update | EV-01 |
| A8 | Removing an attendee refunds only their line share, capped at paid minus refunded; donations are untouched unless asked | X-01 |
| A9 | Safety-critical answers block the booking with a clear message | EX-01 |
| A10 | Donations appear on their own line, in receipts and exports, and are taxed per the approved rule only | EX-02 (P4) |
| A11 | The casual game flow is unchanged (same steps and fields) unless the host turns on +1s | GA-01 |
| A12 | With every `participation.*` switch off, every existing test and QA suite passes unchanged | all |

## 3. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| K1 | Changing `occupiesCapacitySql`/`gameSeatSql` breaks an existing capacity count | Medium | High (oversell) | Switch-gated branches; fixture parity tests; ship in its own commit |
| K2 | Lines and the checkout agreement disagree (rounding) | Low | High (paid orders parked) | `engineLineItems()` already throws on mismatch; same guard for legacy |
| K3 | External verification used to "confirm" without money | Medium | High | Finance-only, row version, audit, D-01/start checks, no client-supplied amount |
| K4 | `kind != 'volunteer'` filters silently include `event` in adventures | High | Low–Medium | Grep and update every kind filter in Phase 1; test discovery counts |
| K5 | Special-category data collected without a basis | Medium | High (GDPR) | PD-6 gate; purpose text; door and volunteer roles never see it |
| K6 | Retention can't run yet (D-07) | Certain | Medium | Hide sensitive answers after 30 days; block special-category questions until D-07 |
| K7 | Editor complexity leaks into the casual game flow | Medium | Medium | Games get only +1s/co-host; A11 test |
| K8 | Checkout groups (P7) touch the webhook contract | Certain (if built) | High | Separate approval (PD-8); lockstep change; full `qa:stripe` |
| K9 | Donation tax treatment wrong | Medium | High | Off until PD-3 + D-04 part B; never assumed exempt |
| K10 | Uncommitted work in this branch (127 changed files) collides with new work | High | Medium | Agree the base branch before Phase 1 (see memory: check git state first) |

## 4. Open decisions (needed from you)

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| **PD-1** | A community event is `experiences.kind = 'event'` (not a new table) | Yes | P1 |
| **PD-2** | Who may sell **paid** events: partner organisations only (KYC, Connect, D-01) | Partner orgs only; Circle organisers free events later | P1 |
| **PD-3** | Donation tax and fee treatment, receipts, refundability, payout to a third-party charity | Decide with the accountant alongside D-04 part B; until then off | P4 |
| PD-3b | Free registration + optional donation: is the booking kept if the donation checkout is abandoned? | Yes, keep the booking; the donation is a separate optional payment | P4 |
| **PD-4** | External payments allowed? Which methods? Who verifies (partner finance only, or admins too)? Default hold (72h / 24h before start)? May door volunteers take cash? | Allow bank/Revolut for events only; partner finance verifies; admins read-only; volunteers can't take cash in v1 | P3 |
| **PD-5** | Existing `payment_method = 'cash'` listings: keep "cash = paid" or move them to `cash_due` | Keep as is for now; offer `cash_due` as a new option | P3 |
| **PD-6** | Allow special-category questions (religion such as gotra; health)? | Allow only with purpose text, optional by default, after the partner data-processing clause | P2 (special-category part) |
| PD-7 | Price basis shown to customers: is KNOTS Pooja per family or per person? | Ask KNOTS; the model supports both | KNOTS go-live |
| **PD-8** | Build checkout groups (several rows, one payment) for clubs and programmes | Yes, as Phase 7, after events have run successfully | P7 |
| PD-9 | Enhancements E1–E10: which, if any, join the roadmap | E2 and E9 next (cheap, high demand); E4 and E7 later | — |
| PD-10 | Base branch for this work given the current uncommitted tree | Commit or park the current work first | P1 start |

## 5. Rollback plan
1. **Switch off.** Every phase is gated by a `participation.*` switch in `app_settings`. Turning it off:
   - hides the UI;
   - makes the server refuse the new inputs (`lines`, `attendees`, `answers`, `donationMinor`, external
     `paymentMethod`) with a 409 "not available";
   - restores the legacy single-price path.
2. **Data stays put.** Tables and columns are additive and are never dropped (there's no down-migration in this
   codebase). Rows written while a switch was on stay readable:
   - receipts and My Life still render lines and attendees from stored rows;
   - door and record pages still render read-only.
3. **Open external claims at rollback** stay in the finance queue and can still be verified or rejected. Turning the
   switch off stops **new** claims only, never strands money already received.
4. **Capacity predicate edits** are behind the same switch: when it's off, the original SQL string is returned
   unchanged, which is checked by the parity test (K1).
5. **Release:** each phase is its own commit and PR to `staging` (never `main` first). Prod is untouched until you
   say so (memory: no autopush or deploy).
