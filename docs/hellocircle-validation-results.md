# HelloCircle — Validation Results

_2026-10-14 · branch `feature/commerce-engine` + uncommitted work (pre-existing admin redesign preserved) · plan:
`docs/hellocircle-validation-matrix.md` · UX detail: `docs/hellocircle-ux-ui-validation.md`._

Nothing was committed, pushed or deployed. No production or staging record, configuration or person was touched.

## 1. Environment and method

| Item | Detail |
|---|---|
| Database | **Fresh disposable MySQL 8.0 container**, provisioned with the repository's own guarded harness (`npm run qa:db:setup` → `qa:preflight:connected` → `qa:db:seed`), database `hello_circle_e2e_qa_29ed6cc2ebe316f6`, restricted user scoped to that schema. The previous QA run's container had exited (its tmpfs DB was gone) and its private secrets directory no longer existed; its manifest was **moved** (not deleted) to `.qa-data/qa_bf116a75118810bc/retired-docker-stopped-manifest.json` before provisioning, per the documented recovery method. Server Vitest uses its own throwaway container. |
| Docker | Docker Desktop was started for this work. It also auto-started unrelated containers from other projects on this machine (`butterfly-spa-*`, `upi-postgres-1`); they weren't touched. |
| Backend / frontend | Real Express app and real React app per batch (scrubbed environment, outbound network denied by the harness). Venue pages gated, Mapbox off. Some batches use the production client bundle. |
| Payments | (a) Network-free **provider stub** for booking-provider and revenue batches. (b) **Stripe TEST mode** for `qa:stripe` (`~/.config/hellocircle-qa/stripe-test.json`; the runner refuses live keys), with webhooks signed via the Stripe CLI test session or a per-run local secret. |
| Email / push | No SMTP → console fallback, logs not retained; no push. Nobody real can be emailed. |
| Login limiter | Real 10-per-15-min limiter left on; batches split to stay under it. |
| Verification labels | **E2E** = real browser or API → real server → isolated DB. **E2E-Stripe** = plus Stripe test mode. **UI-I** = real stack with one endpoint failure injected (UI verification, not server verification). **T** = unit/integration test. **C** = code inspection. |

## 2. Overall result

| Suite | Baseline (before fixes) | Final (after fixes) |
|---|---|---|
| Client type-check / server type-check / tests type-check | PASS / PASS / PASS | PASS / PASS / PASS |
| Client Vitest | 31 files, 266 PASS | **32 files, 269 PASS** (+URL-tab resolver) |
| Server Vitest (isolated container) | 847 PASS, 23 skipped | **850 PASS, 23 skipped** (+catalogue `appliesTo`, +fee reconciliation) |
| `qa:check` (harness safety) | 97 PASS | 97 PASS |
| `qa:auth` | 20 PASS | 20 PASS |
| `qa:authorization` | 83 PASS | 83 PASS |
| `qa:security-gate` | 39 PASS | 39 PASS |
| `qa:booking` | 38 PASS | 38 PASS |
| `qa:lifecycle` | 52 PASS | 52 PASS |
| `qa:product` | **FAIL** at HC-QA-063 (/circles); later batches not reached | **68 PASS, 0 FAIL** (all batches) |
| `qa:revenue` | **FAIL** at REV-PUBLIC-COOKIES-mobile; 8 batches not reached | **38 PASS, 0 FAIL** (all batches) |
| `qa:stripe` (Stripe TEST mode) | 38 PASS, then **FAIL** at SANDBOX-CONNECT-A; 7 sandbox batches not reached | **44 PASS**; SANDBOX-CONNECT-A **FAIL (external)** — see §8 |
| `qa:validation` (new) | — | **8 PASS, 0 FAIL** |

**Readiness:** core customer, host, vendor and admin journeys work end to end in the isolated environment, including
paid flows in Stripe test mode. The partner-payout path (Stripe Connect onboarding) does **not** work against the
current Stripe test account, and several business decisions (§6) block a confident paid launch.

## 3. Defects found and fixed

