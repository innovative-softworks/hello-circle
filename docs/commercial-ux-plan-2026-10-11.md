# HelloCircle — Commercial UX Architecture and Implementation Plan

Branch `feature/commerce-engine` @ `e2a74a6` + uncommitted booking-UX Phases 0–7, 2026-10-11.
**Plan only.** No code, schema, rule, switch or data was changed to produce this.

This plan builds on, and doesn't repeat:
- `docs/booking-checkout-audit-2026-10-11.md` (the P0/P1 list)
- `docs/booking-ux-implementation-plan-2026-10-11.md` (booking kit, S1–S10, Phases 0–7, done)
- `docs/booking-release-readiness-2026-10-11.md` (free GO / paid NO-GO)
- `docs/revenue-connect/09-subscription-rewards-ux.md` (Stage 5f plan, rewards, credit and admin UX, done)

Labels: **[V]** verified in code for this plan · **[A]** assumption or owner decision.

---

## 0. Summary

Most of the commercial surface already exists. Stages 2a–5f and the booking-UX phases built:
- the plan, rewards and credit screens;
- coupons and a server-quoted checkout;
- refunds, payouts and finance admin.

What's left is **mostly placement, consistency and a handful of real gaps**, not new systems.

**Real gaps found in this audit [V]:**

| # | Gap | Evidence |
|---|---|---|
| G1 | **Receipts leave out experience bookings.** The receipts query unions bookings, registrations, games, passes and programme enrolments, but no experiences | `server/src/routes/residents.ts:989–1023`; `Receipt.kind` in `packages/types/src/index.ts:1575` |
| G2 | **A game receipt shows the list price, not the amount charged.** It uses `COALESCE(g.price_cents, 0)`, so a coupon-discounted join shows the undiscounted total | `residents.ts:1003` |
| G3 | **Receipts are one line each.** No breakdown (VAT, fee, coupon, credit, card), no refund line, a raw `paymentStatus` string, and no detail view | `client/src/pages/Profile.tsx:773–804` |
| G4 | **Programmes have no coupon field.** The server accepts `couponCode` on quote and enrol, but `quoteProgram()` and `enrollInProgram()` in the client never send it | `server/src/routes/programs.ts:190,205`; `client/src/api/public.ts:497,580` |
| G5 | **Pass price is a client-side estimate** (`club.price × 10 × (1+VAT+fee)`, rounded). It can differ from the charge (known P1) | `client/src/pages/ClubDetail.tsx:292` |
| G6 | **Partners have no payout/transfer history.** They see balance tiles and settlements; transfers and bank payouts exist only in Admin → Finance | `EarningsSummary.tsx`; `adminFinance.ts:221,387`; `payouts.ts` has account routes only |
| G7 | **The Earnings tab is one long stack:** payout account, venue splits, the full plan & rewards panel, balance, settlements, then the transaction list. "Plans & billing" has no home of its own | `EarningsSummary.tsx:40–42` |
| G8 | **Vendor Offers can only target centres and clubs.** No experiences or programmes, and no start date, minimum spend or redemption history (admin coupons v2 has those) | `VendorOffers.tsx`; `VendorCouponInput` in `api/vendor.ts:345` |
| G9 | **Two checkout-breakdown components:** the kit's `summary.tsx` + `quoteLines.ts` (bookings, registrations) and the older `CheckoutBreakdown.tsx` (experiences, games). Same idea, two renderings | `components/booking/`, `components/CheckoutBreakdown.tsx` |
| G10 | **Nothing on listings says "free" or "free trial".** Cards and Explore carry no commercial signal; free is the product's strongest hook | `CentreCard`, `ClubCard`, `ExperienceCard` (no matches) |

**Blocked, and to stay blocked in this plan.** These are business or legal decisions, not UX:
- the VAT/commercial model (P0, paid NO-GO);
- Open Booking and Make It Happen (`commerce.open_booking` off);
- refunds on customer self-cancel (policy A);
- deposit return (manual);
- enforcing acknowledgements;
- a live Stripe Connect onboarding (needs a person);
- boost vouchers (`activeFromPhase: 7`).

Every commerce switch except `paid_games_require_verified_host` defaults **off** (`server/src/commerce/catalog.ts:386–399`).

**Recommendation:**
1. Run **R1 (free UX)** now. It's safe under the free GO.
2. Build **R2 (commercial UI on fixtures)** in parallel.
3. Hold **R3/R4** until the VAT decision.

No new top-level navigation is needed. All target placements fit into existing tabs and sections.

---

## 1. Current-versus-target page inventory

Status: ✅ implemented · 🟡 partial · ❌ missing · ⛔ blocked (a decision, not code). Switch = the gating `commerce.*` switch.

### 1.1 Customer (guest or resident)

