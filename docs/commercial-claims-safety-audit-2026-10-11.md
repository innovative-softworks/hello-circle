# HelloCircle — Commercial Claims Safety Audit and Fix

Branch `feature/commerce-engine` (local, unpushed), 2026-10-11. Follows `docs/r3b-paid-launch-readiness-2026-10-11.md`
(finding F1) and the public pricing UI correction.

**Unchanged:** VAT, fee, pricing, settlement, subscription rules, database rows, commerce switches, live Stripe. Nothing
was committed, pushed or deployed.

**What changed:** fail-closed **server gates** and **additive** API labelling. Everything below is either verified in
code [V] or by a test named in §5.

---

## 1. Public pricing APIs

| Endpoint (actual method) | Returns | Consumers [V] |
|---|---|---|
| `GET /api/pricing/plans` | Free / Pro success fee, minimum fee, Pro price, VAT, break-even | `client/src/pages/Pricing.tsx` (only the gated "confirmed" view), `client/src/pages/ProDetailsPage.tsx` (fetched; the fee rows are gated) |
| `POST /api/pricing/estimate` (the brief said GET) | pe-2 order estimate (fee, fee VAT, partner pool) | `client/src/components/PricingCalculator.tsx` (now only mounted behind the gate) |
| `POST /api/pricing/compare` (the brief said GET) | Free vs Pro monthly comparison | `PricingCalculator.tsx` → `PlanComparisonCalculator` (gated) |

**Older clients:**
- The endpoints exist **only on this local, unpushed branch**. `git grep` finds no use on `main`, `staging`,
  `origin/*`, `v3-0`–`v5-0` or the feature branches. No deployed web build or released app calls them.
- The Expo mobile app isn't on any branch in this checkout. It's an open item: confirm before any app release.

**Change (additive, backward compatible).** Every field and figure is unchanged (asserted by `pricingPublic.test.ts`,
unchanged, plus `releaseGates.test.ts`). Each response gains:
- `status: "proposed"`, `inForce: false`;
- `notice: "Proposed partner pricing — not in force. HelloCircle doesn't charge these fees today; paid-booking pricing is being finalised."`;
- the header `X-HelloCircle-Fee-Model: proposed`.

The status comes from one server constant, `PARTNER_FEE_MODEL_STATUS = "proposed"`
(`server/src/commerce/releaseGates.ts`). Changing it is a reviewed code change, never a runtime toggle. No figure was
replaced with an invented rate. The checkout engine (`money.ts`, `pricing.ts`) is untouched.

---

## 2. Pro subscription gate

| Check | Before | Now | Evidence |
|---|---|---|---|
| `commerce.pro_subscriptions` default | off | off (unchanged) | `catalog.ts`; test "the Pro switch is off by default" |
| Pro checkout with the switch off | 409 `startProCheckout` | 409 (unchanged) | `subscriptions.ts:84` |
| Pro checkout **if the switch is turned on** | **allowed** | **409** unless the fee model is approved (the isolated `NODE_ENV=test` profile excepted, so the built flows stay tested) | `proPurchaseAllowed()`; test via the route `/host/plan/pro/checkout` with the switch on under `NODE_ENV=development` |
| Redeem points → free Pro month (activates Pro) | gated by `circle_credits` only | also needs the approved fee model | `rewards.ts redeemForProMonth`; tested |
| Admin turns `pro_subscriptions` / `circle_credits` on | allowed once prerequisites were on | **refused** (409) with "Pro and partner rewards stay off until the partner fee model is approved." Prerequisite messages still come first; turning off is always allowed | `catalog.ts switchChangeProblem`; tests in `releaseGates.test.ts` and the updated `stage5f.test.ts` |
| Admin grants Pro to a partner (`partner_plan_assignments`) | admin-only (finance) | unchanged: not public or partner-facing | — |
| Cancel / resume / billing portal | need an existing subscription | unchanged (only for existing subscribers) | `subscriptions.ts` |

