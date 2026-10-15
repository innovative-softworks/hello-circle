# HelloCircle — Admin & Vendor workspace reference

_Written 2026-10-14 from the code on `feature/commerce-engine` (with the uncommitted admin redesign). Purpose: give a
person or an AI enough context to work on the **platform admin** (`/admin`) and the **vendor (partner) workspace**
(`/vendor`) without re-reading the codebase. Read `CLAUDE.md` first for the wider architecture._

---

## 1. Who is who

| Identity | How they sign in | Lands on | Server guard |
|---|---|---|---|
| **Platform admin** (HelloCircle staff) | Email + password at `/login` (`users.role = 'admin'`) | `/admin` | `requireAdmin` + sub-role `requireAdminRole(...)` |
| **Vendor / partner** (centre, club or experience operator) | Email + password (or Google) at `/login` (`users.role = 'vendor'`) | `/vendor` | `requireVendor` + `attachVendorIds` (+ `requirePlatformRole` for invited staff) |
| Resident (public user) | Magic link / Google | `/bookings`, `/profile` | `attachResident` — not covered here |
| Resident host (runs Games/Circles) | Resident identity | `/manage` | separate "HelloCircle Manage" surface — not covered here |

**Admin sub-roles** (`users.admin_role`; null = super): `super` (everything), `finance` (money, commercial rules, coupons),
`support` (moderation, complaints, trader checks), `legal` (policies, field help, trader checks). Only a super admin
changes roles; you can't change your own; the last super admin can't be demoted.

**Vendor organisations & staff roles.** Every vendor belongs to an organisation (`users.org_id`, created at signup).
"Your listings" means *every listing owned by anyone in your org* (`orgVendorIds()` → `req.vendorIds`). The **org owner**
(`invitedStaff = false`) can do everything. **Invited staff** have one `platform_role`:
`centre_manager`, `facility_manager`, `finance`, `communications`, `read_only_analyst`.

**Seeded dev admin:** `itadmin@hellocircle.ie` (password in `server/.env` → `HELLO_CIRCLE_ADMIN_PASSWORD`). Dev DB is
`hello_circle_dev`; never point routine work at `hello_circle` (prod).

---

## 2. Platform admin (`/admin`)

### 2.1 Shell & conventions (redesign 2026-10-14)
- One route, tool selected by `?tab=<key>` (URL-driven: Back/Forward and shared links work). Unknown tab → Overview
  plus a notice. `?tab=finance&section=<x>` opens a Finance sub-section; `section=roles|help` redirects to Settings.
- Layout: consumer header → light cream **Admin workspace** strip (role · email · View platform) → **220px grouped
  sidebar** (collapsible to a 64px icon rail, remembered in `localStorage hc_admin_sidebar_collapsed`) → page →
  compact admin footer. On narrower screens (≤1024px) a **Sections** button opens the nav as a sheet.
- Visual tokens: cream `#F7F4EC`, panels `#FFF`, text `#172019`, secondary `#5B635C`, accent/primary `#FF4B24`
  (label `#172019`), borders `#E5E1D8`, 0–2px radius. Headings Bricolage Grotesque; **body Inter (admin only)**.
- Nav items the admin's sub-role can't use show a lock and render a "Not included in your admin role" page
  (client mirror in `adminNav.ts`; the server is the real enforcement).
- Every list: search, filters, status views, sort, client-side pagination (20–25/page), loading skeleton, empty vs
  no-match vs error-with-Retry states. Every write shows success/failure toasts; destructive actions confirm.

**Code:** `client/src/pages/AdminDashboard.tsx` (routing only) · `client/src/components/admin/` (`AdminShell`,
`adminUi` primitives, `adminNav`, `auditFormat`, one module per tool, `admin.css`) · older tools rendered inside the
shell: `components/AdminFinance.tsx`, `AdminCommerce.tsx`, `AdminPolicy.tsx`, `AdminMedia.tsx`.
**API:** `server/src/routes/admin.ts` (+ `adminCommerce.ts`, `adminFinance.ts`, `adminMedia.ts`, `adminPolicies…`).
**Audit/UX doc:** `docs/admin-ux-audit-2026-10-14.md`; screenshots `docs/admin-redesign-2026-10-14/`.

### 2.2 Tools