| Surface | Route · component | Commercial feature | Now | Target | Switch |
|---|---|---|---|---|---|
| Explore / Browse / Home rows | `/explore`, `/browse/:cat`, `/home` · `*Card`, `DiscoverRow` | Price "from €X" | ✅ | + `Free` / `Free trial` chip (G10) | — |
| | | Offer/discount badge | ❌ | **Don't add yet.** Coupons are code-only; there are no public auto-applied promotions. Add only when the server returns a public offer flag (R4) [A] | — |
| Listing detail | `/centres/:id`, `/clubs/:id`, `/experiences/:id`, `/programs/:id`, `/games/:id` | Price block | ✅ | One `PriceFrom` line from the server quote. Remove the client pass estimate (G5) | — |
| Venue booking | `/book/:centreId` · `BookingFlow` (kit) | Server quote, coupon | ✅ | Credit line when credits extend beyond experiences (R4) | `customer_credits` |
| Club registration | `/register/:clubId` · `RegistrationFlow` (kit) | Quote, coupon, trial, pass credit | ✅ | — | — |
| Experience booking | `ExperienceDetail` panel | Quote, coupon, **customer credit** | ✅ | Move onto the kit summary (G9) | `engine_v2_experience`, `customer_credits` |
| Programme enrolment | `ProgramDetail` dialog | Quote | 🟡 | + coupon field (G4) | — |
| Game join | `GameJoinCard` | Quote, coupon | ✅ | Kit summary (G9) | — |
| Pass purchase | `ClubDetail` button → `/api/passes/checkout` | Price | 🟡 | Server-quoted price (G5) | — |
| Payment result | `/payment/success`, `/payment/cancel` (kit) | Status, hold release | ✅ | Show coupon/credit used and remaining credit when present | — |
| My bookings | `/bookings` · `MyBookings` | Refund badges, self-cancel, deadline | ✅ | Same refund vocabulary on every row type (one `RefundStatus` chip) | — |
| Receipts | `/profile?section=receipts` · `ReceiptsPanel` | List | 🟡 | All kinds incl. experiences (G1), the amount actually charged (G2), a detail drawer with the frozen breakdown + refunds (G3) | — |
| Wallet | `/profile?section=credit` · `CreditWallet` | Balance, expiry, history | ✅ | Linked from the checkout credit line and from receipts ("Credit restored") | `customer_credits` |
| Payment methods | `/profile?section=payment` · `PaymentMethodsPanel` | List, default, remove | ✅ (never run against live Stripe) | — | — |
| Passes | `/profile?section=passes` · `PassesPanel` | Credits left | ✅ | — | — |
| Open Booking / Make It Happen | `/make-it-happen`, booking option | Cost-sharing | ⛔ | Unchanged until it's repriced | `open_booking` |

### 1.2 Host (resident organiser) — `/manage`

| Surface | Route · component | Now | Target | Switch |
|---|---|---|---|---|
| Overview | `/manage` · compact `PlanRewardsPanel` (verified hosts only) | ✅ | — | `pro_subscriptions`, `circle_credits` |
| Earnings | `?tab=earnings` · `HostEarningsTab` → `EarningsSummary` | 🟡 (G7) | Sub-sections: **Balance · Payouts · Plan & billing** (§3.3) | `settlement_ledger`, `connect_v1` |
| Payout account | `PayoutAccountCard` | ✅ | Moves under Payouts | `connect_v1` |
| Payout history | — | ❌ (G6) | Transfers + bank payouts list | `connect_v1` |
| Venue splits | `VenueSplitsCard` | ✅ | Stays in Balance | `venue_host_split_payout` |
| Pro details | `/manage/pro` · `ProDetailsPage` | ✅ | — | `pro_subscriptions` |
| Rewards | `/manage/rewards` · `RewardsHistoryPage` | ✅ | — | `circle_credits` |
| Offers | `?tab=offers` · `HostOffersTab` (game coupons) | ✅ | + redemptions column (G8 parity) | `coupons_v2` (ledger) |
| Paid activity gate | `HostGamePage` | ✅ (verified-host rule) | — | `paid_games_require_verified_host` |

### 1.3 Vendor — `/vendor`

| Surface | Route · component | Now | Target | Switch |
|---|---|---|---|---|
| Overview | compact `PlanRewardsPanel`, `VendorActionNeeded` | ✅ | — | — |
| Bookings / orders | `?tab=bookings` · `VendorBookings`, `GET /vendor/orders` | ✅ | — | — |
| Refunds | `POST /vendor/refunds` (finance role) | ✅ | — | — |
| Earnings | `?tab=earnings` · `PaymentsPanel` → `EarningsSummary` + `VendorPayments` | 🟡 (G7) | Same three sub-sections as hosts | as hosts |
| Payout history | — | ❌ (G6) | As hosts | `connect_v1` |
| Pro / rewards | `/vendor/pro`, `/vendor/rewards` | ✅ | — | as hosts |
| Offers | `?tab=offers` · `VendorOffers` | 🟡 (G8) | All listing types, start date, minimum spend, redemption history | `coupons_v2` |
| Trader profile | `TraderProfileForm` | ✅ | — | — |

### 1.4 Admin — `/admin`

| Surface | Now | Target |
|---|---|---|
| Commercial rules (`AdminCommerce`, sectioned, switch dependencies → 409) | ✅ | — |
| Finance (15 sub-tabs: overview, simulator, settlements, transfers, debts, credits & Pro, rewards, coupons, payouts, events, refunds, disputes, plans & promotions, help, roles) | ✅ | — |
| Coupons (top-level tab, configuration) **and** Finance → Coupons (usage) | 🟡 | Keep both. Cross-link them ("View usage" ↔ "Edit coupon") so there's one obvious place to configure [A] |
| Pricing page `/pricing` + `PricingCalculator` | ✅ | — |

---

## 2. Role-based journey maps

Each row is: **trigger → screens → system truth → what the person sees**. "Quote" always means the server quote
(`/api/bookings/quote`, `/registrations/quote`, `/programs/:id/quote`, `/games/:id/quote`, `/api/commerce/quotes`).

### 2.1 Customer