**The UI constant can't enable anything.** `client/src/partnerPricing.ts` `PARTNER_FEE_MODEL_CONFIRMED` is read only by
display components. No API module and no server file reads it (client test "is read only by display code"). Every
purchase decision is made on the server.

---

## 3. Help text and policy drafts: correction list

Nothing here was changed. **Help entries** are database rows (`help_entries`, versioned, edited in Admin → Finance →
Field help, `legal` / `super` role). **Policies** are drafts (v1 seeded, not published; publication is blocked by
placeholders and a named legal sign-off). The quoted text is the seeded v1. A live database may hold later edits, so
re-check there before acting.

### 3.1 Help entries (`server/src/db/index.ts` seeds)

| Key | Current claim | Problem | Proposed text (for approval) |
|---|---|---|---|
| `platform_fee` | "HelloCircle's success fee on each completed paid order… a percentage of the fee base, with a minimum… Free events carry no fee." Example: "Free plan, €100 → 9% = €9.00; €5 → minimum €0.75" | Describes the unapproved model as in force | "HelloCircle's fee on paid bookings is being finalised and will be confirmed before you take paid bookings. Free events carry no fee." Remove the example |
| `platform_fee_vat` | "VAT charged on HelloCircle's fee — not on your activity. Your own activity's VAT is yours…" | Contradicts the ledger (HelloCircle records the activity VAT, R3B F2); VAT treatment is undecided (Q1–Q3) | "How VAT applies to HelloCircle's fee and to your activity is being confirmed with our tax adviser." |
| `fee_base` | "The amount the fee is calculated on: the service price after any discount you fund, minus anything refunded." | pe-2 concept not in force | Hide (no live fee base), or "Confirmed with the fee model." |
| `partner_payout` | "What you receive… once it completes and the review period passes." Formula "Fee base − HelloCircle fee − VAT on the fee" | The formula is the unapproved model | Keep the first sentence; replace the formula with "Shown per order once pricing is confirmed." |
| `pro_break_even` | "The monthly sales at which Pro's lower fee pays for its subscription." | Pro's lower fee isn't in force | Hide until D1 (the UI no longer shows it) |
| `pro_benefit_1` | "Lower success fee — Pro lowers the success fee HelloCircle keeps…" | Unapproved | Hide (already hidden in the UI) |
| `pro_benefit_2` | "Lower minimum fee…" | Unapproved | Hide (already hidden in the UI) |
| `pro_benefit_3` | "Your reward points can pay for a whole month of Pro…" | Rewards and Pro are both off and gated | Fine as written; shown only where Pro is reachable |
| `connect_transfer_vs_payout` | "A transfer is HelloCircle moving your settled earnings to your Stripe account (weekly)…" | Connect is off; weekly transfers aren't running (R3B F5) | Fine *when* Connect is on (it's only shown on the Payouts section, which appears only then). No change |
| `settled_due`, `available_balance`, `minimum_payout` | "…weekly settlement / next weekly payout / carry forward to the next week" | Same as above | Shown in the Balance card; the Balance intro now says transfers aren't on when Connect is off. Proposed: add "(when payouts are switched on)" |
| `pro_vat`, `pro_reverse_charge` | Standard IE VAT added, or reverse charge | Pro tax treatment is pending Q7 | Keep, flagged for adviser review |

### 3.2 Policy drafts (`server/src/policy/drafts.ts`, unpublished)