| ID | Area | Role / state | Expected | Observed (before) | Fix | Verification |
|---|---|---|---|---|---|---|
| F-01 | `/circles` | Guest, list API failing | Error with retry, no misleading counts | "**0 Circles · Browse**" tile, "0 Circles across Ireland" header and "Show 0 Circles" button beside the error (regression from the Circles redesign; HC-QA-063 FAIL) | Counts only after the aggregate request succeeds; header says "Circles couldn't load" | E2E-UI-I (HC-QA-063 ×4 PASS) |
| F-02 | Cookie banner, phone width | First visit | Optional purposes named before any choice | Compact banner (2026-10-12) hid "analytics" and "advertising" (REV-PUBLIC-COOKIES-mobile FAIL) | Compact text names both purposes; details stay one tap away | E2E (revenue-public PASS) |
| F-03 | Rejected listings | Vendor owner, listing `rejected` | Dashboard says the listing "needs changes before it can go live", so the vendor must be able to resubmit | Publish endpoints accepted only `draft` → permanent dead end; no UI action | Server: `rejected → pending` allowed for centres, clubs, experiences (audited with the prior status). UI: `ListingReviewNotice` on all three editors (pending / rejected, **Resubmit for review**, blocked while unsaved) | E2E (VAL-LISTING-LIFECYCLE, VAL-UX-REJECTED-RESUBMIT) |
| F-04 | Admin audit trail | Any admin | Consequential moderation recorded | Not audited: listing approve/reject/status, admin listing edit and delete, claim approve/reject, review hide/unhide, organisation create/assign, provider tier | `writeAudit` with previous/new values on each; readable descriptions added to the audit log UI | E2E (VAL-LISTING-LIFECYCLE asserts the `centre.status_changed` and `centre.published` rows) + C |
| F-05 | Admin Finance (13 sections) | Finance admin, request failing | Error, never "Nothing here." | Every list swallowed failures into an empty state (refunds, disputes, payment events, settlements, transfers, debts, credits, rewards, coupon usage, payouts, plans, roles, field help) | Per-section failure tracking, alert + **Try again**, empty copy suppressed | UI-I (VAL-UX-ERRORS) |
| F-06 | My Life | Resident, one source failing | Error, not empty and not stuck | 10 sources swallowed failures; 3 core sources had no `catch`, so one failure **left the skeleton up forever** | All sources settle; alert "Some of your activity couldn't load…" + retry; empty state suppressed; guest 401s and profile failures (already covered by HC-QA-064) not double-reported | UI-I (VAL-UX-ERRORS, HC-QA-064 PASS) |
| F-07 | Host overview, partner overview, listing editors, Circle organiser | Request failing | Error with retry | Unhandled rejections / silent empties / permanent spinner; restricted vs failed indistinguishable on Circle organiser page | Explicit error states with retry; restricted shown separately | C + tsc |
| F-08 | Commercial rules (admin) | Finance admin | Controls state where they take effect | Cards implied every rule governs checkout; `checkout`, `cancellation`, `plan_rules` aren't read by any code; `pricing` only reaches engine-priced experiences | Server catalogue now carries `appliesTo` for all 18 keys; each card shows **Where this takes effect** ("Not applied yet" in danger colour) | T (`catalog.test.ts`) + C |
| F-09 | Partner workspace `/vendor` | Owner and staff | Approved cream workspace; URL-kept tabs | Older shell; Back left the dashboard; listings/stats failures silent | `WorkspaceShell` (shared with host), `useUrlTab`, Lucide grouped nav, role in strip, unread count, error banner | E2E (VAL-UX-WORKSPACES, 3 viewports, Back/Forward/refresh) |
| F-10 | Host workspace `/manage`, `/manage/circles/:id` | Resident host / organiser | Same | Older shell; tabs not in URL | Same shell; URL tabs; breadcrumbs back to Host workspace | E2E |
| F-11 | Profile sections | Resident | Back/Forward keep section | First-load only | `useUrlTab` | C + T |
| F-12 | Signed-out Pro / rewards pages | Guest | Restricted state with sign-in | "Couldn't load the plan" (401 shown as a failure) | Distinct signed-out state with the correct sign-in link | E2E (VAL-UX-RESTRICTED) |
| F-13 | Reduced motion | Any | `prefers-reduced-motion` honoured | `.fade-panel` entrance animation (most pages) ignored it | Added to the reduced-motion list | E2E (screenshots before/after) |
| F-14 | Suspended partner screen | Suspended vendor | Restriction + next step | "Contact the site admin" with no means to do so | Explains what's unavailable + **Contact HelloCircle** button | C |
| F-15 | Fee reconciliation | Finance admin | One unreadable payment doesn't abort the run | `POST /admin/finance/fees/reconcile` threw on the first payment intent Stripe couldn't read → 500 for the whole run (SANDBOX-MONEY-B-H FAIL) | Per-payment try/catch: skipped, logged and retried next run | T (`feeReconcile.test.ts` — fails without the fix, passes with it) + E2E-Stripe (SANDBOX-MONEY-B-H PASS) |
| F-16 | Connect onboarding errors | Partner (finance) | Provider refusal is a clear 502 with Stripe's code (existing convention) | Onboarding-link refusal escaped as a bare 500 | Mapped to `ConnectError` 502 with the provider code | E2E-Stripe (now 502 with message) |
| F-17 | `/games` headings | Any | One H1, no skipped levels (HC-QA-083) | Shared `ListingCard` always used `h3` directly under the page `h1` (from the redesign) | `ListingCard` `headingLevel` option; `/games` uses `h2` | E2E (HC-QA-083-PUBLIC, see §8) |
| F-19 | Workspace heading order | Any (admin, partner, host) | Page `h1` is the first heading | Sidebar group labels were `h2`s before the `h1` (HC-QA-083-RESIDENT FAIL; same pattern on `/admin`) | Group labels are plain labelled text | E2E (HC-QA-083-RESIDENT / -BUSINESS) |
| F-18 | Finance error punctuation | Finance admin | Readable message | "Server error What's shown…" | Punctuation normalised | UI-I |