| Scenario | Path | Must hold |
|---|---|---|
| First-time, free | Card with `Free` chip → detail → Join (no payment step) → confirmation → My bookings | No price row, no card form, no "€0.00 checkout" |
| First-time, paid (guest) | Detail → flow → review (quote) → Stripe → `/payment/success` (polls) → email | The total on review = the Stripe amount = the receipt amount |
| Returning resident | Flow pre-fills household → review shows "Credit available €X" if any | Credit is offered, never auto-applied silently [A]: one tap "Use credit", then re-quote |
| Coupon valid | Enter code → re-quote → line `Coupon CODE −€X` | Server-validated. Chip removable |
| Coupon expired / limit / not eligible | Enter code → inline error with the server reason → total unchanged | Never keep a stale discount on screen. The pay button stays enabled at the full price |
| Coupon expires between review and pay | The server re-prices at checkout creation → 409 → banner "This code has expired. Your total is now €Y" → re-confirm | The order never goes through at a price the person didn't see |
| Credit ≥ total | Card due €0 → "Confirm" (no Stripe) | Server confirms with no card (existing) |
| Payment failed / closed | `/payment/cancel` → hold released (`/checkout/:ref/abandon`) → "Try again" keeps the draft | Reserved credit is released (existing lifecycle) |
| Cancel within window | My bookings → Cancel → confirm dialog with the refund state → badge "Refund pending/issued" | Copy comes from server `refundState`. Self-cancel refund = vendor action (policy A, ⛔) |
| Cancel after the deadline | Button hidden; "Contact the venue" | Server `canCancel=false` |
| Provider cancels | Email + My bookings badge "Refunded €X" + credit restored if used | Auto-refund exists (`providerCancelRefund.ts`) |
| Partial refund | Receipt detail: `Refunded −€X (date)`; wallet: `Credit restored €Y` (D1 proportional) | Both from the server |
| Find a receipt | Profile → Receipts → row → drawer (G3) | The frozen snapshot, not a recalculation |

### 2.2 Host

| Scenario | Path | Must hold |
|---|---|---|
| First paid activity | Host page → price field → blocked unless verified (copy points to the host application) | Existing rule |
| Get paid (first time) | Earnings → Payouts → "Set up payouts" (Stripe Express) → back → status | ⛔ live until a person completes onboarding. Test mode only |
| Weekly payout | Earnings → Balance (pending → available → due) → Payouts list (transfer → bank payout) | G6 list |
| Payout failed / account restricted | Payouts: red status row + "Update details in Stripe" (dashboard link) | Status from `/payout-account/refresh` |
| Upgrade to Pro | Overview "Explore Pro" → `/manage/pro` → Stripe → processing → active | Existing 5f flow |
| Payment for Pro fails | Panel `payment_failed` + grace days → billing portal | Existing |
| Downgrade / cancel | Plan & billing → Cancel → `cancelling` → Keep Pro | Existing |
| Earn / redeem points | Settlement → points → Rewards → redeem a free month | Existing. Points debt is shown |
| Create an offer | Offers → new code → share link | Expired/used-up codes are greyed with the reason |
| Refund a participant | Activity → participant → Refund (full/partial) → confirm | Server-computed maximum refundable |

### 2.3 Vendor (owner; invited staff are narrowed by RBAC)

As the host, plus:
- **Finance staff** see Plan & billing **read-only** (D2).
- **Other staff** get a neutral line.
- Refunds require `requirePlatformRole("finance")`.
- Deposit due → `VendorActionNeeded` → mark returned (manual, ⛔ automation).

### 2.4 Admin (finance / legal / super)

| Scenario | Path |
|---|---|
| Turn on a feature | Commercial rules → Switches. Dependencies enforced with 409 + the prerequisite named |
| Change Pro price / reward rate / credit rules | Draft → impact preview → publish (second approver if switched on) |
| Grant goodwill credit | Finance → Credits & Pro → Grant (idempotency key, confirmation step) |
| Investigate a refund or dispute | Finance → Refunds / Disputes → order → ledger entries |
| Run settlements and transfers | Finance → Settlements (dry run) → Transfers |
| Launch a promotion | Coupons (configure: funding, limits, dates) → Finance → Coupons (watch usage). Partner campaigns: Finance → Plans & promotions |

---

## 3. Navigation and feature-placement architecture

### 3.1 Principles
1. **Money appears where a decision is made, not everywhere.** No upsell banners on Explore. Pro is shown only to
   partners, only in Overview (compact) and Earnings.
2. **One concept, one component.** Use the scope prop (`vendor | host`) as 5f did. Don't build parallel vendor and host screens.
3. **Server is the source of every number.** The client formats and never adds things up (§5).
4. **A hidden switch means a hidden UI.** When a switch is off, the section doesn't render. No "coming soon" money teasers.

### 3.2 Placement map

| Area | Shows | Never shows |
|---|---|---|
| Explore, search, cards | `Free`, `Free trial`, `From €X` | Discount %, Pro, credit balance |
| Listing detail | Price from the quote, cancellation policy summary, "Have a code?" (inside the flow, not on the page) | Coupon entry on the page itself |
| Booking / checkout review | Ordered breakdown: price → taxes/fees → −coupon → −credit → **card due**. Policy line | Partner fees, points |
| Confirmation | Paid amount, coupon/credit used, remaining credit, "View receipt" | Upsell to Pro |
| My bookings | Status + `RefundStatus` chip + cancel deadline | Price recalculation |
| Profile | Wallet (credit), Receipts, Payment methods, Passes | Points (a partner concept) |
| Partner Overview | Compact plan & rewards panel, action-needed items | Full billing details |
| Partner Earnings | Balance · Payouts · Plan & billing (sub-sections) | — |
| Rewards | `/vendor|manage/rewards` (existing) | — |
| Offers | Partner coupons + redemptions | Platform-funded campaigns (admin only) |
| Admin | Commercial rules, Finance, Coupons | — |

