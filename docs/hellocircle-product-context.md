# HelloCircle — Product Context (AI handoff)

_Self-contained summary as of 2026-10-14 (branch `feature/commerce-engine`, including uncommitted work, v0.9.0
pre-launch). Evidence and details: `docs/hellocircle-full-product-audit.md`. Claims here are code-inspected unless
noted._

## Purpose
HelloCircle is a participation marketplace for Ireland. Residents find and join local activity:
- community-centre room hire;
- sports-club registration;
- multi-week programmes;
- bookable experiences, adventures and volunteering;
- resident-hosted one-off "activities" (called **games** in code);
- recurring **Circles**.

Partners (venues, clubs, operators) list and run that supply, and HelloCircle staff moderate the marketplace and
operate commerce.

## Workspaces
| Workspace | Route | Who | Shell |
|---|---|---|---|
| Consumer | `/`, `/explore`, `/games`, `/circles`, `/experiences`, `/programs`, detail pages, `/bookings` (= `/my-life`), `/profile`, `/chats` | Guests and residents | Header + mobile tab bar + footer |
| Host ("Manage") | `/manage` (overview, activities, circles, calendar, insights, earnings, reviews, offers), `/manage/circles/:id` | Residents who host or organise | `ManageShell` (older style) |
| Partner | `/vendor` (+ editors `/vendor/centres|clubs|programs|experiences/:id`, `/vendor/pro`, `/vendor/rewards`) | Vendor org owners and staff | `ManageShell` (older style) |
| Admin | `/admin?tab=…` | HelloCircle staff | New cream workspace (`components/admin/*`, uncommitted) |

Launch gates:
- While `VITE_LAUNCH_MODE` isn't `public`, most consumer pages redirect to `/coming-soon`.
- Centre and club pages also need `VITE_VENUE_PAGES_PUBLIC=true`.
- In production, paid checkout is closed unless `PAID_CHECKOUT=open`.

## Identities and roles (none share a table)
- **Guest:** anonymous `X-Client-Id` (localStorage). Can book and register, and owns those bookings by client id.
- **Resident** (`residents`, guest session cookie): magic link, password or Google. Unlocks household, favourites,
  receipts, games, Circles, passes, chat, reports and credits. Hosting a **paid** activity needs `host_status=verified`
  (admin-approved badge, enforced by a switch that is on by default).
- **Vendor / admin** (`users`, `hello_circle_session` cookie): password, or Google login only.
  - A vendor's `status` is `pending → approved ⇄ suspended`; only `approved` passes `requireVendor`.
  - Admin sub-roles (`admin_role`): `super`, `finance` (commerce, finance, coupons), `support` (complaints, traders),
    `legal` (policies, help, traders). **All other admin routes are open to every sub-role.**
- **Vendor ⇄ resident link** (`users.resident_id`): linked through an emailed confirmation, or "become a provider" for
  verified hosts. `/api/manage/switch` swaps identity without a password.

## Organisation boundary
- Every vendor belongs to one org. "Own data" means `vendor_id` ∈ every user in the caller's `org_id`
  (`orgVendorIds`/`req.vendorIds`).
- The org **owner** is unrestricted. **Invited staff** have one `platform_role`, checked on the server
  (`requirePlatformRole` / `assertPlatformRole`):
  - `centre_manager`: centres, rooms, hours, blocks, centre bookings.
  - `facility_manager`: clubs, registrations, waitlists.
  - `finance`: refunds, coupons, payments, payouts, plan, trader profile.
  - `communications`: messages, review replies.
  - `read_only_analyst`: CSV, earnings and demand reads.
- Programmes and experiences follow the role of the listing they're attached to.
- Org profile, policies and staff invites are owner-only.
- Per-org feature flags (`open_booking`, `programs`, `experiences`) are admin-controlled and enforced on the server.

## Core entities
- **Supply:** `centres` → `rooms` (deactivate, never delete; ≥1 active), `centre_hours`, `room_blocks`; `clubs` →
  `club_sessions`; `programs` → `program_sessions`; `experiences` → `experience_sessions`.
- **Participation:** six parallel tables, deliberately not unified: `bookings`, `registrations`,
  `program_enrollments`, `experience_bookings`, `game_participants`, `circle_members`. Plus `passes`,
  `waitlist_entries` and `attendance`.
