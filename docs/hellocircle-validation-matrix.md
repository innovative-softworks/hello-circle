# HelloCircle — Validation Matrix (Phase 1)

_2026-10-14 · branch `feature/commerce-engine` + uncommitted work · results are in
`docs/hellocircle-validation-results.md`, UX/UI findings in `docs/hellocircle-ux-ui-validation.md`._

This is the plan: what was validated, for whom, from which starting state, what "correct" means at each layer, and
where the evidence comes from. Every journey row lists the evidence source; the results document records
PASS / FAIL / BLOCKED / NOT TESTED / NOT APPLICABLE against these IDs.

## 1. Environment used

| Item | Value |
|---|---|
| Database | Fresh disposable MySQL 8.0 container provisioned by the guarded harness (`npm run qa:db:setup`), database `hello_circle_e2e_qa_29ed6cc2ebe316f6` (reset to `hello_circle_e2e_qa_757afed27b6f7a61` for the final runs), restricted user scoped to that schema only, loopback port. Never `hello_circle` or `hello_circle_dev`. |
| Backend | Real Express app started per batch by `tests/integration/backend.ts` with a scrubbed environment (no SMTP, Firebase, R2 or Cloudinary credentials; outbound sockets denied by the test wrapper) |
| Frontend | Real React/Vite client, `VITE_LAUNCH_MODE=public`, venue pages **gated** (default), Mapbox **disabled**. Some batches use the production bundle (`QA_PROD_BUILD=1`). |
| Server unit/integration | `npm run test --workspace server` — its own disposable MySQL container (`hello_circle_test_<runid>`), scrubbed env |
| Payments | Two boundaries: (a) **provider stub** (`QA_PAYMENT_PROVIDER_STUB`, no network) for booking-provider and revenue batches; (b) **Stripe TEST mode** (`~/.config/hellocircle-qa/stripe-test.json`, runner refuses live keys) with signed webhooks via Stripe CLI or a per-run local secret, for `qa:stripe` |
| Email / push | No SMTP configured → console fallback, logs not retained; one batch uses a local QA mail sink. Push disabled. No real recipient can be reached. |
| Personas | Seeded per run: `QA_USER`, `QA_USER_B` (residents), `QA_HOST`, `QA_HOST_B` (resident hosts), `QA_VENDOR`, `QA_VENDOR_B` (vendor org owners), `QA_ADMIN` (super), one suspended vendor control. Specs create synthetic invited staff (all five roles), sub-role admins (finance/support/legal) and listings by exact ID, and delete them by exact ID. |
| Login limiter | Real 10-per-15-min limiter is **not** disabled; batches are split so each fresh backend stays under it |

## 2. Roles and starting states covered

| Identity | States |
|---|---|
| Guest (`X-Client-Id`) | anonymous, second guest (foreign client id) |
| Resident | signed in, signed out, expired session, second resident |
| Resident host / Circle organiser | unverified host, organiser, co-organiser, member, non-member, invitee |
| Vendor org owner | approved, pending, suspended (seeded control + synthetic), deactivated (self-service soft) |
| Invited staff | `centre_manager`, `facility_manager`, `finance`, `communications`, `read_only_analyst` |
| Admin | `super`, `finance`, `support`, `legal` |

## 3. Feature status (what is in scope to work vs. to stay off)