| Group | Tool (`?tab=`) | What it does | Main endpoints | Role |
|---|---|---|---|---|
| Admin | **Overview** (`overview`) | 7 metrics with explicit periods (awaiting review, open reports, bookings today, failed payments, listings, partners, reviews); "Needs a decision" queue (pending listings, claims, host apps, place suggestions, open reports) with Review next; quick links; recent activity in plain language | `GET /stats`, `/listings`, `/claims`, `/host-applications`, `/place-suggestions`, `/reports`, `/audit` | any |
| | **Pending approvals** (`pending`) | Pending centres/clubs/experiences: approve (blocked until the partner account is approved — server 409), reject (confirm), bulk approve/reject, review panel (info, media, partner, settings, activity) | `PUT /centres|clubs|experiences/:id/status` | any |
| | **Support** (`support`) | Look up bookings, registrations, accounts, sessions, circles by ref/name/email (20 per type); recent Open Bookings & circles | `GET /support/search`, `/activity-overview` | any |
| Marketplace | **All listings** (`listings`) | Everything (incl. experiences): status views, type/county filters, sort; feature/unfeature, reject, delete (centre/club), assign organisation (experimental, no effect yet) | `/listings`, `/:table/:id/featured`, `DELETE /centres|clubs/:id`, `/centres|clubs/:id/organisation` | any |
| | **Vendors** (`vendors`) | Partner accounts; panel: onboarding details, approve / suspend (confirm) / reinstate, platform role + provider tier (standard/verified/featured), org, listings, activity | `/vendors`, `/vendors/:id/status`, `/platform-role`, `/provider-tier` | any |
| | **Claims** (`claims`) | Partners claiming an unowned listing → approve (needs approved partner) / reject | `/claims`, `/claims/:id/status` | any |
| | **Host applications** (`hostApplications`) | Verified Host badge for residents → approve / reject (badge only; hosting works anyway) | `/host-applications/:id/status` | any |
| | **Place suggestions** (`placeSuggestions`) | Resident-suggested places → approve & publish (creates listing) / reject; "all incl. decided" view | `/place-suggestions?status=all`, `/:id/status` | any |
| | **Organisations** (`organisations`) | Partner orgs (per-org feature flags: Open Booking, Programs, Experiences — server-enforced) + create "custom" orgs (scaffolding, no effect) | `/organisations`, `/organisations/:id/flags/:key` | any |
| | **Demand** (`demand`) | Participation-intent clusters (notify matching residents) + unmet searches | `/demand`, `/demand/intents`, `/demand/intents/notify` | any |
| | **Marketplace health** (`marketplaceHealth`) | Liquidity, referrals, analytics funnel | `/marketplace-health`, `/referrals`, `/analytics/funnel` | any |
| Business | **Coupons** (`coupons`) | Create HelloCircle-funded or split codes (limits, dates); pause/resume/archive — **reason required, audited** | `/coupons` | finance |
| | **Commercial rules** (`commerce`) | Versioned fees/rates/plans/VAT/settlement rules (draft → approve → publish, never retroactive), feature switches, shadow report, history | `/commerce/*` | finance |
| | **Finance** (`finance`) | Sub-sections: ledger overview, simulator, settlements (dry run), transfers, partner debts, credits & Pro, reward points, coupon usage, bank payouts, payment events (webhooks), refunds, disputes, plans & promotions. Every write asks for a reason | `/finance/*` | finance |
| Trust & Platform | **Reviews & reports** (`reviews`) | User reports → case panel (target record, related reports, internal notes, statement of reasons, dismiss / mark actioned / suspend content); reviews hide/unhide | `/reports`, `/reports/:id/case`, `PUT /reports/:id`, `/reviews`, `DELETE /api/reviews/:id`, `/reviews/:id/unhide` | any |
| | **Policies & trust** (`policies`) | Policy documents (versioned drafts, legal sign-off), company details/placeholders, complaints & appeals (statement of reasons shown to submitter), trader verification | `/policies/*`, `/complaints`, `/traders` | legal / support |
| | **Audit log** (`audit`) | Latest 200 entries, readable descriptions + technical details, filters | `GET /audit` | any |
| | **Notification templates** (`notificationTemplates`) | Override/reset wording of booking/registration confirmation & cancellation messages | `/notification-templates/:key` | any |
| | **Media** (`media`) | Upload switches + editorial image library | `/api/admin/media/*` | any |
| | **Settings** (`settings`) | System status, admin roles (super), field help (super/legal), market categories per county, For You weights | `/status`, `/admins`, `/help/*`, `/market-categories`, `/recommendation-weights` | mixed |