**Test-only corrections (not product changes):**
- `stripe-sandbox-billing.spec.ts` posted the Pro checkout without the Pro terms confirmation that the product has
  required since Stage 5f; it now sends `termsAccepted: true` like the real UI.
- `stripe-sandbox-connect.spec.ts` now includes the API's own error text in its assertion message.
- `reporter.ts` allows `validation-*` batch names for its sanitised results; `run.ts` gains a `validation` suite.
  No guard, isolation check or limiter was changed or bypassed.

## 4. Results by journey

Statuses: PASS · FAIL · BLOCKED · NOT TESTED · N/A. "Fixed" rows were FAIL in the baseline.

### Customer
| ID | Result | Method / evidence | Limitation |
|---|---|---|---|
| C-01 browse/detail | PASS | E2E — product, visibility suites | Venue pages gated in QA build |
| C-02 search/filters/errors | PASS (F-01 fixed) | E2E — HC-QA-063/073 | — |
| C-03 map/list consistency | **BLOCKED** | — | Mapbox disabled (external) |
| C-04 signup/login/logout/expiry | PASS | E2E — qa:auth | Google sign-in not testable (Firebase not configured) |
| C-05 recovery | PASS | E2E — recovery specs | Email content not delivered (sink/console) |
| C-06 guest ownership | PASS | E2E — IDOR-BOOKING, STAGE-B-BOOKING | — |
| C-07…C-12 venue, club, programme, experience, activity, Circle | PASS | E2E — booking, lifecycle suites incl. concurrency | Venue/club public pages gated; tested via API and direct routes |
| C-13 paid checkout, all six types | PASS | E2E-Stripe — STRIPE-PAY-*, STRIPE-CHECKOUT-AMOUNTS, STRIPE-DECLINE, STRIPE-LATE-SUCCESS, STRIPE-UI-* | Test mode only |
| C-14 My Life, receipts, notifications, chat | PASS (F-06 fixed) | E2E + UI-I | — |
| C-15 cancel → refund | PASS | E2E-Stripe — STRIPE-REFUND-*, HC-GAP-STRIPE-* | — |
| C-16 reviews/reports/complaints | PASS | T (server) + E2E personal suites | — |

### Host
| ID | Result | Evidence | Limitation |
|---|---|---|---|
| H-01 create/edit/publish | PASS | E2E — lifecycle | — |
| H-02 paid-host verification | PASS | T + E2E | — |
| H-03 join requests, polls, plans | PASS | E2E — LC-CIR-*, HC-QA-054/056 | — |
| H-04 participants, refund, check-in | PASS | E2E — STAGE-B-HOST, gameCancelRefund.test | — |
| H-05 venue booking linked to activity | PASS | T — bookingUxPhase5.test | Browser walk-through not repeated |
| H-06 identity switching | PASS | E2E — STAGE-B-MANAGE, CLOSURE-LINK* | — |
| H-07 host workspace UX | PASS (F-10) | E2E — VAL-UX-WORKSPACES | — |