- **Community:** `games` (optionally held on the host's own paid venue booking via `booking_ref`), `circles` (plans,
  polls, invites, chat).
- **Commerce:** about 50 tables for rule versions, orders, the ledger, settlements, Connect, subscriptions, credits and
  rewards.
- **Trust:** `reviews`, `reports`, `complaints` (complaint/notice/appeal), `audit_log`, versioned policies.
- MySQL with schema built at boot (`server/src/db/index.ts` `initSchema`, additive `ensureColumn`). No foreign keys and
  no down-migrations.

## Key workflows
1. **Vendor onboarding.** `/vendor/signup` creates a pending user, an org and the first listing in one transaction, with
   no session. Admin approves the account, the vendor completes the listing and publishes it (`draft → pending`), then
   admin approves the listing. Approval returns 409 unless the account is approved.
   Listing states: `draft → pending → approved ⇄ paused`, `rejected`, `deleted`.
2. **Checkout.**
   - The server prices the order and creates a pending row plus a Stripe Checkout session with metadata `{type, ref}`
     (`type ∈ booking|registration|game|program|pass|experience`).
   - The signed webhook is deduplicated through `webhook_events`, and the row flips `pending → paid` idempotently.
   - Free and cash orders skip Stripe.
3. **Cancellation and refunds.**
   - A customer self-cancel must be before the org's `cancellation_hours` (default 48h). An online-paid cancel stays
     "refund pending" until the provider refunds.
   - A provider cancel auto-refunds once (`providerCancelRefund.ts`).
   - Cancelling a venue booking that an activity is held on: the customer is blocked (409); the vendor cancel also
     cancels the linked activities.
4. **Hosting.** Create an activity (paid only if verified), with row-locked joins, waitlist offers that expire after
   48h (swept every 15 min), check-in, updates and cancel/refund. Circles: join or request, organiser roles, plan
   ideas, polls, then a confirmed plan becomes an activity.
5. **Moderation.**
   - A report can be dismissed, actioned or suspended (suspending closes a Circle or hides a review).
   - Complaints and appeals get a statement of reasons.
   - A vendor can be suspended and reinstated.
   - There is no admin suspension of residents.

## Business rules that must not be broken
- Never trust client totals or discounts. Pricing, coupons, VAT and fees are computed on the server.
- Only the webhook (or the provider-outcome seam in tests) marks orders `paid`.
- Don't change the checkout metadata `type` literals without changing `stripeWebhook.ts` in the same commit.
- The webhook must keep signature verification, `webhook_events` dedupe, the refusal of live keys outside production,
  and the refusal of unsigned events in production and staging.
- Refunds go through the refund-once path (row lock + idempotency key).
- Partner account approval comes before listing approval, and claims need an approved partner.
- Server-side role checks are the enforcement; hiding something in the client is only UX.
- Rooms: deactivate, never delete, and keep ≥1 active room. `centres.capacity` and `from_price` are rollups.
- Coupons, admin roles, commerce switches, credits and finance writes require a reason (≥5 chars) and are audited.
- Rule versions are never applied retroactively. Commerce switch defaults live only in `commerce/catalog.ts`.
- Times are stored in UTC. Use `irelandTime.ts` for Irish wall-clock conversions.
- Don't run work against the prod DB `hello_circle`. Dev is `hello_circle_dev`. Use Stripe test mode only. Don't
  commit, push or deploy without explicit instruction.

## Implementation status
- **Live in code and enabled by default:** browse and search, all six participation flows, legacy pricing
  (**23% VAT + 5% customer fee added on top, €100 venue deposit**, all hard-coded in `server/src/pricing.ts`,
  `bookings.ts` and the client `api/public.ts`), coupons, provider refunds, waitlists, Circles, chat, reviews, reports,
  complaints, policies CMS, admin workspace, staff RBAC, vendor⇄resident switching.
- **Implemented but switched off by default** (`commerce.*` in `app_settings`; no overrides on the dev DB):
  - commerce engine (experiences only), shadow pricing and coupons v2;
  - settlement ledger and Stripe Connect payouts (settlements and transfers are manual admin runs);
  - Pro subscriptions and partner reward points (also hard-blocked by the code constant
    `PARTNER_FEE_MODEL_STATUS="proposed"`);
  - customer credits, Open Booking / Make It Happen (`"not launch-ready"`), venue/host split payouts, second-approver
    rule publishing.