### 2.3 Admin known gaps (not yet fixed)
- ~~Not audit-logged: listing approve/reject/delete, claims, review hide/unhide, provider tier, org assignment~~ —
  **fixed 2026-10-14** (all now `writeAudit` with previous/new values; see `docs/hellocircle-validation-results.md` F-04).
  Listing rejection and vendor suspension still take no reason (business decision D-03).
- Lists are fully loaded and paginated in the browser; `/audit` returns only the latest 200.
- `GET /admin/reviews` returns snake_case columns (`SELECT *`) — client reads both spellings.
- `GET /stats` "bookings today" uses MySQL `CURDATE()` (server date) and counts hall bookings + club registrations only.
- No maps-enabled toggle in the UI (API exists: `PUT /admin/config/maps-enabled`).
- Opening `/admin` with a non-admin session produces a nested `returnTo` redirect.

---

## 3. Vendor / partner workspace (`/vendor`)

### 3.1 Lifecycle
1. **Signup** `/vendor/signup` — one form = account + first listing intake (centre or club). Creates `users` row
   (`status: pending`), an organisation, and a **pending** listing in one transaction. No session is created.
2. **Pending** — `/vendor` shows "Awaiting approval" + a setup checklist; nothing editable.
3. **Admin approves the account** (Admin → Vendors), then **approves the listing** (Admin → Pending approvals). A listing
   can't go live while its partner is pending/suspended.
4. **Approved** — full dashboard. **Suspended** — "Account suspended" screen, no access.
5. A verified resident host can also "become a provider" (`/manage` → creates a linked vendor account); the header's
   "Personal ⇄ business" switcher moves between the two identities (`routes/manage.ts`).

### 3.2 Shell
_Updated 2026-10-14:_ `pages/VendorDashboard.tsx` now uses the shared cream **`WorkspaceShell`**
(`components/workspace/WorkspaceShell.tsx`, built on `admin.css`): "Partner workspace" strip (role · business · email ·
View public profile), grouped Lucide sidebar (Run / Listings / Business / Organisation) with unread count, breadcrumbs,
compact footer. Tabs are URL-synced via `useUrlTab` (Back/Forward/refresh work). Invited staff only see tabs their role
can use (`client/src/vendorTabAccess.ts`); a hidden tab falls back to Overview with a toast. The listing / programme /
experience **editor pages** have not been moved into the shell yet.

### 3.3 Tabs