### Vendor
| ID | Result | Evidence | Limitation |
|---|---|---|---|
| V-01 signup + org + first listing | PASS | E2E — product-vendor-signup, HC-QA-058 | — |
| V-02 pending account | PASS | T — vendorAuthFlow | — |
| V-03 approval chain | PASS | T + E2E | — |
| V-04/05 centre and club editors | PASS | T + E2E | — |
| V-06/07 programmes, experiences | PASS | E2E | — |
| V-08 publish → reject → resubmit → approve; pause/resume | PASS (F-03 fixed) | E2E — VAL-LISTING-LIFECYCLE | Rejection reason not captured (decision D-03) |
| V-09 bookings, attendance, cancel, refund | PASS | E2E-Stripe | — |
| V-10 messages, reviews, offers, earnings | PASS | E2E | Payout status shown as "not switched on" (correct) |
| V-10b Connect payout onboarding | **FAIL (external)** | E2E-Stripe — SANDBOX-CONNECT-A: account created, **Stripe refuses the onboarding link** (`StripeInvalidRequestError`) | Needs the Stripe test account's Connect / Accounts v2 configuration checked; feature is off by default |
| V-11 five staff roles | PASS | E2E — **VAL-STAFF-MATRIX**: programme create (centre → centre_manager only, club → facility_manager only), edit / add session / archive, coupons (finance), payments (finance), CSV (finance, analyst), broadcast (communications), invites and policies (owner only), denied requests leave rows unchanged | Claims ungated for staff (decision D-06) |
| V-12 cross-org | PASS | E2E — IDOR-VENDOR, STAGE-B-* | — |
| V-13 suspension | PASS (lock-out) / **DECISION** (public listings) | E2E — VAL-SUSPENSION: existing session gets 403, audit row written; the public listing still returns 200 | D-01 |
| V-14 partner workspace UX | PASS (F-09) | E2E | Editors not migrated |

**Documentation claim tested:** `docs/admin-and-vendor-reference.md` §3.4 says programme writes have no staff-role guard.
**Not reproduced.** Programme create, edit, session and archive are enforced per role (VAL-STAFF-MATRIX PASS against the
real server). That reference statement is out of date.

### Admin
| ID | Result | Evidence | Limitation |
|---|---|---|---|
| A-01 non-admins denied | PASS | E2E — RBAC-001, STAGE-B-ADMIN | — |
| A-02 sub-roles | PASS (as implemented) | E2E — **VAL-ADMIN-SUBROLES**: finance → finance, coupons and commerce only; support → complaints and traders; legal → policies and traders; only super lists or changes admin roles; a sub-admin can't promote themselves | Marketplace moderation open to every sub-role (D-02); a legal admin approving a vendor was recorded (200) |
| A-03 approvals, claims, host applications | PASS (F-04) | E2E + C | — |
| A-04 reports, complaints, appeals | PASS | T + revenue-admin | — |
| A-05 commerce, coupons, finance | PASS (F-05, F-08, F-15) | revenue-admin(-b) E2E, Stripe sandbox | — |
| A-06 policies, templates, media, settings, audit | PASS | revenue-admin-b, stage-b-media | Media delivery to cloud storage not tested (external) |

### Commerce
| ID | Result | Evidence |
|---|---|---|
| M-01 totals = display = Stripe | PASS | STRIPE-CHECKOUT-AMOUNTS, STRIPE-R3A-*, HC-QA-042/047/049 |
| M-02 rule coverage | PASS after F-08 (now stated accurately); **decision D-04** on whether rules should govern legacy checkout | C + T |
| M-03 discounts, fees, deposits, VAT | PASS (as implemented: 23% + 5% on top, €100 deposit) | booking + Stripe suites |
| M-04 webhooks: signature, duplicates, unknown, replay | PASS | HC-QA-048, STRIPE-WEBHOOK-*, SANDBOX-WEBHOOKS-G, SANDBOX-DELIVERY-G (real Stripe CLI deliveries) |
| M-05 refund once | PASS | STRIPE-REFUND-CONCURRENT, HC-QA-091-* |
| M-06 ledger, settlement, disputes, splits, reconciliation (switches on in test only) | PASS — SANDBOX-MONEY-B-H, MONEY-D, DISPUTES-E, SPLIT, RECONCILE (to the cent), BILLING-F | Stripe test mode; Connect accounts for money movement are labelled test doubles |
| M-07 Pro / rewards / credits / splits stay gated | PASS | revenue-plan, -rewards, -credit, -split |

## 5. Security and data integrity