| Doc | Clause | Claim | Problem | Proposed correction |
|---|---|---|---|---|
| customer-booking-terms | §? line 88 | "The price shown at checkout is the price you pay. HelloCircle adds no booking fee for customers." | **False today:** checkout adds a 5% platform fee | "The total shown at checkout, including any fees and VAT, is what you pay." |
| general-terms | line 51 | "HelloCircle takes payment on the partner's behalf and passes it on…" | Agent model; the ledger books HelloCircle as supplier (F2); Q1 / Q10 | Hold for adviser and solicitor wording |
| vendor-venue-agreement | §3.1 | "HelloCircle charges the success fee for your plan, as published on the Pricing page, plus VAT on that fee. Your customers pay no booking fee." | Unapproved; customers *do* pay a fee | "Fees are set out in the Payments, Fees & Payout Policy as confirmed with you before paid bookings open." |
| host-agreement | §3.1 | "The success fee for your plan, as published on the Pricing page, plus VAT on that fee, is deducted from what customers pay." | Same | Same as above |
| payments-fees-payouts | §1.1–1.2 | Agent collection; funds held in HelloCircle's account, "not escrow" | Regulatory basis open (Q10) | Solicitor wording |
| payments-fees-payouts | §2.1–2.4 | Success fee by plan on the Pricing page; fee base; VAT on the fee deducted from payout; card processing included in the fee | Unapproved model; the Pricing page no longer publishes rates | Replace §2 after D1 / D2 |
| payments-fees-payouts | §3.2 | "Payouts are made weekly." | Not running (Connect off, F5) | Wording after D4 |
| pro-subscription-terms | §1 | "The price and the reduced success fee are published on the Pricing page." | Reduced fee unapproved; the page doesn't publish it | Remove "and the reduced success fee"; Pro is gated anyway |
| coupon-promotion-terms | clause 5 | "A partner-funded coupon reduces the partner's fee base. A HelloCircle-funded coupon doesn't reduce the partner's payout." | Fee base is pe-2; VAT base of a HelloCircle-funded coupon is open (Q5) | After D1 / Q5 |
| credits-wallet-terms | clause 3 | "Credits funded by HelloCircle don't reduce a partner's payout." | True in the ledger, but the VAT effect is open (Q5) | Adviser review |
| cancellation-refunds | §1.1 | "Cancelling within the window gives a full refund…" | Today the refund is **manual** (policy A); amount true, timing unstated | Add timing after D5 |
| cancellation-refunds | §2.1 | "If a partner cancels, the customer receives a full refund." | **Host-event cancellation doesn't refund automatically** (R3B) | Fix the code (R3B B2), or add "issued by the host" |

---

## 4. Paid checkout exposure matrix

**Before this change [V]:**
- The only server-side protection for paid customer checkout was a **missing `STRIPE_SECRET_KEY`** (503).
- `VENUE_PAGES_PUBLIC` is SEO-only on the server (`server/src/venueLaunch.ts`). The "coming soon" and venue gates are
  **client-side** (`client/src/venueLaunch.ts`, `App.tsx`).
- So any deployment with a Stripe key accepted paid checkouts **through the API**, whatever the UI hid.

**Now:** every paid customer checkout is created through `createCheckoutSession()` (`server/src/checkoutService.ts`),
which first checks `paidCheckoutOpen()`:
- `PAID_CHECKOUT=open` → allowed;
- `closed` → refused;
- **unset → refused in production**, allowed in development / test.

Callers already release their pending row on a refusal (verified for passes in a test: no row left).