### 3.3 Earnings restructure (G7)
Today `EarningsSummary` stacks five cards. Target: one tab with a segmented control (`ui.tsx` `Tabs`, already used
in `PaymentsPanel`).

```
Earnings
 ├─ Balance        (default)  balance tiles · settlements · venue splits · transactions (VendorPayments / HostGameEarning)
 ├─ Payouts                   PayoutAccountCard · payout history (new, G6)              — hidden if connect_v1 off
 └─ Plan & billing            PlanRewardsPanel full · link to Pro details / rewards    — hidden if pro + rewards off
```

Deep links: `?tab=earnings&view=payouts|plan`. The Overview "Manage plan" link goes to `view=plan`. No logic changes:
this only moves existing components.

---

## 4. Screen-by-screen specifications

Shared rules for every screen:
- **Design:** booking surfaces use the booking kit (Figtree body, Bricolage headings, `[data-surface="booking"]`).
  Dashboards use `theme.ts` + `ui.tsx`.
- **Loading:** skeletons (`RowSkeleton`, `PageSpinner`).
- **Errors:** an inline `role="alert"` with a retry button.
- **Live values:** money updates are announced with `aria-live="polite"`.
- **Targets:** at least 44 px.
- **Mobile:** 320 px minimum, a 16 px gutter, sticky primary action above `MobileTabBar`.

### C1 — Listing price signal · `CentreCard`, `ClubCard`, `ExperienceCard`, `DiscoverRow` · any visitor
- **Content:** `Free` chip (price 0 and no paid options), `Free trial` chip (`club.trial`), otherwise the existing "from €X".
- **API:** existing list payloads. Confirm the fields are present; add `hasFreeTrial` to the list query only if missing [A].
- **States:** none new.
- **Accessibility:** the chip is text, not just colour.
- **Acceptance:**
  - a free game shows `Free`;
  - a trial club shows `Free trial`;
  - a paid centre is unchanged;
  - no discount badges anywhere.

### C2 — Checkout summary (unified) · kit `summary.tsx` + `quoteLines.ts` · all five paid flows
- **Order:** subtotal → VAT/fee rows exactly as the server labels them → `Coupon CODE −€x` → `HelloCircle credit −€y`
  → **Card payment due** (bold) → policy line.
- **Actions:**
  - Primary: `Pay €Z` / `Confirm` (when €0 is due).
  - Secondary: "Have a code?" (disclosure), "Use credit" (switch on, balance > 0).
- **API:** the flow's quote endpoint. It re-quotes on every input change, debounced 300 ms, and drops stale responses
  (the `useQuote` request-id pattern).
- **States:**
  - loading: the line shimmer keeps the layout height;
  - quote error: "We couldn't price this. Try again" and the pay button is disabled;
  - coupon error: inline under the field, with the server message;
  - 409 at checkout: banner + the new total + re-confirm.
- **Mobile:** collapsible "Total €Z ▾" bar pinned above the action.
- **Acceptance:** the client never computes a total, and the unit test asserts that `quoteLines` only maps server fields.
  Experiences and games migrate off `CheckoutBreakdown.tsx` (G9).

### C3 — Programme coupon · `ProgramDetail` enrol dialog
- **Change:** pass `couponCode` to `quoteProgram` and `enrollInProgram` (server ready, G4).
- **Acceptance:**
  - a valid code lowers the quoted and charged total;
  - an invalid code shows the server reason;
  - the enrolment row records the coupon.

### C4 — Pass price · `ClubDetail` pass button
- **Change:** the label shows the server quote for a 10-session pass. The `VAT_RATE`/`PLATFORM_FEE_RATE` client constants go away (G5).
- **API:** reuse the pricing the pass checkout already uses. A new `GET /api/passes/quote` is needed if none exists [A].
- **Acceptance:** the label equals the Stripe amount to the cent.

### C5 — Payment result · `PaymentSuccess` / `PaymentCancel`
- **Adds:** "Coupon CODE −€x", "Credit used €y · €r left" (from the status endpoint), and "View receipt" (opens C7).
- **Acceptance:** no extra API calls when neither coupon nor credit was used.

### C6 — My bookings refund chip · `MyBookings` rows
- **Change:** one `RefundStatus` component (`none | pending | issued | partial | failed`) built from server `refundState`
  on every kind: booking, registration, enrolment, experience, game.
- **Copy:** follows policy A (a vendor-issued refund) until the policy changes.
- **Acceptance:** the same state gives the same chip text in every row type.

### C7 — Receipts list + detail drawer · `Profile` → Receipts · resident
- **List:** all kinds (adds `experience`, G1). The amount is what was charged (G2). Status uses human labels
  (`Paid`, `Refunded`, `Part-refunded`, `Pending`, `Failed`).