| Check | Result | Evidence |
|---|---|---|
| Role and action permissions, hidden actions via direct API | PASS | 83 authorization + 39 security-gate + VAL-STAFF / VAL-ADMIN |
| Cross-org / cross-user / documents / media ownership | PASS | IDOR-*, STAGE-B-MEDIA, HC-QA-062-BOUNDARIES |
| Pending / suspended restrictions | PASS (account); public visibility is a decision (D-01) | vendorAuthFlow, VAL-SUSPENSION |
| Sensitive-action reasons + audit | PASS for coupons, roles, finance and switches (reasons); audit gaps fixed (F-04). Vendor suspension and listing rejection still take **no reason** (D-03) | E2E + C |
| Upload validation | PASS | media.test (T), HC-QA-062* |
| Session / identity switching | PASS | STAGE-B-MANAGE, CLOSURE-LINK-RACE |
| Login redirects / `returnTo` | PASS | authRedirect.test, RBAC-BROWSER |
| Concurrency / overselling / duplicates | PASS | *-CONCURRENT, REM-*, STRIPE-CONCURRENCY*, HC-QA-046/054 |
| Errors don't echo secrets | PASS | STAGE-B-ERRORS, HC-QA-004 |
| Webhook amount/session reconciliation before `paid` | OPEN (hardening, unchanged) | C — confirmation trusts signed metadata; amounts are recorded and reconciled later (SANDBOX-RECONCILE) |

## 6. Business decisions still needed (no policy was chosen here)

| ID | Decision | Affected workflows |
|---|---|---|
| D-01 | When a partner is suspended, should their listings be hidden and new bookings blocked? What happens to existing bookings? (Today: listings stay public and bookable; only passes check owner status.) | Suspension, customer booking, refunds |
| D-02 | Which admin sub-roles may approve or suspend partners, approve, reject or delete listings, change staff roles and tiers, toggle org flags and send demand notifications? (Today: all of them.) | Admin moderation |
| D-03 | Must rejection and suspension carry a reason shown to the partner (DSA-style statement of reasons)? Capturing one needs a schema and UI change. | Approval chain, appeals |
| D-04 | Should published `pricing` / `cancellation` / `checkout` rules govern all checkouts, replacing the fixed legacy pricing (23% VAT and 5% fee on top, €100 deposit, 48h/90d defaults)? VAT treatment is marked provisional in code. | All checkout, admin commerce |
| D-05 | Should edits to an approved listing need re-review? | Listing moderation |
| D-06 | Which staff roles may file listing claims? (Today: any invited staff, including read-only analyst; VAL-STAFF-MATRIX records 201 for every role.) | Claims |
| D-07 | Resident enforcement (suspension/ban/appeal) and account deletion | Moderation, privacy |
| D-08 | Staff off-boarding: change role or remove an existing member (owner can only invite or revoke pending) | Organisation |
| D-09 | Partner fee model approval (unblocks Pro and rewards; code constant `PARTNER_FEE_MODEL_STATUS`) | Pro, rewards |

> **Correction to the D-01 row above (2026-10-14):** the "bookable" part was wrong when written. New checkout has been refused for a suspended partner
> user's listings since commit `f3953b6` (`vendorSuspended()` in bookings, registrations, programmes, experiences and
> passes). The listings do stay visible, and the check is per user, not per organisation. See D-01 in
> `hellocircle-operating-decisions.md`.

## 7. Feature readiness

| Feature | State | Safe to enable? |
|---|---|---|
| Paid checkout (`PAID_CHECKOUT=open` in production) | All six paid types pass end to end in Stripe test mode, refunds once, webhooks verified | **Technically ready**; blocked on D-04 (pricing/VAT model) and company/legal inputs |
| Venue pages (`VITE_VENUE_PAGES_PUBLIC`) | Booking and registration pass | Ready technically; needs real partner supply; D-01 recommended first |
| Settlement ledger (`commerce.settlement_ledger`) | Money, refunds and disputes sandbox pass; reconciliation fixed (F-15) | Enable in staging first; settlements are a manual admin run |
| Stripe Connect payouts (`commerce.connect_v1`) | **Onboarding link refused by Stripe test account** | **Not safe** until the Stripe account configuration is resolved and SANDBOX-CONNECT-A passes |
| Pro subscriptions / partner reward points | Gated by code constant (D-09); Stripe Billing sandbox (Pro €29 + 23% VAT, renewal, failed renewal + grace, cancel) PASS | Not until D-09 |
| Customer credits | Revenue-credit suite passes; only spendable in engine-priced experience checkout | Only with the experience engine (D-04) |
| Commerce engine (experiences) | Engine suites pass under the stub | Needs D-04 |
| Open Booking / Make It Happen | Labelled "not launch-ready" | **No** |
| Venue/host split payouts | Depends on Connect | **No** (Connect blocker) |
| Second-approver rule publishing | Implemented | **Recommended on** before go-live if there are two finance admins |