| Status | Features |
|---|---|
| **Enabled** | Browse/search/discovery; resident auth (magic link, password, Google*); vendor/admin password auth; guest + resident booking (centre*), registration (club*), programme enrolment, experience booking, activity join, Circle membership; waitlists; free/cash flows; paid Stripe Checkout for all six types (non-production; production needs `PAID_CHECKOUT=open`); provider-cancel auto-refund; reviews/reports/complaints/appeals; vendor RBAC; admin workspace; legacy pricing (23% VAT + 5% fee on top, €100 deposit); paid hosting restricted to verified hosts |
| **Implemented, disabled by default** | Commerce engine (experiences only), shadow pricing, coupons v2, settlement ledger, Connect payouts, customer credits, venue/host split payouts, Open Booking / Make It Happen, second-approver rule publishing |
| **Proposed (hard-blocked in code)** | Pro subscriptions and partner reward points — `PARTNER_FEE_MODEL_STATUS = "proposed"` blocks purchase even if switched on |
| **Documented only** | Boost vouchers |
| **Incomplete / not built** | Resident account deletion; admin suspension of residents; staff role change/removal; per-room opening hours; rejected-listing reasons |

\* Centre/club public pages are behind `VITE_VENUE_PAGES_PUBLIC`; Google sign-in needs Firebase (not configured in QA) — both are external-dependency limits recorded in the results.

## 4. Journey matrix

Columns: **ID · Role → starting state → steps → expected UI → expected server result → persisted result →
notifications → evidence (spec / suite)**. "Notif." lists in-app rows (`notifications`) — email is never delivered
in QA.

### 4.1 Customer

| ID | Role / start | Steps | Expected UI | Expected server | Persisted | Notif. | Evidence |
|---|---|---|---|---|---|---|---|
| C-01 | Guest | Browse home, Explore, Games, Circles, Experiences, Programmes; open details | Cards distinguish types; detail shows operator, place, schedule, price, cancellation | Only approved / publicly visible rows returned | none | — | `product-*`, `visibility-adjacent`, `stage-b-visibility*`, VAL-UX-CONSUMER |
| C-02 | Guest | Search + filters, Load more, network failure | Results vs no-results vs error distinct | Server pages | — | — | HC-QA-073-UI, HC-QA-063-TIMEOUT |
| C-03 | Guest | Map/list consistency | Same items on map and list | — | — | — | **BLOCKED** (Mapbox disabled in QA; external) |
| C-04 | Guest → resident | Password signup, email verification, login, logout, expired session | Clear errors, no account takeover | Duplicate/existing identities refused; one-time verification | `residents`, `guest_sessions` | — | `qa:auth` (REAL-AUTH-*, AUTH-SEC-*) |
| C-05 | Resident | Password reset / recovery | Single-use link | Token bound to account, replay rejected | token consumed | — | AUTH-SEC-RECOVERY-*, RECOVERY-ADJACENT, HC-QA-003/004 |
| C-06 | Guest A vs Guest B | Book; B tries A's ref | B denied | Foreign client id/email rejected | unchanged | — | IDOR-BOOKING, STAGE-B-BOOKING |
| C-07 | Guest/resident | Venue (hall) booking: room, slot, duration, guests, coupon, cash | Quote = charged amount | Server price, capacity lock, no double booking | `bookings` | vendor | BK-CENTRE-*, HC-QA-035/036/037 |
| C-08 | Guest/resident | Club registration, capacity 1, waitlist, offer, claim | Waitlist offered when full | Club + session capacity under concurrency | `registrations`, `waitlist_entries` | resident/vendor | BK-CLUB-*, HC-QA-034/044 |
| C-09 | Resident | Programme enrolment, duplicate submit, cancel | One enrolment | Idempotent | `program_enrollments` | vendor | BK-PROGRAM-*, HC-QA-038, HC-GAP-PROG-1 |
| C-10 | Resident | Experience booking (party size), cancel within/outside cutoff | Price = seats; cancel eligibility explained | Server-decided `canCancel` | `experience_bookings` | vendor | BK-EXPERIENCE-*, HC-QA-039/042/045, HC-GAP-EXP-1, HC-GAP-UI-EXP* |
| C-11 | Resident | Activity join/leave/waitlist; last place race | Full → waitlist | Capacity never exceeded | `game_participants` | host | BK-ACTIVITY-CONCURRENT, LC-ACT-*, HC-QA-026* |
| C-12 | Resident | Circle join/request/leave; invite accept/decline | Correct state chips | Invite-only enforced | `circle_members` | organiser | LC-CIR-*, IDOR-CIRCLE*, HC-QA-033* |
| C-13 | Resident | Paid checkout every type (Stripe test) | Quote = Stripe amount | Hold, signed webhook confirms, expiry releases | `payment_status` | payer | STRIPE-CHECKOUT-AMOUNTS, STRIPE-EXPIRY, STRIPE-DECLINE, STRIPE-LATE-SUCCESS, STRIPE-RETURN-URL |
| C-14 | Resident | My Life, receipts, favourites, notifications, chat | One upcoming/past view; failures shown as errors | Own rows only | — | — | HC-QA-066, HC-QA-073-NOTIFICATIONS, IDOR-NOTIFICATIONS, LC-CIR-CHAT, VAL-UX-ERRORS |
| C-15 | Resident | Cancel paid booking → refund pending → vendor refund | Consequence shown before confirming | Refund once | `refunds` | — | STRIPE-REFUND-*, HC-GAP-UI-EXP-PAID |
| C-16 | Resident | Review after verified stay; report; complaint/appeal | — | Review gated on real booking | `reviews`, `reports`, `complaints` | admin | reviews/reports server tests, STAGE-B-PERSONAL |