| # | Entry point | Route | Client gate | Server gates (existing) | Commercial gate (new) | Launch config (prod, unset) |
|---|---|---|---|---|---|---|
| 1 | Venue hire | `POST /api/bookings/checkout` | Venue pages "coming soon" unless `VITE_VENUE_PAGES_PUBLIC` | approved centre, vendor not suspended, capacity hold, Stripe key | `createCheckoutSession` | **Refused (503)** |
| 1c | Venue hire, cash | same | same | no Stripe; booking confirmed, pay at venue | n/a (no online payment) | Allowed (free/cash GO) |
| 2 | Club registration | `POST /api/registrations/checkout` | venue gate (`/register`) | approved club; trial checks; Stripe key | ✓ | **Refused** |
| 3 | Programme enrolment | `POST /api/programs/:id/enroll` | **none** (programme pages public) | published, vendor not suspended, Stripe key | ✓ | **Refused** |
| 4 | Experience booking | `POST /api/experiences/:id/sessions/:sid/checkout` | **none** | approved, session, Stripe key (engine optional) | ✓ | **Refused** |
| 5 | Paid event join | `POST /api/games/:id/join` (price > 0) | **none** | host must be verified to set a price (`paid_games_require_verified_host`, on), Stripe key | ✓ | **Refused** |
| 6 | Open Booking / Make It Happen joiner | games / `makeItHappen` | — | `commerce.open_booking` off → 503 | ✓ (also via `createCheckoutSession`) | **Refused** |
| 7 | 10-session pass | `POST /api/passes/checkout` | resident, non-cash club | approved club, Stripe key | ✓ (tested) | **Refused** |
| 8 | Pro subscription | `POST /api/{vendor\|host}/plan/pro/checkout` | panel hidden when off | `pro_subscriptions` off | fee-model gate (§2) | **Refused (409)** |
| 9 | Points → Pro month | `POST /api/{vendor\|host}/plan/rewards/redeem` | — | `circle_credits` off | fee-model gate | **Refused** |
| 10 | Customer credit | experience quote / checkout | — | `customer_credits` off | only reduces a payment; checkout still gated | n/a |
| 11 | Mobile app (`X-Client-Platform: mobile`) | the same routes | app's own | same | same server gates | **Refused** |
| 12 | Free, €0 or cash orders | all of the above | — | never call Stripe | not gated by design | Allowed (free GO) |
| 13 | Webhooks for sessions created earlier | `/api/stripe/webhook` | — | signature, idempotency | not gated (must still settle existing payments) | Processed |
| 14 | Quotes (`/quote` endpoints) | read-only | — | rate-limited | not gated (no charge) | Allowed |

**Notes:**
- **Staging:** `deploy/staging/server.env.template` runs production mode, so staging also refuses paid checkout
  unless `PAID_CHECKOUT=open` is set for an approved TEST-mode run (documented in the template and the README env table).
- **Client:** venue, programme, experience and event pages still show paid prices and buttons where the client gates
  allow. With the gate closed the server answers 503 "Paid bookings aren't open yet — only free bookings are available
  for now." A client-side hide or "free only" mode isn't part of this change (proposed below).

---

## 5. Tests and results

| Suite | Result |
|---|---|
| `server/src/commerce/releaseGates.test.ts` (new, 13) | ✓ |
| `routes/pricingPublic.test.ts` (unchanged, compatibility) | ✓ |
| `commerce/stage5f.test.ts` (one assertion updated: rewards with the ledger on now wait for the fee model) | ✓ |
| Full server suite (isolated Docker DB) | 831 passed, 23 skipped (live-provider) |
| Client (`partnerPricing.test.tsx` + constant isolation) | 231 passed |
| `qa:revenue` / `qa:booking` / `qa:authorization` / `qa:security-gate` | 38 / 38 / 83 / 39 passed |

**What `releaseGates.test.ts` covers:**
- **Gate defaults:** production closed, explicit open and closed, `test` open.
- **The service:** `createCheckoutSession` refuses before any provider call.
- **A real paid route:** pass checkout returns 503 and leaves no pending row; the quote still works.
- **Pricing API:** status fields and header on all three endpoints, figures unchanged.
- **Pro:**
  - the model is a proposal;
  - `proPurchaseAllowed` is false in production and development;
  - switching on is refused even with prerequisites on, while turning off is allowed;
  - the switch is off by default;
  - with the switch forced on, checkout, redeem and the HTTP route are refused outside the test profile.
- **No financial figure changed:** `VAT_RATE` 0.23, `PLATFORM_FEE_RATE` 0.05, `DEPOSIT_CENTS` 10 000, and the v1
  defaults of `pricing`, `plan_free`, `plan_pro`, `tax_vat` and `settlement`.

---

## 6. Remaining P0 launch blockers