- **Detail (Drawer):**
  - the frozen breakdown (pricing snapshot or the row's stored components);
  - payment method last 4 digits if known;
  - refunds (date, amount);
  - credit used and restored;
  - links to the booking and "Need help?" (complaints).
- **API:**
  - extend `GET /residents/me/receipts`;
  - new `GET /residents/me/receipts/:ref`, own rows only (auth via `resident_id`).
- **Out of scope:** "VAT invoice" download, which depends on the VAT model ⛔.
- **States:** empty "No payments yet" (exists); a detail-load error keeps the list.
- **Acceptance:**
  - an experience payment appears;
  - a discounted game shows the discounted total;
  - a partial refund shows both lines;
  - another resident's `ref` → 404.

### C8 — Wallet · `CreditWallet` (exists)
- **Adds:** deep-link anchors so checkout's "Use credit" info and receipts' "Credit restored" link here.
- **Acceptance:** hidden entirely when `customer_credits` is off. Never shows "points".

### P1 — Earnings segmented view · `HostEarningsTab`, `VendorDashboard` `PaymentsPanel` · host, vendor owner/finance
- **Layout:** §3.3. The default view is Balance.
- **Behaviour:** sections whose switches are off are not rendered (and neither are their segment buttons). With only one
  segment left, the control is hidden.
- **Accessibility:** `role="tablist"`, arrow-key navigation (existing `Tabs`).
- **Acceptance:**
  - the same components and data as today;
  - `?view=` deep links work;
  - finance staff see the Plan view read-only.

### P2 — Payout history · new `PayoutHistory` (scope prop) · host, vendor owner/finance
- **Columns:** date, type (`Transfer to Stripe` / `Bank payout`), amount, status (`In transit`, `Paid`, `Failed`,
  `Reversed`), settlement reference.
- **API:** new `GET /api/{vendor|host}/payout-account/history`, scoped to the caller's own connected account.
  Read-only, from the existing transfer/bank-payout tables.
- **States:**
  - empty: "No payouts yet. Settled earnings are transferred weekly once they reach €{min}" (min from the `settlement`
    rule, not hardcoded);
  - restricted account: an alert linking to the Stripe dashboard.
- **Acceptance:**
  - only own rows (a cross-tenant test);
  - amounts equal the admin Finance values;
  - hidden when `connect_v1` is off.

### P3 — Offers (vendor parity) · `VendorOffers`, `HostOffersTab`
- **Adds:**
  - targets: experiences and programmes;
  - optional start date and minimum spend (the fields coupons v2 already enforces);
  - a redemption history drawer: date, booking ref, discount, state reserved/confirmed/released.
- **API:** extend `POST /vendor/coupons` validation; new `GET /vendor/coupons/:id/redemptions`, owner-scoped.
- **States:**
  - the code clashes → inline error;
  - expired → grey row with "Expired {date}";
  - used up → "Limit reached".
- **Acceptance:**
  - a vendor can't target another org's listing;
  - a negative or > 100% amount is refused server-side (exists, R4);
  - redemptions match the ledger.

### P4 — Plan & billing, Pro details, Rewards · existing 5f screens
Unchanged; they're only re-hosted under P1's "Plan & billing". Specs: `09-subscription-rewards-ux.md`.

### A1 — Admin coupon cross-links · `AdminDashboard` Coupons ↔ Finance → Coupons
- **Change:** "View usage" and "Edit coupon" links between the two.
- **Acceptance:** no duplicate forms.

### A2 — Commercial-switch readiness hints · `AdminCommerce` switches
- **Change:** show what turning a switch on makes visible to customers and partners. The text lives in the catalog's
  `description`, extended.
- **Acceptance:** text only. No behaviour changes.

---

## 5. Commercial interaction rules

| Interaction | Rule |
|---|---|
| Prices | Every total, VAT, fee, discount, credit and card-due figure comes from a server quote or a frozen snapshot. The client may only format. Lint guard: no `VAT_RATE`/`PLATFORM_FEE_RATE` imports in pages (G5 is the last offender) |
| Coupon validation | Validated on quote and again at checkout creation. Server reasons map to copy: `invalid`, `expired`, `not_started`, `limit_reached`, `per_customer_limit`, `min_spend`, `not_eligible`. `/api/coupons/validate` stays rate-limited (R5 fix) |
| Coupon expiry mid-flow | 409 + the new quote. The person must re-confirm |
| Credit redemption | Opt-in per checkout. The server decides how much is usable (≤ the eligible amount) and **reserves** it on checkout creation. It's released on expiry, cancel or abandon, and restored in proportion on refund (D1) |
| Credit expiry | The wallet shows the earliest expiry. Expired lots are listed as "Expired". There's no expiry warning email in scope [A] |
| Refund status | Server `refundState` only. Copy follows policy A until it changes ⛔ |
| Payout history | Read-only. Amounts in minor units from the ledger and transfer tables |
| Subscription | States are server-derived (5f table). The client never infers a state from dates |
| Reward earning | Shown as pending until settlement, then available. Reversals as negative rows. Debt is always visible |
| Promotion eligibility | Partner campaigns (founding plan) are admin-assigned and appear in Plan & billing as "Founding partner rate until {date}". No customer-facing promotions until public offers exist (R4) |
| Idempotency | Pay, redeem, refund and grant buttons disable while in flight. The server keys stay as they are |

---

## 6. Shared component architecture

| Component | Location | Status | Used by |
|---|---|---|---|
| `BookingShell`, fields, `DateSlotPicker`, `summary`, `useQuote`, `quoteLines` | `components/booking/` | ✅ | C2–C5 |
| `PriceChip` (`Free`, `Free trial`, `From €X`) | `components/booking/` or `ui.tsx` | ❌ new | C1 |
| `CouponField` (extracted from the BookingFlow / GameJoinCard / Experience duplicates) | `components/booking/` | 🟡 extract | C2, C3 |
| `CreditToggle` | `components/booking/` | 🟡 extract from ExperienceDetail | C2 |
| `RefundStatus` chip | `components/booking/` (wraps `refundBadgeText`) | 🟡 extract | C6, C7 |
| `ReceiptDrawer` | `components/` (uses `Drawer`) | ❌ new | C7, C5 |
| `PayoutHistory` (scope) | `components/` | ❌ new | P2 |
| `EarningsSummary` → `EarningsTabs` (scope) | `components/` | 🟡 restructure | P1 |
| `CouponRedemptions` drawer | `components/` | ❌ new | P3 |
| `PlanRewardsPanel`, `ProDetailsPage`, `RewardsHistoryPage`, `CreditWallet`, `PayoutAccountCard`, `VenueSplitsCard` | existing | ✅ | unchanged |
| `CheckoutBreakdown.tsx` | existing | retire after the C2 migration | — |

Fixtures for R2: `client/src/components/booking/__fixtures__/commerce.ts`, rendered at the dev-only `/dev/booking-kit`
(already gated by `import.meta.env.DEV`). They're never shipped to production bundles.

---

## 7. Mobile and desktop layout requirements

| Element | Mobile (320–767) | Desktop (≥ 1024) |
|---|---|---|
| Checkout summary | Collapsible total bar pinned above the action and `MobileTabBar` (16 px gap, as HC-QA-001 measured) | Sticky right column, 360 px |
| Coupon / credit | Full-width disclosure rows | Inline in the summary card |
| Receipt detail | Full-screen sheet (`Drawer` bottom) | Right drawer, 480 px |
| Earnings segments | Scrollable segmented control, sticky under the header | Inline tabs |
| Payout / redemption tables | Stacked cards (label/value pairs). No horizontal scroll | Table |
| Price chips | One line, truncated with the full text in `aria-label` | Same |

Both layouts:
- No horizontal page scroll at 320 px.
- Focus is visible.
- Respects `prefers-reduced-motion`.
- Works with the cookie banner open.

---

## 8. Dependencies and phased roadmap

| Phase | Scope | Depends on | Ships to | Risk |
|---|---|---|---|---|
| **R1 Free UX** | C1 price chips · C6 `RefundStatus` unification · P1 Earnings segments (layout only) · A1 cross-links · A2 switch hints | None. Pricing untouched | Staging (under the free GO) | Low |
| **R2 Commercial UI on fixtures** | C2 unified summary (render tests on fixtures) · C7 `ReceiptDrawer` · P2 `PayoutHistory` · P3 redemptions drawer · `CouponField`/`CreditToggle` extraction | R1 · dev-only fixtures · no API changes | Dev only (`/dev/booking-kit`) | Low |
| **R3 Payment & pricing integration** | Wire R2 to real APIs: receipts (G1–G3), payout history API, coupon redemptions API, programme coupon (G4), pass server quote (G5), migrate experiences/games onto C2 (G9) | **VAT/commercial model decision (P0)** for any paid go-live · staging webhook delivery | Staging; prod only after the paid GO | Medium. Totals must match Stripe (the `qa:stripe` gate) |
| **R4 Subscriptions & rewards activation** | Switch on in staging in dependency order: `settlement_ledger` → `connect_v1` → (`venue_host_split_payout`) → `circle_credits` → `pro_subscriptions` → `engine_v2` → `engine_v2_experience` → `customer_credits` → `coupons_v2`. Public offer badges only if a server public-offer flag is added | R3 · a person completes Express onboarding · real Stripe Pro checkout · billing portal configured · solicitor/tax sign-off | Staging → prod by explicit owner instruction per switch | High (money movement) |

**Hard rules:**
- No phase changes VAT, the fee, pricing rules, settlement timing or subscription rules.
- `commerce.open_booking`, `boost_vouchers` and self-cancel auto-refunds stay off or unchanged.
- Nothing is pushed or deployed without an explicit instruction (standing rule).

---

## 9. Test and acceptance matrix

Levels: **U** = Vitest unit (client or isolated server) · **B** = Playwright `qa:*` (desktop + mobile) · **S** =
`qa:stripe` (TEST mode only).

| # | Case | Phase | U | B | S |
|---|---|---|---|---|---|
| 1 | Free listing shows `Free`; trial club shows `Free trial`; paid card unchanged | R1 | ✓ | ✓ | |
| 2 | `RefundStatus` same text for the same state across 5 row kinds | R1 | ✓ | ✓ | |
| 3 | Earnings segments hide when switches are off; `?view=` deep links; finance staff read-only | R1 | ✓ | ✓ | |
| 4 | Summary renders server lines only; the client never sums (guard test) | R2 | ✓ | | |
| 5 | Coupon errors map for all 7 reasons | R2/R3 | ✓ | ✓ | |
| 6 | Coupon expires between review and pay → 409 → new total shown | R3 | ✓ | ✓ | ✓ |
| 7 | Credit opt-in → re-quote → reserved → released on cancel/abandon | R3 | ✓ | ✓ | ✓ |
| 8 | Zero card due confirms without Stripe | R3 | ✓ | ✓ | |
| 9 | Receipts include experiences; a discounted game shows the charged amount | R3 | ✓ | ✓ | |
| 10 | Receipt detail: full + partial refund lines, credit restored; another resident's ref → 404 | R3 | ✓ | ✓ | ✓ |
| 11 | Programme coupon lowers both quote and charge | R3 | ✓ | ✓ | ✓ |
| 12 | Pass label = Stripe amount to the cent | R3 | ✓ | | ✓ |
| 13 | Payout history own-rows only; equals admin Finance; restricted-account banner | R3 | ✓ | ✓ | ✓ |
| 14 | Vendor coupon for an experience/programme; cross-org target refused; redemptions match the ledger | R3 | ✓ | ✓ | |
| 15 | Switch activation order enforced (409 on a wrong order) | R4 | ✓ (exists) | ✓ | |
| 16 | Pro checkout → processing → active; payment_failed → portal; cancel → keep | R4 | ✓ (exists) | ✓ (exists) | ✓ manual live-test owed |
| 17 | Points earn → redeem → reversal → debt | R4 | ✓ (exists) | ✓ (exists) | |
| 18 | Accessibility: keyboard-only checkout, `aria-live` totals, VoiceOver pass on C2/C7/P1 | R1–R3 | | ✓ | manual |
| 19 | 320 / 390 / 768 / 1280 px: no horizontal scroll; action not hidden by the tab bar or cookie banner | R1–R3 | | ✓ | |
| 20 | Regression: `qa:booking`, `qa:revenue`, `qa:lifecycle`, security + authz suites stay green | every phase | ✓ | ✓ | ✓ |

---

## 10. Decisions needed before building

| # | Decision | Recommendation |
|---|---|---|
| U1 | Discount or offer badges on listing cards | **No** for now. Only `Free` / `Free trial`. Revisit when public promotions exist (R4) |
| U2 | Earnings: segments in one tab vs. new top-level "Plan & billing" tab | **Segments** (no new nav; §3.3) |
| U3 | Credit at checkout: opt-in toggle vs. auto-apply | **Opt-in** (clearer, reversible, avoids surprise spend) |
| U4 | Receipt detail now, VAT invoice later | **Yes.** The invoice waits on the VAT model |
| U5 | Approve R1 + R2 to start (no pricing impact) | Requested |

Approval to start R1/R2 doesn't approve R3/R4, which stay gated on the paid GO criteria in the release-readiness report.

---

## 11. Implementation log: R1 + R2 (2026-10-11, uncommitted)

R1 and R2 were approved and built. R3 and R4 have not started.

**Correction to G6.** Partners do see transfers and bank payouts already, in two tables inside `PayoutAccountCard`
when `connect_v1` is on. The real gap is narrower:
- there's no single chronological list;
- the list has no status vocabulary or settlement references;
- there's no phone layout.

`PayoutHistory` (R2) is the replacement list. In R3 the card would keep only the account status.

### R1, live behind no new switch
| Item | Change |
|---|---|
| C1 price chips | `PriceChip` + `priceSignal.ts`, from the server's `price`/`trial`/`priceCents` fields only. Club, Experience, Experience search and Discover activity cards. Centre cards are unchanged (a centre is never "free" as a whole). No discount badges |
| C6 refund labels | `RefundStatus` in `SelfCancelControl.tsx` replaces 4 hand-styled badges in My Life. Same text and tone per server `refundState` (`pending` → "Refund processing", warm; `refunded` → "Refunded", green). Before, two different colour styles were in use |
| P1 Earnings sections | `EarningsSections` (`EarningsSummary.tsx`): Balance · Payouts · Plan & billing. Payouts and Plan only appear when `GET /{scope}/payout-account` reports `enabled` or `GET /{scope}/plan` isn't `unavailable`; a 403 hides them too. Deep links: `?view=`, plus the existing Stripe returns (`?pro=` → Plan, `?payouts=` → Payouts). A Stripe return marker is cleared on a manual tab change, so `?payouts=refresh` can't replay. New accessible `SectionTabs`/`TabPanel` in `ui.tsx` (tablist, roving tabindex, arrow/Home/End) |
| A1 coupon cross-links | Admin Coupons → "Finance → Coupon usage" and back. Finance accepts `?section=` |
| A2 switch hints | Optional `whenOn` text on each `COMMERCE_SWITCHES` entry, shown as "When on: …". Text only: defaults and dependencies are unchanged |
| Shared `Drawer` | Now `role="dialog"`, `aria-modal`, labelled by its title. Focus moves in, is trapped, and returns to the opener; an `autoFocus` field is left alone |

### R2, fixtures only, rendered at the dev-only `/dev/booking-kit`
`CheckoutSummary` + `checkoutLines.ts`:
- Order: price → −code → VAT/fee/deposit → Total → −credit → Card payment due.
- Credit rows only show when the server sent `cardDueCents`; nothing is derived.
- There is a phone disclosure bar.

Also:
- `CouponField`: reason copy via `CouponRejectedError`, and an `appliedProblem` state for a code that expired before payment.
- `CreditToggle`: opt-in, with these states: unavailable / ineligible / off / applied / balance changed.
- `ReceiptDrawer`, `PayoutHistory`, `CouponRedemptionsDrawer`.
- Contracts in `components/commerceDisplay.ts`.
- Fixtures in `components/booking/__fixtures__/commerce.ts`, consistency-tested.
- Verified absent from the production bundle.

### R3 contract dependencies introduced by R2
- **Quotes:** return `creditCents`, `cardDueCents` and `creditRemainingCents` separately. The engine experience quote
  folds credit into `discountCents` today.
- **Coupon rejection:** checkout and quote paths return the `reason`. The standalone `/coupons/validate` stays uniform (R5).
- **New endpoints:**
  - `GET /residents/me/receipts/:ref` → `ReceiptDetail` (frozen breakdown, refunds split card/credit, `netPaidCents`);
  - `GET /{vendor|host}/payout-account/history` → `PayoutHistoryData` (+ `minimumPayoutCents` from the settlement rule);
  - `GET /vendor/coupons/:id/redemptions` (and the host equivalent) → `CouponRedemptionsData`.
- **Receipts list fixes:** G1 (experiences) and G2 (charged, not list, price).

---

## 12. Implementation log: R3A (2026-10-11, uncommitted)

R3A only. R3B and R4 have not started. No commerce switch, VAT, fee, pricing rule, settlement or subscription
logic was changed. Open Booking and boost vouchers stay off.

### Correction to R2: credit comes off before tax
The commerce engine applies customer credit as a HelloCircle-funded discount *before* VAT and fees
(`engineQuoteExperience`: `discountMinor + creditMinor`). `totalCents` is what the card is charged.
- **The R2 summary was wrong:** it showed credit after the total.
- **`checkoutRows` now follows the server order:** price → −code → −credit → VAT/fee/deposit → charged amount. Credit
  is shown separately only when the server sends `couponDiscountCents`; otherwise one combined line is shown, never a
  derived split.
- **The R2 fixtures and contract were updated to match.**

### P1: UX defects
- **Cookie banner:**
  - While any `[aria-modal="true"]` dialog is open, the banner is hidden (`display: none`). That covers drawers,
    sheets, modals, and the photo lightbox, which now has dialog semantics. No choice is recorded.
  - On checkout screens below 900px (where the kit's fixed submit bar shows), the banner shows its first sentence and
    the three choices. The rest of the *existing* wording is behind "More about optional cookies"
    (`aria-expanded`) and opens automatically under "Choose…". No new consent copy.
  - Measured at 320×640: 286px → 181px, so the checkout step heading and its first options stay visible.
- **Focus:** the drawer's trap and restore are unchanged and verified. Focus moves into the dialog and returns to the
  opener.
- **Open Booking switch text:** "Not launch-ready — keep off", with the P0 reason and "only for an isolated test
  environment".

### P2: Receipts (`server/src/receipts.ts`)
- **List:** `GET /api/residents/me/receipts` now includes experience bookings (G1). A game shows
  `game_participants.total_cents`, the amount charged; only rows older than that column fall back to the list price (G2).
- **Detail, new:** `GET /api/residents/me/receipts/:ref`, only the resident's own rows. Someone else's ref gets the
  same 404 as an unknown one.
- **Breakdown precedence:** frozen `pricing_snapshots` → the row's stored columns → total only. It is never re-priced
  with current rules.
  - Credit used comes from `credit_uses` (confirmed + reversed).
  - The VAT label comes from the snapshot's recorded `vatBps`.
  - Rows older than the breakdown columns (all zeros) are shown total-only, not as a "deposit".
- **Refunds:** card refunds from `refunds` (pending → "processing") and credit given back from `credit_uses.reversed`.
  `netPaidCents` = card + credit − both.
- **Status:** paid / free / pay_at_venue (cash, nothing charged online) / pending / failed / refunded / part_refunded.
- **Labelling:** `isTaxInvoice: false`. The drawer says "This is a payment receipt, not a VAT invoice."
- **UI:** Profile → Receipts rows open `ReceiptDrawer`.

### P3: Payout history
- **Endpoint:** `GET /api/{vendor|host}/payout-account` gains two additive fields:
  - `history`: the same transfer and `connected_payouts` records, one dated list, statuses mapped server-side;
  - `minimumPayoutCents`: from the partner's `settlement` rule.
- **Access:** existing routes and permissions, unchanged. Vendor = owner or finance staff (`requirePlatformRole("finance")`);
  host = themself. Party-scoped queries.
- **Read-only:** nothing is created; a test asserts the row counts don't change.
- **UI:** `PayoutAccountCard` keeps its status and Stripe controls. The two tables are replaced by `PayoutHistory`
  (embedded: no second account alert).

### P4: Programme coupons and pass price
- **Programmes:** `ProgramDetail` gets the kit `CouponField` and `CheckoutSummary` from `GET /programs/:id/quote?couponCode=`
  (now rate-limited, and its 400 carries `code: coupon_<reason>`). Enrolment sends `couponCode`. If the code stops
  applying at enrolment, the field shows the reason and the price is re-quoted without it.
- **Coupon errors:** the standalone `/coupons/validate` stays uniform (R5).
- **Passes:** new `GET /api/passes/quote?listingId&creditsTotal` uses `pricePass()`, the same function as
  `POST /passes/checkout`. `ClubDetail` drops `VAT_RATE`/`PLATFORM_FEE_RATE` and shows the quote (no price while
  loading or if the quote fails).

### P5: Checkout consistency
- **Experience quote, additive fields:** `couponDiscountCents`, and `creditBalanceAfterCents` (server: balance −
  applied). The legacy branch sends `couponDiscountCents = discountCents, creditCents = 0` and a reason code on a
  rejected coupon.
- **`CheckoutBreakdown`:** the experience dialog now renders the shared `checkoutRows` and has stopped subtracting.
  It keeps its test ids. Credit stays opt-in (the existing checkbox).
- **Not migrated:** venue booking and club registration (already on the kit's `QuoteSummary`, legacy pricing, no
  credit) and game joins (legacy quote, no credit). Nothing needed there for consistency.

### R3A results
| Suite | Result |
|---|---|
| Server (isolated Docker DB) | 818 passed, 23 skipped (live-provider). 17 new in `routes/commercialR3a.test.ts`, incl. cross-tenant receipts and payout history |
| Client | 225 passed |
| `qa:revenue` / `qa:lifecycle` / `qa:product` / `qa:authorization` / `qa:security-gate` | 38 / 52 / 68 / 83 / 39 passed |
| `qa:booking` | 38 passed after one spec fix: HC-QA-047 found the programme total twice (summary + footer) and now asserts both |
| `qa:stripe` (TEST mode, targeted) | 8 passed: PREFLIGHT, PAY-PROGRAMME, PAY-EXPERIENCE, UI desktop + mobile, and the new R3A-PROGRAMME-COUPON, R3A-PASS, R3A-EXPERIENCE-QUOTE (quote = stored = Stripe `amount_total`) |