### 4.2 Host / Circle organiser

| ID | Role / start | Steps | Expected UI | Expected server | Persisted | Notif. | Evidence |
|---|---|---|---|---|---|---|---|
| H-01 | Host | Create draft activity, edit, publish, scheduled publish | Draft not confirmed as live | Draft private | `games` | — | LC-ACT-CREATE-DRAFT-PUBLISH, LC-ACT-SCHEDULED-*, HC-QA-032* |
| H-02 | Unverified host | Put a price on an activity | Price option unavailable | 403 while `paid_games_require_verified_host` on | none | — | `games.test.ts`, HC-QA-016-paid-concurrent |
| H-03 | Organiser | Join requests, polls, plan ideas → confirmed plan | Member ideas unofficial until confirmed | Organiser-only conversions | `circle_*` | members | LC-CIR-PLANS, LC-CIR-POLLS, HC-QA-054*, HC-QA-056* |
| H-04 | Host | Participants: remove, refund, check-in, waitlist offer | — | Another host denied | — | participant | STAGE-B-HOST-MUTATIONS, IDOR-HOST, gameCancelRefund.test |
| H-05 | Host | Activity on own paid venue booking; venue/customer cancels booking | Linked activity explained | Customer cancel blocked (409); vendor cancel cascades | `games.booking_ref` | participants | bookingUxPhase5.test |
| H-06 | Host ⇄ vendor | Link, switch workspace, stale/competing confirmations | Header switcher | No crossing into unlinked identities | `users.resident_id` | — | STAGE-B-MANAGE, CLOSURE-LINK*, manage.test |
| H-07 | Host | Host workspace tabs, Back/Forward, responsive | Cream workspace; URL tab | — | — | — | VAL-UX-WORKSPACES, VAL-UX-HISTORY |

### 4.3 Vendor

