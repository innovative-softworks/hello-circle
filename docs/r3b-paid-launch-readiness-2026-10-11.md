# HelloCircle — R3B Financial and Operational Readiness (paid bookings, Ireland)

Branch `feature/commerce-engine`, working tree after R3A, 2026-10-11. **Decision document only.** No code, database,
commerce switch, VAT, pricing, settlement or subscription rule was changed. Nothing was committed, pushed or deployed.

Labels: **[V]** verified in code for this document (`file:line` or function named) · **[A]** assumption or estimate ·
**[Q]** a question for an Irish tax adviser or solicitor. This document does not choose a tax treatment.

Reads with:
- `docs/booking-checkout-audit-2026-10-11.md`
- `docs/booking-release-readiness-2026-10-11.md`
- `docs/commercial-ux-plan-2026-10-11.md`
- `docs/revenue-connect/01–09`

---

## 0. Summary

**Verdict: paid bookings remain NO-GO.** The payment mechanics are sound:
- server pricing everywhere;
- holds;
- idempotent webhooks;
- refund-once;
- snapshots;
- ledger, settlement and Connect, built and tested in Stripe TEST mode.

What's missing is **decisions**, not plumbing. Six of them block launch (§2, D1–D6), and three need professional advice
before anyone can choose (§2, Q1–Q14).

**Five findings that change the picture [V]:**

| # | Finding | Evidence |
|---|---|---|
| F1 | **Two different fee models are live in the codebase.** Checkout and settlement price with the `pricing` rule v1: the customer pays +5% fee +23% VAT and the partner pays no success fee. The public `/pricing` page and the admin simulator compute partner earnings with formula pe-2 and the plan rules: a 9% / 7% success fee plus VAT on the fee, and no customer fee. **Partners are shown a model that isn't charged.** | `commerce/money.ts priceBreakdown` (checkout snapshot); `commerce/calc.ts calculate` used only by `calcContext.estimate` → `routes/pricingPublic.ts`, `routes/adminCommerce.ts`; `catalog.ts:74` vs `:125,:138` |
| F2 | **HelloCircle records VAT on the partner's activity as its own liability** (`underlying_tax_payable`) and pays the partner the pre-VAT price. That is a deemed-supplier / principal model, chosen implicitly by the ledger. The pe-2 calculator assumes the opposite: the partner keeps their gross and HelloCircle charges VAT only on its fee. | `commerce/payments.ts` posting lines ~L113–L158 |
| F3 | **Customer credit and HelloCircle-funded coupons reduce the VAT base.** VAT is computed after the HelloCircle-funded amount is taken off, but the partner is paid the full price (HelloCircle tops it up). Example: €90 experience with €25 credit → VAT €14.95 instead of €20.70. | `routes/experiences.ts engineQuoteExperience` (credit added to `discountMinor`); `money.ts:118–140` |
| F4 | **Stripe keeps its processing fee on every refund**, including the €100 deposit return. Every refunded deposit costs HelloCircle about €1.50, and every full refund about 1.5% + €0.25 of the order. Nothing in pricing accounts for it. | `payment_costs` rule v1 (`catalog.ts:220`); Stripe standard pricing [A] |
| F5 | **With Connect off (today), there is no mechanism that pays partners.** Money stays in HelloCircle's Stripe balance and the ledger, which is off, would only record it. A manual payout process isn't defined anywhere. | `commerce.connect_v1`, `commerce.settlement_ledger` default off (`catalog.ts`); no payout code outside `payments/connect.ts` |

---

## 1. Financial scenario matrix (Workstream 1)

### 1.1 The three formulas in the code

| Name | Where it runs | Customer pays | Partner receives | HelloCircle earns |
|---|---|---|---|---|
| **L — legacy** (live; every switch off) | `pricing.ts computePricing`, all six checkout types | price − coupon (= taxable), + VAT 23% on taxable, + fee 5% on taxable, + €100 deposit (online venue hire only) | taxable (+ the HelloCircle-funded part of a coupon); when the ledger is on, posted as `partner_payable` / `host_payable` | the 5% fee. Records the VAT as its own liability |
| **E-v1 — engine, rule v1** (only `engine_v2` + `engine_v2_experience`, experiences only) | `money.ts priceBreakdown` with `pricing` v1 | **identical to L** (v1 was seeded to mirror L) | `partnerGross − successFee(0) + HC-funded discount/credit` | customer fee 5% |
| **pe-2 — target estimator** | `calc.ts calculate` (the `/pricing` page, admin simulator) | fee base − HC subsidy (+ customer tax only if configured) | fee base − success fee (9% Free / 7% Pro, min €0.75 / €0.50) − VAT on that fee | success fee, net of the fee VAT |