## 8. Final runs on the final code

All on the final working tree (after every fix above), against the disposable QA database. A guarded `qa:db:reset` +
`qa:db:seed` produced a clean database `hello_circle_e2e_qa_757afed27b6f7a61` for the last runs.

| Check | Result |
|---|---|
| `tsc` server / client / tests | PASS / PASS / PASS |
| Client Vitest | 32 files, **269 PASS** |
| Server Vitest (isolated container) | 84 files, **850 PASS**, 23 skipped |
| `qa:check` | 97 PASS |
| `qa:auth` / `qa:authorization` / `qa:security-gate` | 20 / 83 / 39 PASS |
| `qa:booking` / `qa:lifecycle` | 38 / 52 PASS |
| `qa:product` | **68 PASS, 0 FAIL** (every batch, including a11y, P12/P13, deploy, perf and gaps) |
| `qa:revenue` | **38 PASS, 0 FAIL** |
| `qa:validation` (new) | **8 PASS, 0 FAIL** |
| `qa:stripe` (TEST mode) | **44 PASS**: payments ×5, decline, late success, isolation, coupon single-use, refunds (hall, concurrent, vendor cancel, cancel-before-payment ×2), external refunds ×6, self-cancel ×2, browser ×3, webhook signature/unknown, HC-QA-048/049, R3A ×3, sandbox money ×2, disputes, billing, webhooks, split, delivery, reconcile. **SANDBOX-CONNECT-A FAIL (external)** |

**Notes on the final Stripe run**

- **SANDBOX-SPLIT** failed once in the long sequential run: partner balances were −3949/−1999 instead of −667/−333.
  The difference is the residue of an earlier SANDBOX-SPLIT run on the same database, because the spec assumes fresh
  partner balances. On the reset database it **passed**, so this is test isolation, not a product defect. Future runs
  should reset between full Stripe suites, or the spec should scope balances to its own bookings.
- **Three stale tests were corrected** (product behaviour unchanged and correct):
  - `stripe-sandbox-billing`: now sends the Pro terms confirmation.
  - `product-a11y-e`: now finds the header logo, which became a decorative image inside the labelled home link in the
    header redesign. The old selector timed out.
  - `stripe-sandbox-connect`: now surfaces the API error text.
- **Two more accessibility fixes** were made while capturing screenshots: `.slide-in-left` and `.slide-in-right` (the
  Sections sheet and drawers) now honour `prefers-reduced-motion`, like `.fade-panel` (F-13).

**Evidence:** sanitised per-batch results are under `.qa-data/<run>/evidence/` (gitignored). Workspace and state
screenshots were copied to **`docs/validation-2026-10-14/`** (17 PNGs, QA personas only).

## 9. Not tested / limitations

- **Map/list consistency** — Mapbox disabled in QA (BLOCKED).
- **Google sign-in** — Firebase not configured in QA; covered only by server unit tests.
- **Real email delivery and content** — no SMTP; only the local sink (vendor acknowledgement/approval) and console.
- **Cloud media delivery** (R2/Cloudinary) — authorisation tested; delivery not.
- **Stripe hosted onboarding completion** — needs a human (hCaptcha) even in test mode.
- **Cross-browser** (`qa:browsers`, Firefox/WebKit) — NOT TESTED in this run.
- **Production and staging configuration** — not inspected (by design).
- The new validation tests were written against the intended behaviour and run on the fixed code. Their failure on the
  pre-fix code is shown by code inspection for F-03/F-04 (publish guard required `draft`; no `writeAudit` in those
  handlers), and by the baseline suite failures for F-01/F-02/F-15.
- The QA persona vendor and host accepted the Terms through the real endpoint during the UX run (disposable DB only).

## 10. Addendum 2026-10-15 — D-02 admin permissions and D-03 decision reasons

The QA environment was rebuilt (owner-approved Method B) and D-02/D-03 were verified locally on the final code:
`qa:auth` 20/20, `qa:authorization` 83/83, `qa:security-gate` 39/39, `qa:validation` all batches (incl.
`validation-d02`, `validation-d03-api`, `validation-d03-ui`), `qa:product` 68 + 1 designed skip. Six defects were
found and fixed within D-02/D-03. Details, migration findings, screenshots and limitations:
[hellocircle-d02-d03-validation.md](hellocircle-d02-d03-validation.md). Not deployed.