| ID | Role / start | Steps | Expected UI | Expected server | Persisted | Notif. | Evidence |
|---|---|---|---|---|---|---|---|
| V-01 | New vendor | Signup (account + org + first listing), acknowledgement | No session issued; pending explained | One transaction; race-safe | `users` pending, `organisations`, listing | vendor (sink) | `product-vendor-signup`, HC-QA-058, vendorSignupRace.test |
| V-02 | Pending vendor | Open dashboard / call API | "Awaiting approval" | `/api/vendor/*` 403 | — | — | vendorAuthFlow.test |
| V-03 | Admin → vendor | Approve account (retries/concurrency) then listing | — | Listing approve 409 until account approved; one approval email | status | vendor email once | HC-QA-058, vendorAuthFlow.test |
| V-04 | Owner | Centre editor: rooms, hours, blocks, capacity, pricing | Rollups follow rooms | ≥1 active room; deactivate not delete | `rooms`, `centre_hours`, `room_blocks` | — | vendorListings.test, STAGE-B-ROOM-ASSIGNMENT |
| V-05 | Owner | Club editor, sessions, waitlist | — | Session delete rules | `club_sessions` | — | HC-QA-044, STAGE-B-CLUBS |
| V-06 | Owner | Programmes, sessions (Irish dates), attendance | — | Child IDs scoped | `program_*` | residents on session cancel | HC-QA-100, PART-11, ATTENDANCE-*, STAGE-B-CHILD |
| V-07 | Owner | Experiences, departures, cancel departure | Persisted price/duration shown | Cascade cancel, notify once | `experience_*` | bookers | HC-QA-040, HC-QA-061*, STAGE-B-EXPERIENCES |
| V-08 | Owner | Publish → admin reject → edit → **resubmit** → approve; pause/resume | Rejected listing explains next step | Rejected → pending allowed | status + audit | — | **VAL-LISTING-LIFECYCLE** (new) |
| V-09 | Owner | Bookings: check-in, cancel, refund | Booking details open from keyboard | Refund once; provider-cancel auto-refund | — | customer | STRIPE-REFUND-*, HC-QA-066-VENDOR, STAGE-B-VENDOR-OPS |
| V-10 | Owner | Messages, review replies, offers, earnings, payouts status | Disabled payouts not shown as available | Finance-gated | — | — | STAGE-B-VENDOR-OPS, revenue-partner |
| V-11 | Owner + 5 staff roles | Programme create/edit/session/archive, coupons, payments, CSV, broadcast, invites, policies, claims | Hidden tabs per role | Role checks per endpoint | unchanged on deny | — | **VAL-STAFF-MATRIX** (new), RBAC-STAFF, STAGE-B-ORG |
| V-12 | Owner A vs Org B | Cross-organisation access by ID substitution | — | 403 | unchanged | — | IDOR-VENDOR, STAGE-B-CLUBS |
| V-13 | Admin → vendor | Suspend, existing session, reinstate | "Account suspended" | Login refused; session 403 | audit | — | **VAL-SUSPENSION** (new), seeded suspended control |
| V-14 | Owner | Vendor workspace tabs, Back/Forward, responsive | Cream workspace; URL tab | — | — | — | VAL-UX-WORKSPACES, VAL-UX-HISTORY |

### 4.4 Admin

| ID | Role / start | Steps | Expected UI | Expected server | Persisted | Notif. | Evidence |
|---|---|---|---|---|---|---|---|
| A-01 | Non-admins | Every admin mutation | — | 401/403, rows unchanged | unchanged | — | RBAC-001, STAGE-B-ADMIN |
| A-02 | Super/finance/support/legal | Each gated tool + role admin | Lock + explanation for restricted tools | Sub-role gates | — | — | **VAL-ADMIN-SUBROLES** (new), `adminNav` |
| A-03 | Admin | Listing approve/reject, claims, host applications, place suggestions | Confirm dialogs | Audit trail for decisions | audit_log | followers / applicant | VAL-LISTING-LIFECYCLE, server tests |
| A-04 | Admin | Reports, moderation case, complaints/appeals with statement of reasons | Reasons required | Audited | `reports`, `complaints` | submitter | reports.test, policies.test, revenue-admin |
| A-05 | Finance | Commercial rules, switches, coupons, ledger, settlements, refunds, disputes, webhooks | States where each rule applies; failed loads shown as errors | Reason required | rule versions, audit | — | revenue-admin(-b), SANDBOX-*, VAL-UX-ERRORS |
| A-06 | Admin | Policies, templates, media, settings, audit log | Readable audit descriptions | — | — | — | revenue-admin-b, stage-b-media, adminMedia.test |