The scenarios below use **L**, the money that actually moves if paid bookings opened today. The **pe-2** column shows what
the partner-facing pages promise instead. Stripe costs are **estimates** from the `payment_costs` rule v1 (card 1.5% +
€0.25, Connect payout 0.25% + €0.10) [A]. Real Stripe fees vary by card origin.

### 1.2 Scenarios (euros)

| # | Scenario | Customer pays | VAT recorded (by HC) | HC fee | Partner owed | Deposit held | Stripe est. | HC contribution* | pe-2 page says partner gets |
|---|---|---|---|---|---|---|---|---|---|
| S1 | Venue hire, €40/h × 2 h, online | 202.40 = 80 + 18.40 + 4.00 + 100 | 18.40 | 4.00 | 80.00 | 100.00 | 3.29 | **+0.71** | 71.14 (9% fee €7.20 + VAT on fee €1.66) |
| S1c | Same, venue takes cash | 0 online | — (venue's own) | **0** | — | 0 | 0 | 0 | — |
| S1d | S1 with vendor coupon SPRING10 (−10%, partner-funded) | 192.16 = 72 + 16.56 + 3.60 + 100 | 16.56 | 3.60 | 72.00 | 100.00 | 3.13 | +0.47 | — |
| S1e | S1 with admin coupon (−10%, HelloCircle-funded) | 192.16 | 16.56 (on €72) | 3.60 | 80.00 (72 + 8 top-up) | 100.00 | 3.13 | **−7.53** | — |
| S2 | Vendor experience, 2 × €45 | 115.20 = 90 + 20.70 + 4.50 | 20.70 | 4.50 | 90.00 | — | 1.98 | +2.52 | 80.04 (9% fee €8.10 + VAT on fee €1.86) |
| S2c | S2, engine on, €25 credit (E-v1) | 83.20 = 65 + 14.95 + 3.25 | **14.95** (not 20.70) | 3.25 | 90.00 (65 + 25 top-up) | — | 1.50 | **−23.25** (incl. the €25 credit) | — |
| S3 | Host-run paid event, €8 | 10.24 = 8 + 1.84 + 0.40 | 1.84 | 0.40 | 8.00 (`host_payable`) | — | 0.40 | **0.00** | 7.08 (minimum fee €0.75 + VAT on fee €0.17) |
| S3b | S3 with host coupon −€3 (host-funded) | 6.40 = 5 + 1.15 + 0.25 | 1.15 | 0.25 | 5.00 | — | 0.35 | **−0.10** | — |
| S4 | Club registration, €30 term | 38.40 = 30 + 6.90 + 1.50 | 6.90 | 1.50 | 30.00 | — | 0.83 | +0.67 | — |
| S4p | Programme, €60 | 76.80 = 60 + 13.80 + 3.00 | 13.80 | 3.00 | 60.00 | — | 1.40 | +1.60 | — |
| S4q | 10-session pass, club €12/session | 153.60 = 120 + 27.60 + 6.00 | 27.60 | 6.00 | 120.00 | — | 2.55 | +3.45 | — |
| S7 | Partner Pro subscription, IE partner without a VAT number | 35.67 = 29 + 6.67 | 6.67 (HC's own supply) | 29.00 | — | — | ~0.79 + Billing fee [A] | ≈ +28 | — |
| S7r | Pro, EU business with a valid VAT number (reverse charge) | 29.00 | 0 (reverse charge) | 29.00 | — | — | ~0.69 + Billing fee | ≈ +28 | — |
| S8a | S1 full refund before the event | −202.40 back to card | VAT reversal 18.40 | fee reversed 4.00 | 0 | 0 | **3.29 kept by Stripe** | **−3.29** | — |
| S8b | S1 deposit returned after the event | −100.00 back to card | — | — | 80.00 | 0 | ~1.50 of the original fee not returned | **−0.79 overall** | — |
| S8c | S2c refund of 1 of 2 places (D1 proportional) | −41.60 to card; €12.50 credit restored | VAT −7.48 | −1.63 | 45.00 | — | not returned | — | — |

\* **HC contribution** = HelloCircle fee − Stripe estimate − HelloCircle-funded subsidy. It excludes Connect payout costs
(0.25% + €0.10 per transfer, €2/month per active account [A]), any VAT on HelloCircle's own fee [Q], rewards and
overheads. With a VAT-inclusive fee [Q], S1 drops to −0.04 and S3 to −0.07.

### 1.3 Money flows by party (today's L model; Connect and ledger as built but off)

```
Customer ──card──▶ Stripe (HelloCircle platform account = merchant of record for the payment)
                     │  Stripe deducts its processing fee from HelloCircle's balance
                     ▼
HelloCircle Stripe balance (one pot):
   ├─ partner share (taxable + any HC-funded top-up)   → owed to the partner
   │     today: no payout mechanism (F5)
   │     ledger+Connect on: release at completion + 48 h → weekly settlement (≥ €25) → transfer
   │     → partner's Express account → Stripe bank payout
   ├─ VAT on the activity (23%)                         → recorded as HelloCircle's liability (F2)
   ├─ 5% customer fee                                   → HelloCircle revenue (VAT on it? Q2)
   └─ €100 deposit                                      → held, returned by refund (partner-triggered, §3)
Pro subscription: partner ──card──▶ Stripe Billing on the same HelloCircle account → HelloCircle revenue + VAT (tax_vat rule)
Customer credit: HelloCircle-funded; reduces what the card pays; HelloCircle tops up the partner share (F3)
Refunds: always from HelloCircle's Stripe balance; Stripe's original fee is not returned (F4)
```

| Party | Holds money? | When | Records |
|---|---|---|---|
| Customer | — | Pays at checkout; refunds go back to the card, or as credit for the credit share | `payment_records`, `refunds`, `credit_uses` |
| HelloCircle (merchant) | **Yes, everything**, until transfer or refund | From payment until transfer (Connect) or refund | `ledger_entries` (if the ledger is on), `pricing_snapshots` |
| Partner (vendor, venue, host) | Only after a Connect transfer | Weekly, after completion + 48 h, ≥ €25 | `settlements`, `transfers`, `connected_payouts` |
| Stripe | Processing fees; partner bank payouts | Per charge; per payout | Stripe objects; mirrored payouts |

### 1.4 Questions for an Irish tax adviser (do not decide internally)

| # | Question |
|---|---|
| Q1 | Is HelloCircle the **supplier** of the activity for VAT (principal / deemed supplier, as the ledger assumes), or an **agent** collecting on behalf of the partner? Who accounts for VAT on the activity? |
| Q2 | Is VAT due on HelloCircle's **5% customer fee** and/or on a **partner success fee**? At what point of supply? Is HelloCircle registered (`[[VAT_NUMBER]]` is still a placeholder)? |
| Q3 | Can HelloCircle charge **23% VAT** on activities supplied by partners who are **not VAT-registered** (below the services threshold) or who are **individual hosts**? |
| Q4 | **Exemptions:** sports facilities and services by non-profit clubs, children's activities, education and training programmes, and venue hire (letting of immovable goods). Which listing categories are exempt or reduced-rate, and who decides per listing? |
| Q5 | **HelloCircle-funded coupons and customer credit:** is the VAT base the full price (the partner receives it) or the reduced customer payment? Is credit a voucher (single- or multi-purpose) or a discount? |
| Q6 | **Refundable deposit:** outside the scope of VAT while refundable? What if it's retained for damage? |
| Q7 | **Pro subscription:** VAT treatment for IE partners without a VAT number, IE VAT-registered partners, and EU B2B (reverse charge, as the `tax_vat` rule supports). Invoice content requirements. |
| Q8 | **Refund and credit-note** requirements for VAT when an order is partly refunded, partly in credit. |
| Q9 | **DAC7** reporting obligations for HelloCircle as a platform (`trader_profiles` already collects the data). |

### 1.5 Questions for a solicitor

| # | Question |
|---|---|
| Q10 | **Holding customer money** (partner shares for up to completion + 48 h + weekly, and deposits): does it need payment-services authorisation, or does a commercial-agent / limited-network exemption apply? Is separate charges and transfers acceptable for that? |
| Q11 | **Consumer cancellation rights** for leisure services on a specific date (the CRD exemption from the 14-day withdrawal right). What must the booking terms say for each policy option in §3? |
| Q12 | **Deposits:** retention conditions, evidence, a time limit to claim, and dispute route. |
| Q13 | **Terms acceptance:** is a recorded tick plus version enough? What about orders placed by older app versions without it (§4)? |
| Q14 | **Host individuals selling paid events:** trader status (DSA), consumer-law liability, and who the customer contracts with. |

---

## 2. Business decisions requiring approval

| # | Decision | Options | Blocks | Recommendation (to approve, not applied) |
|---|---|---|---|---|
| **D1** | **Commercial model** | (a) keep L: customer fee 5% + VAT on top; (b) move to the plan model: partner success fee 9% / 7%, no customer fee; (c) hybrid | Launch | Decide after Q1–Q5. Whichever is chosen, **one formula** must drive checkout, settlement, `/pricing` and the simulator (fixes F1) |
| **D2** | **VAT presentation and liability** | VAT added on top vs included; HelloCircle vs partner accountable | Launch | Adviser-led (Q1, Q3, Q4). Until then **no paid launch** |
| **D3** | **Who funds Stripe fees on refunds and deposits** (F4) | HelloCircle absorbs; refund minus fee where lawful; non-refundable booking fee | Launch | Absorb for provider cancellations. Ask the solicitor about customer cancellations (Q11) |
| **D4** | **Partner payouts at launch** (F5) | Connect on (built, test-proven) vs a defined manual bank-transfer process | Launch | Connect, after one person completes Express onboarding on staging and Q10 is answered |
| **D5** | **Customer cancellation and refund policy** (§3) | Options A–C per case | Launch | Option B (automatic refund before the deadline) |
| **D6** | **Deposits** (§3.3) | Keep / automate / remove | Launch of venue hire | Automate, or drop the deposit for v1 if Q6/Q12 can't be answered in time |
| D7 | Acknowledgement enforcement and native compatibility (§4) | — | Paid launch (P1) | Version-aware enforcement once Terms are published |
| D8 | Minimum order value (S3: €8 orders have about €0 contribution) | none / €5 / €10 | No | Review after D1 |
| D9 | HelloCircle-funded coupons and credit at launch (S1e, S2c) | on / off | No | Keep off until Q5 |

---

## 3. Refund and deposit policies (Workstreams 2 and 3)

### 3.1 Current behaviour [V]

| Order type | Customer self-cancel | Deadline | Money today | Provider cancels | Money today |
|---|---|---|---|---|---|
| Venue booking | Yes, before org `cancellation_hours` (default 48 h) | `bookingChangeBlock` | Cancelled → **refund pending**; partner finance must refund (policy A) | Yes | **Automatic full refund** (`refundOnProviderCancel`, incl. deposit) |
| Club registration | Yes, **any time** (`registrationCancelBlock` has no deadline) | none | refund pending (manual) | Yes | Automatic full refund |
| Programme | Yes, any time | none | refund pending (manual) | Yes | Automatic full refund |
| Experience | Yes, before org cut-off | `experienceCancelBlock` | refund pending (manual) | Yes (booking or session) | Automatic full refund |
| Host paid event | Self-leave until start (soft cancel) | start time | **No refund unless the host presses "Refund"** | Host cancels event | **No automatic refund** (`cancelGameAndNotify` has no refund call) |
| Pass | No self-cancel | — | — | — | — |

Engine:
- **Refund mechanics:** refund-once (`refundPaidOnce`), partial refunds (`refundInApp`), provider-side refunds reconciled
  (`recordProviderRefunds`), credit restored in proportion (D1, `restoreCreditForRefund`).
- **Failure handling:** a failed automatic refund is audited and the order stays `refund_pending`. There is **no retry
  job**, and the customer isn't told it failed.

### 3.2 Policy options by case

| Case | Option A (today) | Option B (recommended) | Option C |
|---|---|---|---|
| Customer cancels **before** the deadline | Refund pending, partner refunds by hand | **Automatic full refund** of the activity, fee and deposit, at cancellation (behind a switch). The Stripe fee is absorbed (D3) | Automatic refund minus a fixed admin fee (Q11) |
| Customer cancels **after** the deadline | Online cancel blocked; "contact the venue" | Same, plus a "Request cancellation" form to the partner. The partner decides full / partial / none within 72 h. Default if no answer: none. Deposit always returned | Automatic X% refund (per-listing setting) |
| Registrations and programmes (no deadline today) | Any time, manual | Add a deadline: programme before session 1; registration within N days. Then as above | Pro-rata by sessions left |
| **Provider cancels** | Automatic full refund (not for host events) | Same, **plus host events** (`cancelGameAndNotify` → refund every paid participant) | — |
| **Partial refund** (fewer places, partner goodwill) | Partner finance via `POST /vendor/refunds` | Same, with server-computed maximum refundable and a reason picker. Credit restored in proportion (D1) | — |
| **Coupon-funded order** | Refund of what the card paid | The refund never exceeds what was paid. The coupon use is reversed (`coupon_redemptions` → reversed), so a single-use code can be used again only if policy allows (decision D10) | — |
| **Credit-funded order** | Credit share back as credit, card share to card (D1) | Same. The customer sees both lines (R3A receipt drawer) | All back as credit (faster, avoids the Stripe fee) — Q8 |
| **Failed refund attempt** | Audited; stays refund pending; finance retries by hand | **Retry job:** exponential backoff (5 min, 30 min, 2 h, 12 h, 24 h), same idempotency key per attempt series. After the last attempt → `refund_failed`, finance alert, customer told "We're sorting your refund", admin "Retry" / "Mark paid outside Stripe" | — |

### 3.3 Deposits: trace and proposal

**Trace today [V]:**
- **Collection:** `DEPOSIT_CENTS = €100` (`routes/bookings.ts:55`; rule `venueDepositMinor` 10 000) is added to online
  venue hire and charged in the same Stripe Checkout as the hire. There is no separate authorisation hold. Cash bookings
  have no deposit.
- **Held:** in HelloCircle's Stripe balance. With the ledger on it's posted to `refund_liability`.
- **Return:** none automatic. After the event the vendor's orders list flags `deposit_due`
  (`vendorOperations.ts /orders`), and **the partner's finance user** issues a partial refund of €100 (`POST /vendor/refunds`).
  The money comes from HelloCircle's balance. The customer was told "returned by the venue after …"
  (`client/src/components/booking/policy.ts:30`).
- **Reconciliation:** the refund row ties to the order. The deposit stays in `refund_liability` until refunded.
- **Damage claims:** there's no claim process, evidence step or time limit.
- **Responsibility:** the partner presses the button, HelloCircle's money moves, nobody is accountable for timing.

**Proposal** (behind a new switch, default off; implemented only after D6):

1. **States:**

   ```
   held → return_due (event end + returnAfterHours, default 72 h) → returned
                      └→ claimed (partner, before return_due, reason + evidence) → partial_returned | retained
   failed (retry series exhausted) → finance
   ```

2. **Job:** an hourly sweep, like the subscriptions sweep in `index.ts`:
   - selects `return_due` deposits past their time;
   - calls `refundInApp(type: "booking", amount: deposit, responsible: "platform", reason: "Deposit returned")` with
     idempotency key `deposit-return:<ref>:<attempt-series>`;
   - retries as in §3.2.
3. **Claims:**
   - partner finance or the owner can claim before `return_due`;
   - amount ≤ deposit;
   - reason picker + free text + optional photo upload (existing media pipeline);
   - the customer is notified with 7 days to dispute → admin decides.
4. **Audit:** every transition is `writeAudit` (actor, before/after, reason), and the ledger posts `refund_liability` →
   `stripe_clearing` on return.
5. **Customer copy:** "Your €100 deposit comes back automatically 3 days after your booking, unless the venue reports
   damage. You'll get an email either way."

---

## 4. Consent and acknowledgements (Workstream 4)

**Today [V]:**
- `order_acknowledgements` records terms (with the server-resolved version) and safety (a text fingerprint).
- The terms version is NULL because **no Customer Booking Terms are published** (policy CMS draft v1 still has
  placeholders).
- **Enforcement:** not enforced for terms or safety (~100 test callers). Minimum age is enforced for experiences and games.
- **Client version signal:** none. No client sends a version or platform header.
- **Native:** the Capacitor shell (`client/capacitor.config.ts`) points `server.url` at `http://localhost:3001` (dev
  override). In a hosted-URL build every user runs the current web code. In a bundled build (`webDir: dist`) old
  versions keep old JS. **Which mode store builds use isn't settled [A]**, and an Expo app exists on another branch.

**Design: version-aware enforcement.**

1. **Client signal (additive):** every request sends `X-HC-Client: web/<buildId>` or `ios|android/<semver>`, set in
   `client/src/api/core.ts`. A missing header means "unknown legacy client".
2. **A server setting `ack_enforcement`** with modes:
   - `record` — today;
   - `require_web` — web must send the acknowledgements; others are recorded only;
   - `require_all_supported` — native ≥ `min_ack_app_version` must send them;
   - `require_all` — after the sunset date.
3. **Refusals carry a code, never silent:**

   | Code | When | Client action |
   |---|---|---|
   | `400 terms_required` | Terms not ticked | Ticks the box; the existing UI already renders the checkbox |
   | `409 terms_changed` | The client says it showed version N, the server is on N+1 and the change is marked material | Re-shows the terms |
   | `409 safety_changed` | The safety text fingerprint differs from what the client showed | Re-shows the safety text |
   | `426 upgrade_required` | Native below `min_supported_app_version`, after the sunset | Friendly screen with a store link |

4. **Older native versions during the grace period:**
   - the order is accepted;
   - `order_acknowledgements` gets `kind = 'terms', doc_version = current, source = 'implied_legacy_client'`, plus client
     platform and version;
   - the confirmation email includes the terms link and "By keeping this booking you accept…" (wording per Q13);
   - an admin report counts these.
5. **Preconditions:**
   - Customer Booking Terms published (placeholders resolved, named legal sign-off);
   - native build mode decided;
   - `min_*` versions set by an admin, not in code.

---

## 5. Customer and partner UX flows

**Customer.**

| State | Where | Customer sees |
|---|---|---|
| Cancel before the deadline (B) | My Life row → Cancel → confirm dialog | "You'll get €X back to your card (and €Y as HelloCircle credit). Refunds take 5–10 working days." Then the row shows `RefundStatus`: "Refund processing" → "Refunded" |
| Cancel after the deadline | Row | "Online cancellation has closed" → "Ask the venue to cancel" (form) → "Request sent — the venue will reply by {date}" → outcome email + row status |
| Provider cancels | Email + row | "Cancelled by the venue — full refund of €X issued" |
| Refund failing (retrying) | Row + receipt drawer | "Refund processing — we're retrying with your bank" (no error jargon) |
| Refund failed (finance) | Row + email | "We're sorting your refund — our team will contact you within 2 working days" |
| Deposit held | Receipt drawer and booking | "€100 deposit — returned automatically on {date}" |
| Deposit claimed | Email + row | "The venue reported damage and kept €Z. You can respond by {date}." → dispute link |
| Credit-funded refund | Receipt drawer (R3A) | Separate lines: "Back to your card" / "Back as HelloCircle credit" |

**Partner (vendor finance or owner; host for events).**

| State | Where | Partner sees and does |
|---|---|---|
| Cancellation request (after the deadline) | Action needed + order drawer | "Full / Partial €__ / No refund", a reason, a 72 h countdown |
| Refund pending (policy A, until B is on) | Action needed `refund_pending` | "Refund €X" (existing) |
| Refund failed | Action needed | "Refund couldn't be completed — HelloCircle is retrying" (no action) |
| Deposit due soon | Action needed | "Deposit returns automatically on {date}" → "Report damage" (before then) |
| Host cancels a paid event (new) | Cancel dialog | "N paid places will be refunded €X in total" |
| Payout impact | Earnings → Balance | Refunds after a transfer create a partner debt (existing `partner_debts`); shown in Payouts |

---

## 6. API and database impact (when approved; none made now)

| Area | Change | Type |
|---|---|---|
| Formula unification (D1) | Retire one of `money.ts priceBreakdown` / `calc.ts calculate` for partner earnings; `/pricing` and the simulator read the same rule set as checkout | Code + **rule versions (draft → publish, approval)** |
| Self-cancel refunds (D5) | `commerce.self_cancel_auto_refund` switch (default off). Self-cancel routes call `refundOnProviderCancel`-style logic with `responsible: "customer_policy"`. Per-org `cancellation_policy` (deadline hours, after-deadline mode, admin fee) via the `cancellation` rule (new fields, new version) | Code + rule |
| Cancellation requests | `cancellation_requests` (ref, type, requested_at, decision, amount, decided_by, due_at); `POST /…/:ref/cancel-request`; `POST /vendor/orders/:ref/cancel-request/decision` | DB + API |
| Refund retries | `refunds`: `attempt`, `next_retry_at`, `last_error`, status `failed_final`; hourly sweep; `POST /admin/finance/refunds/:id/retry`, `/mark-external` | DB + job + API |
| Host event cancel | `cancelGameAndNotify` → refund every paid participant (same refund-once path) | Code |
| Deposits (D6) | `bookings.deposit_cents` (stored, today derived), `deposit_status`, `deposit_return_due_at`, `deposit_refund_id`; `deposit_claims`; `deposit_policy` rule (`returnAfterHours`, `claimWindowDays`); vendor `POST /vendor/orders/:ref/deposit/claim`; admin decision route | DB + rule + API + job |
| Acknowledgements | `order_acknowledgements`: `source`, `client_platform`, `client_version`; `ack_enforcement` + `min_ack_app_version` + `min_supported_app_version` settings; `X-HC-Client` header in `api/core.ts` | DB + settings + client |
| Coupon reversal on refund | `coupon_redemptions` → `reversed` on a full refund (exists for the ledger path; confirm on all six types) | Verify |
| Everything | `ensureColumn` additive migrations only; nothing destructive | — |

---

## 7. Stripe TEST-mode matrix (Workstream 5)

"Local" = existing `qa:stripe` coverage (TEST mode, CLI or test events). "Staging" = still owed against
`staging.hellocircle.ie` with **real HTTPS delivery**.

| # | Case | Local today | Staging needed |
|---|---|---|---|
| T1 | Hosted Checkout, every paid model: quote = DB = Stripe | ✓ `STRIPE-CHECKOUT-AMOUNTS`, `STRIPE-R3A-*` | ✓ one per model through the browser |
| T2 | Webhook delivered by Stripe to the real HTTPS endpoint, signature verified with the staging secret | CLI only (`SANDBOX-DELIVERY-G`) | **✓ required** (endpoint registered in the Stripe dashboard) |
| T3 | Duplicate event (same id) and replay | ✓ `STRIPE-PAY-*`, `SANDBOX-WEBHOOKS-G` | ✓ resend from the dashboard |
| T4 | Out-of-order (expired after completed; refund before payment event) | ✓ | ✓ |
| T5 | Endpoint down → Stripe retries → recovers once | partial (`SANDBOX-WEBHOOKS-G` failure → replay) | **✓** stop the app for 5 minutes, then confirm one confirmation |
| T6 | Declined card / 3-D Secure challenge failed | ✓ `STRIPE-DECLINE` | ✓ with 3DS test cards |
| T7 | Customer abandons Checkout → hold released | ✓ `STRIPE-EXPIRY`, abandon route | ✓ |
| T8 | Late success after the hold lapsed | ✓ `STRIPE-LATE-SUCCESS` | — |
| T9 | Refund: full, partial, concurrent, external, vendor-cancel | ✓ `STRIPE-REFUND-*`, `HC-QA-091-*` | ✓ one of each |
| T10 | Refund **failure** (test card that makes the refund fail) → retry → final failure UX | ✗ (no retry job yet) | ✓ after §6 |
| T11 | Connect onboarding: a **person** completes Express (hCaptcha) → `enabled` → transfer → bank payout | API-level ✓ `SANDBOX-CONNECT-A`; hosted flow ✗ | **✓ required** (D4) |
| T12 | Settlement run → transfer → reversal after refund → partner debt | ✓ `SANDBOX-MONEY-*`, `SANDBOX-SPLIT` | ✓ one run |
| T13 | Pro: browser Checkout → `processing` → active; renewal; failed renewal → 7-day grace; cancel at period end | ✓ `SANDBOX-BILLING-F` (API); browser ✗ | **✓** browser + Stripe test clock |
| T14 | **Billing portal**: update card, cancel, invoice history | ✗ (portal not configured) | **✓** configure portal (test), then the flow |
| T15 | Dispute: created → won / lost → points reversal → partner debt | ✓ `SANDBOX-DISPUTES-E` | ✓ one |
| T16 | Deposit auto-return job (after §3.3) | ✗ | ✓ with a test clock or a fast-forwarded due date |
| T17 | Reconciliation: local equals Stripe to the cent | ✓ `SANDBOX-RECONCILE` | ✓ end of the staging run |
| T18 | Live key refused outside production | ✓ (provider guard) | ✓ |

**Rules for the staging run:**
- `sk_test_` keys only, kept in the staging env and never in chat.
- A separate webhook secret for staging.
- Run on mains power (long runs fail on battery sleep).

---

## 8. Risk register

| # | Risk | Severity | Mitigation / owner |
|---|---|---|---|
| R1 | VAT model undecided; HelloCircle records partner-activity VAT as its own (F2) | **P0** | Adviser (Q1–Q5) → D1/D2 |
| R2 | `/pricing` and the simulator advertise a model that isn't charged (F1) | **P0** (misleading partners) | Hide partner-earnings estimates, or align them before any partner sees paid terms |
| R3 | HC-funded coupons and credit shrink the VAT base (F3) | P1 | Q5; keep HC-funded coupons and credit off (D9) |
| R4 | Holding partner money and deposits without a confirmed regulatory basis | **P0** | Solicitor (Q10) |
| R5 | No payout mechanism while Connect is off (F5) | **P0** | D4 |
| R6 | Stripe fees lost on refunds and deposit returns (F4); micro-orders at zero or negative contribution (S3) | P1 | D3, D8 |
| R7 | Customer refunds are manual (policy A); failed refunds have no retry | P1 | D5, §3.2 |
| R8 | Host event cancellation doesn't refund paid participants | P1 | §6 host event cancel |
| R9 | Registrations and programmes cancellable any time with no deadline | P2 | D5 |
| R10 | Deposits: no automatic return, no claim process or time limit | P1 | D6, §3.3 |
| R11 | Booking terms unpublished; acknowledgements unenforced; no client version signal | P1 | §4, Q13 |
| R12 | Native build mode undecided (hosted vs bundled JS) | P2 | Decide before any app-store build; remove the localhost `server.url` (already flagged) |
| R13 | Real webhook delivery, hosted Express onboarding and the billing portal never exercised on staging | P1 | §7 T2/T11/T13/T14 |
| R14 | Chargebacks on deposit-bearing bookings after the deposit is returned | P2 | Dispute flow exists; document deposit evidence |
| R15 | Stripe may refuse refunds on old charges (age limit) [A] | P2 | Check against Stripe docs; return deposits within days, not months |
| R16 | DAC7 annual reporting not built | P2 | Q9; data already collected |

---

## 9. Implementation sequence (after approval)

| Step | Work | Depends on | Switches |
|---|---|---|---|
| B0 | Decisions D1–D6; adviser and solicitor answers Q1–Q14; Customer Booking Terms published | Owner, adviser, solicitor | none |
| B1 | Formula unification (one partner-earnings model across checkout, settlement and `/pricing`); new `pricing` / plan **rule versions** drafted → reviewed → published (second approver on) | D1, D2 | `require_second_approver` on |
| B2 | Refunds: retry job + admin retry/mark-external; host event cancel refunds; self-cancel auto-refund behind `self_cancel_auto_refund`; cancellation requests | D5 | new switch, default off |
| B3 | Deposits: stored deposit state, sweep, claims, notifications | D6, Q6, Q12 | new switch, default off |
| B4 | Acknowledgements: `X-HC-Client` header; `ack_enforcement` record → require_web → require_all_supported | Terms published, Q13, native build mode | setting |
| B5 | Staging Stripe run, T1–T18 | B2–B4, staging provider setup | TEST mode only |
| B6 | Go-live sequence: `settlement_ledger` → `connect_v1` → (engine for the chosen model) → `self_cancel_auto_refund` → deposits → `pro_subscriptions` → `circle_credits` / `customer_credits` (only if D9 allows) | Go/No-Go §10 | each by explicit owner instruction |

Each step: server + client tests, `qa:booking`, `qa:revenue`, `qa:lifecycle`, security, authz, then the targeted
`qa:stripe` (TEST mode). No push or deploy without an explicit instruction.

---

## 10. Paid-launch Go / No-Go checklist

Every line must be ✓ with evidence, signed by the owner.

**Legal and tax**
- [ ] Irish tax adviser's written answers to Q1–Q9; D1/D2 recorded
- [ ] Solicitor's written answers to Q10–Q14
- [ ] Legal entity, VAT number, registered address and contacts filled in; policy CMS placeholders cleared
- [ ] Customer Booking Terms, Partner Agreement, Refund & Cancellation Policy, Payments/Fees/Payouts Policy published with named sign-off

**Money model**
- [ ] One formula for checkout, settlement, `/pricing` and the simulator (F1 closed)
- [ ] VAT shown and recorded per D2; receipts compliant (invoice wording only if required and allowed)
- [ ] HC-funded coupons and credit: on or off per D9; VAT base per Q5
- [ ] Refund and deposit Stripe-fee absorption decided (D3)

**Operations**
- [ ] Payout path live (Connect with a real onboarded test partner on staging) or a documented manual process (D4)
- [ ] Customer self-cancel policy implemented (D5); failed-refund retry and finance alert live
- [ ] Host event cancellation refunds participants
- [ ] Deposit policy implemented or deposits removed (D6)
- [ ] Acknowledgement enforcement at least `require_web`; native policy decided
- [ ] Finance runbook: settlement run, transfers, refunds, disputes, partner debts, deposit claims

**Verification**
- [ ] Staging T1–T18 passed in TEST mode, with real HTTPS webhook delivery
- [ ] Reconciliation: local equals Stripe to the cent on staging
- [ ] Full regression: server, client, `qa:booking`, `qa:revenue`, `qa:lifecycle`, security, authz, browsers (Chromium, Firefox, WebKit) green
- [ ] Backups and restore drill current; rollback plan for every switch

**Go-live**
- [ ] Live Stripe keys installed by the owner (never via chat); live webhook endpoint and secret
- [ ] Switches turned on one at a time per §9 B6, each with a smoke payment and refund under €5 by the owner
- [ ] Explicit owner instruction to deploy

**Current status: 0 of these checked. Paid launch is NO-GO; free participation stays GO (release-readiness report).**

---

## Addendum (2026-10-11): misleading pricing UI corrected (R3B F1 / R2), uncommitted

A UI-only change. No pricing, VAT, fee, settlement or plan rule was changed, and no switch was touched.
- **Gate:** `client/src/partnerPricing.ts` holds `PARTNER_FEE_MODEL_CONFIRMED = false` and the neutral copy.
- **`/pricing`:** shows "Pricing for partners".
  - Kept: free listing, €0/month, no fee on free events.
  - Paid-booking fees: "being finalised". Pro: details to be confirmed.
  - Removed: the 9% / 7% plan cards, "No booking fee for your customers", the earnings and plan calculators,
    break-even, and weekly-transfer claims. The old view is kept behind the gate.
- **Pro details:** compares only the monthly price; per-booking fee rows and break-even are hidden. The fee-based
  benefits (`pro_benefit_1/2`) are hidden there and in the plan panel; the reward-month benefit stays.
- **Earnings:** the plan-model order estimator is hidden. The Balance card says transfers aren't switched on yet
  unless Connect is on.
- **Admin:** the Finance simulator is titled "hypothetical" with a note naming what checkout really uses. The Pro
  pricing rules section notes that its fee values feed only the estimator.
- **Still inconsistent:**
  - the public `GET /api/pricing/plans`, `/estimate`, `/compare` return plan-model figures;
  - help entries `platform_fee` and `pro_benefit_1/2` (database content, admin-editable) still describe the model;
  - Pro can be subscribed to (when `pro_subscriptions` is on) although its fee benefit isn't in force;
  - the unpublished Payments/Fees/Payouts policy draft may describe the model.