- **Documented only:** `commerce.boost_vouchers`.
- **Not built:** resident account deletion; admin suspension of residents; staff change/removal; per-room opening hours.

## Important gaps
_Updated after the 2026-10-14 validation (`docs/hellocircle-validation-results.md`)._
1. Published `pricing` rules only affect experience checkout (with the engine on); `cancellation`, `checkout` and
   `plan_rules` aren't read at all. The admin Commercial rules screen now **states this on every rule card**
   ("Where this takes effect"); whether the rules should govern all checkouts is business decision D-04.
2. A suspended vendor's listings stay public and bookable (decision D-01). The vendor's own sessions are locked out.
3. Rejected listings **can now be edited and resubmitted** (rejected → pending). Rejection and suspension still carry no
   reason (D-03); edits to approved listings skip review (D-05).
4. Admin sub-roles don't restrict marketplace moderation (D-02). Listing, claim, review, org and tier decisions **are
   now audit-logged**.
5. **Stripe Connect payout onboarding fails against the current Stripe test account** (account created, onboarding link
   refused). Connect is off by default; don't enable it until `SANDBOX-CONNECT-A` passes.
6. Ops: no error monitoring; in-memory rate limiter and timers (single instance); admin and vendor lists paginated in
   the browser; audit log capped at 200; `/admin/stats` "today" uses the database server date.
7. Partner and host workspaces now use the cream `WorkspaceShell` with URL-synced tabs; the vendor **editor pages**
   still use older styling.
8. Docs: `CLAUDE.md` (no CI, unsigned dev webhooks, CORS, `apps/mobile`) and `docs/roles-and-flows.md` (resident
   passwords, chat, vendor-cancel refunds) are still out of date. `docs/admin-and-vendor-reference.md` was corrected.

> **Correction to item 2 (2026-10-14):** it was wrong when written. New checkout has been refused for a suspended partner
> user's listings since commit `f3953b6` (`vendorSuspended()` in bookings, registrations, programmes, experiences and
> passes). The listings do stay visible, and the check is per user, not per organisation. See D-01 in
> `hellocircle-operating-decisions.md`.

## Relevant source files
- **Server entry and middleware:** `server/src/index.ts`, `auth.ts` (roles, `orgVendorIds`), `residents.ts`,
  `routes/guestAuth.ts`, `routes/auth.ts`, `routes/manage.ts`.
- **Partner:** `routes/vendor.ts` → `vendorListings.ts`, `vendorPrograms.ts`, `vendorOperations.ts`,
  `vendorExperiences.ts`, `vendorInsights.ts`, `vendorParticipation.ts`; `routes/org.ts`.
- **Admin:** `routes/admin.ts`, `adminCommerce.ts`, `adminFinance.ts`, `adminMedia.ts`; client `pages/AdminDashboard.tsx`,
  `components/admin/*`.
- **Commerce:**
  - `pricing.ts`, `checkoutService.ts`, `routes/stripeWebhook.ts`, `stripeWebhookPolicy.ts`;
  - `commerce/{catalog,switches,engine,rules,payments,ledger,settlement,subscriptions,credits,rewards,releaseGates}.ts`;
  - `payments/connect.ts`, `providerCancelRefund.ts`, `selfCancel.ts`.
- **Participation:** `routes/{bookings,registrations,programs,experiences,games,circles,passes,makeItHappen}.ts`,
  `waitlist.ts`, `capacity.ts`, `bookingIntegrity.ts`.
- **Data:** `db/index.ts` (schema), `db/queries.ts` (shared reads, org policies, feature flags), `db/seed.ts`.
- **Client:** `client/src/App.tsx` (routes and launch gates), `navigation/navConfig.ts`, `api/*` (typed fetch
  wrappers), `vendorTabAccess.ts`, `components/ManageShell.tsx`, `components/booking/*`.
- **Tests:**
  - client `client/src/**/*.test.ts`;
  - server `server/src/**/*.test.ts` (needs Docker; isolated container);
  - Playwright `tests/integration/specs/*` through the guarded `npm run qa:*` runner (`qa:validation` adds the role
    matrices, listing lifecycle and workspace UX checks);
  - CI `.github/workflows/web-ci.yml`.