### 4.5 Commerce

| ID | Check | Expected | Evidence |
|---|---|---|---|
| M-01 | Server totals = client display = Stripe amount, every paid type | Equal to the cent | STRIPE-CHECKOUT-AMOUNTS, STRIPE-R3A-*, HC-QA-042/047/049 |
| M-02 | Rule coverage | Admin UI states where each rule applies; legacy paths documented | Code inspection + catalog `appliesTo` (fix), revenue-admin |
| M-03 | Discounts, fees, deposits, VAT | Single-use coupon once; deposit only on online hall bookings | BK-*-COUPON-BOUNDARY, HC-QA-037, STRIPE-COUPON-SINGLE-USE |
| M-04 | Signed webhooks, retries, duplicates, unknown events | Unsigned/tampered rejected; duplicates no-op; replay | HC-QA-048, STRIPE-WEBHOOK-*, SANDBOX-WEBHOOKS-G, stripeWebhook.test |
| M-05 | Refund once | One provider refund under concurrency | STRIPE-REFUND-CONCURRENT, HC-QA-091-PARTIAL |
| M-06 | Ledger, settlement, payouts (sandbox, switches on in test only) | Reconciles to the cent | SANDBOX-MONEY-*, SANDBOX-RECONCILE, SANDBOX-SPLIT, SANDBOX-DISPUTES-E |
| M-07 | Disabled Pro/rewards/credits/splits stay gated | 409/hidden while off; Pro blocked by fee-model constant | revenue-plan, revenue-rewards, revenue-credit, revenue-split, releaseGates.test |

### 4.6 Security and integrity (cross-cutting)

| ID | Check | Evidence |
|---|---|---|
| S-01 | Role/action permissions incl. hidden actions via direct API | RBAC-*, STAGE-B-*, VAL-STAFF-MATRIX, VAL-ADMIN-SUBROLES |
| S-02 | Cross-org / cross-user ownership (bookings, listings, documents, media) | IDOR-*, STAGE-B-MEDIA, HC-QA-062-BOUNDARIES |
| S-03 | Pending/suspended restrictions | vendorAuthFlow.test, VAL-SUSPENSION |
| S-04 | Sensitive-action reasons + audit | VAL-LISTING-LIFECYCLE, INVITATION-AUDIT, revenue-admin |
| S-05 | Upload validation (magic bytes, size, type, ownership) | media.test, HC-QA-062*, STAGE-B-MEDIA |
| S-06 | Session/identity switching boundaries | STAGE-B-MANAGE, CLOSURE-LINK* |
| S-07 | Login redirects and `returnTo` | authRedirect.test (client), RBAC-BROWSER, VAL-UX-RESTRICTED |
| S-08 | Concurrency / overselling / duplicate processing | *-CONCURRENT, REM-*, STRIPE-CONCURRENCY*, HC-QA-046/054 |
| S-09 | Errors never echo secrets | STAGE-B-ERRORS, HC-QA-004 |

### 4.7 UX / UI (detail in the UX document)

| ID | Check | Evidence |
|---|---|---|
| U-01 | Workspace shells (admin, partner, host) match the approved cream system | VAL-UX-WORKSPACES screenshots |
| U-02 | Tabs in the URL: Back/Forward/refresh/shared links | VAL-UX-HISTORY, HC-QA-065 |
| U-03 | Loading / empty / no-results / error / restricted distinct | HC-QA-063/064/053, VAL-UX-ERRORS, VAL-UX-RESTRICTED |
| U-04 | Accessibility: one H1, skip link, labels, focus trap, Escape, keyboard rows | HC-QA-083-*, HC-QA-066/067/068/069/070/088, product-a11y-* |
| U-05 | Responsive 390 / 820 / 1440: no page overflow, reachable actions | lifecycle-ui-responsive, HC-QA-001-*, VAL-UX-WORKSPACES |