| Tab (`?tab=`) | Who sees it (invited staff) | What it does | Components / API |
|---|---|---|---|
| **Overview** (`overview`) | all | Setup checklist, plan & rewards (compact), KPI strip (bookings, views, unread), "Next up"/coming-up schedule, needs-attention panel, opportunities, chats, tips | `VendorOverview.tsx`, `VendorOverviewCards`, `VendorAttention`, `GET /vendor/stats`, `/schedule-items`, `/opportunities` |
| **Listings / My centre / My club** (`listings`) | centre_manager, facility_manager | Centres + clubs: create, edit (full-page editors), publish, pause/resume, duplicate, delete; claim an unowned listing; "finish setting up" prompts | `VendorListings.tsx`; editors `/vendor/centres/:id` (`VendorCentreEditor`: general, location, contact, amenities, accessibility, **rooms** (capacity/rate/payment, deactivate not delete), **opening hours** per day, **blocked times**, participation settings) and `/vendor/clubs/:id` (`VendorClubEditor`: general, membership & pricing, recurring sessions, what's included, photos, **waitlist** + offer a place) |
| **Programmes** (`programs`) | managers | Multi-session programmes: create (if the org's Programs flag is on), sessions (repeat, room, instructor), enrollments, **attendance & check-in kiosk**, cancel / refund enrollment | `VendorPrograms.tsx`, `/vendor/programs/:id`, `/vendor/programs*`, `/program-sessions/:id/attendance/*` |
| **Adventures & Experiences** (`experiences`) | managers | Experience listings (general, adventure details, itinerary & what to bring, location & meeting, logistics & safety, pricing & capacity, photos), **departures** (sessions), bookings, attended/no-show, cancel departure, refund | `VendorExperiences.tsx`, `/vendor/experiences/:id`, `/vendor/experiences*` |
| **Calendar** (`schedule`) | all | Unified upcoming schedule across bookings, sessions, departures; today view | `VendorScheduleTab`, `/vendor/schedule`, `/today`, `/schedule-items` |
| **Messages** (`messages`) | communications | Notifications inbox (mark read) + message your participants (broadcast) | `VendorMessages.tsx`, `/vendor/notifications`, `/vendor/messages` |
| **Bookings** (`bookings`) | managers, finance | Hall bookings + club registrations: status, payment, check-in, cancel (confirm), resend confirmation, **refund** (finance) | `VendorBookings.tsx`, `/vendor/bookings`, `/registrations`, `/orders`, `/:kind/:ref/cancel|refund|resend-confirmation`, `/checkin/:kind/:ref` |
| **Earnings** (`earnings`) | finance | Balance, **payout account** (Stripe Connect Express onboarding/refresh/dashboard), payout history, plan & rewards (full), **venue splits** (accept/decline revenue-split proposals), transactions table, CSV export | `PaymentsPanel` (VendorOrg.tsx) → `EarningsSections`, `PayoutAccountCard`, `VenueSplitsCard`, `/vendor/earnings`, `/payments`, `/reports/bookings.csv`, `/api/vendor/payout-account/*`, `/api/vendor/splits/*` |
| **Reviews** (`reviews`, More) | communications | Read reviews, reply publicly | `VendorReviews.tsx`, `/vendor/reviews`, `/reviews/:id/reply` |
| **Offers** (`offers`, More) | finance | Partner-funded coupons: create, pause/resume | `VendorOffers.tsx`, `/vendor/coupons` |
| **Demand** (`demand`, More) | finance, read_only_analyst | What people search for in your area | `DemandTab`, `/vendor/demand` |
| **Organisation** (`org`, More) | all (owner-only actions) | Sub-tabs: **Settings** (org profile, policies, public logo, account settings: Google sign-in, linked resident account, deactivate), **Staff & roles** (invite by email with a role, revoke pending invites), **Participants**, **Insights** (hall booking utilisation, participation), **Trader details** (EU trader identity form) | `VendorOrg.tsx`, `/api/vendor/org/*`, `/api/vendor/trader-profile` |

Other vendor pages: `/vendor/pro` (Pro plan details), `/vendor/rewards` (reward-points history), `/accept-invite`
(staff invitation acceptance).

### 3.4 Vendor known gaps
- ~~`vendorPrograms.ts` has no staff-role guard~~ — **this was wrong**: every programme write calls `assertPlatformRole`
  (centre_manager / facility_manager by listing type; refunds finance). Proven per role by `VAL-STAFF-MATRIX`
  (`npm run qa:validation`).
- Editor pages (`/vendor/centres|clubs|programs|experiences/:id`) still use the older styling.
- Older tab components inside the workspace are squared by scoped CSS (`.ws`), not yet rebuilt on workspace primitives.
- Listing claims carry no staff-role check (any invited staff can file one — decision D-06).
- The Listings tab only lists centres and clubs; experiences live in their own tab.

---

## 4. Business rules an implementer must not break
- Approval chain: **partner account approved → then listing**; server returns 409 otherwise. Claims follow the same rule.
- Never trust client totals; pricing/VAT (23%)/platform fee/discounts are computed server-side (`pricing.ts`); payments
  only become `paid` via the Stripe webhook. Don't change Checkout metadata `type` literals.
- Commercial switches, coupons, credits, refunds, role changes and most finance actions **require a reason** and are
  audit-logged; keep that.
- Rooms are deactivated, never deleted; a centre always has ≥ 1 active room.
- Admin sub-role and vendor staff-role checks are enforced server-side — client hiding is only UX.
- No down migrations: schema changes are additive `ensureColumn()` in `server/src/db/index.ts`.

## 5. Working on these surfaces
- Run: `npm run dev` (API :3001, client :5173) against `hello_circle_dev`. Stripe must be **test** keys.
- Checks: `npm run test --workspace client` (Vitest), `npx tsc --noEmit -p client`, `-p server`; server Vitest needs
  Docker. Integration specs under `tests/integration/specs/` drive admin Finance/Policies/Settings — update them when
  moving tools.
- Browser QA used for the admin redesign: headless Playwright logging in with the env credentials (login is rate-limited
  to **10 per 15 minutes** — reuse one session), with all write requests intercepted so dev data and followers aren't
  touched.
- Don't commit, push or deploy unless asked. Production and staging share one VPS (see `DEPLOYMENT.md`, gitignored).

## 6. Suggested next work (from the audits)
1. ~~Workspace shell for `/vendor`~~ (done 2026-10-14); next: move the editor pages into it.
2. ~~Programme staff-role guard~~ (already enforced — the earlier claim was wrong).
3. ~~Audit logging for listing/claim/review/tier decisions~~ (done 2026-10-14).
4. Server-side pagination for admin lists and the audit log.