1. **The live site may already accept paid checkouts through the API.** Production runs `main`, which has none of these
   gates. `DEPLOYMENT.md` lists `STRIPE_SECRET_KEY` for prod (values not read). **The owner should confirm on the prod
   host whether `STRIPE_SECRET_KEY` is set.** If it is, either unset it until paid launch, or ship this gate to
   production (needs your explicit deploy instruction).
2. **Commercial model and VAT (R3B D1 / D2, Q1–Q5).** The underlying mismatch remains: checkout charges a 5% customer
   fee + VAT, while the plan rules hold 9% / 7%. It's labelled and gated, not resolved.
3. **Holding customer and partner money / deposits** — regulatory basis (Q10).
4. **No partner payout path while Connect is off** (F5).
5. **Customer-facing terms say "no booking fee for customers"** (customer-booking-terms draft). They're unpublished,
   but they must be corrected before publication (§3.2). No Customer Booking Terms are published at all, which blocks
   acknowledgement enforcement.
6. **Help entries in the database still describe the proposed model** (§3.1). UI exposure is reduced, but the entries
   need an admin edit (versioned) after approval of the proposed texts.

**Proposed next step (not done):** a client "free bookings only" mode that reads a public `/api/config` flag derived
from `paidCheckoutOpen()`. It would hide paid buttons and show "Paid bookings open soon" instead of a 503 after the
customer has filled in the form.

---

## 7. Follow-up: fixes applied (2026-10-11, uncommitted)

| Item | Fix | Where |
|---|---|---|
| Help entries describing the fee model (`platform_fee`, `platform_fee_vat`, `fee_base`, `partner_payout`, `pro_break_even`, `pro_benefit_1/2`) | At boot, a **new version** with neutral text ("…confirmed with you before you take paid bookings"). Only when the latest version is still system-written and differs; earlier versions are kept; an admin's edit is never overridden; re-running is a no-op | `server/src/db/index.ts` `correctFeeModelHelp()`, `FEE_MODEL_HELP_CORRECTIONS`; test `routes/help.test.ts` |
| Policy drafts' false fee sentences (customer-booking-terms "no booking fee", venue and host agreements' success fee, Pro "reduced success fee") | Seeds corrected. Existing **draft, system-authored** rows corrected at boot (sentence-level `REPLACE`); approved or published versions never touched | `server/src/policy/drafts.ts` `FEE_CLAIM_DRAFT_CORRECTIONS`; test `policy/drafts.test.ts` |
| Paid flows failing only at payment | "Free bookings only" mode: `/api/config` reports `paidCheckoutOpen`; venue hire, club registration, programme, experience and paid-event flows disable the card payment and say "Paid bookings aren't open yet — only free bookings are available for now."; the pass button is hidden. Free, cash, trial and pass-credit bookings unaffected. Display only: the server still refuses | `server/src/routes/config.ts`, `client/src/paidCheckout.ts` + the six flows; test `paidCheckout.test.ts` |
| Host / venue cancelling a paid event didn't refund participants | `cancelGameAndNotify` refunds every paid participant in full through the refund-once path (audited; a failure is audited and left for retry), and the notification says so | `server/src/routes/games.ts`; test `routes/gameCancelRefund.test.ts` |

**Still open (needs you or advisers):**
- whether production has a Stripe key (I wasn't permitted to read prod);
- shipping these gates to production (deploy instruction);
- commercial model and VAT (D1/D2);
- legal basis for holding funds (Q10);
- the partner payout path (D4);
- publishing the customer booking terms;
- the remaining payments-policy wording that depends on those decisions (§3.2: agent model, §2 fees, weekly payouts).

**Follow-up results:**

| Suite | Result |
|---|---|
| Server | 837 passed, 23 skipped (live-provider) |
| Client | 236 passed |
| `qa:revenue` / `qa:booking` / `qa:lifecycle` / `qa:product` / `qa:authorization` / `qa:security-gate` | 38 / 38 / 52 / 68 / 83 / 39 passed |
| `qa:stripe` (TEST mode, targeted) | 18 passed: PREFLIGHT, PAY-ACTIVITY, REFUND-*, R3A-*, UI |
