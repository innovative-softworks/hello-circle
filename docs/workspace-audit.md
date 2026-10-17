# Workspace audit: Super Admin, Partner (Vendor) and Host

_Read-only audit, 2026-10-16. No application code was changed. Branch `feature/commerce-engine` at `1ba8c7b` plus 146
uncommitted files. The audit describes the working tree. Companion documents:
`workspace-page-inventory.md`, `workspace-information-architecture.md`, `workspace-ux-ui-specification.md`,
`workspace-workflow-matrix.md`, `workspace-permission-matrix.md` and `workspace-implementation-plan.md`._

Labels used throughout: **Verified** means seen in code or in an executed run this session. **Prior** means an
earlier recorded run (the document is named). **Assumption** and **Recommendation** mean what they say.

---

## 1. Summary

The three management workspaces are much further along than the brief's target list implies. The admin, partner and
host workspaces already share one cream workspace shell. They use URL-driven tabs, records as pages, centred dialogs
and no side drawers. Server-side authorisation is deny-by-default for admins (D-02) and enforced on every partner
and host write route I inspected (§4). Every target-IA module has a home today: 22 of 46 fully, 24 partly. Many sit under
a different name or inside a neighbouring page (see `workspace-information-architecture.md`).

**What is actually wrong or missing, ranked:**

| ID | Priority | Finding | Evidence |
|---|---|---|---|
| WA-01 | **P1** | A person whose partner and host accounts are linked **cannot open the host workspace**. `/manage` redirects to `/vendor` whenever a vendor session cookie exists, and switching to "Personal" never clears that cookie. The account menu still offers "Manage hosting". This hits exactly the "become a provider" path (Verified Host → linked vendor). | `client/src/pages/ManageHome.tsx:110` (`if (user) return <Navigate to="/vendor" />`, from commit c881045, which predates Manage switching); `server/src/routes/manage.ts:264-288` (switch mints the second cookie and keeps the first); `client/src/navigation/navConfig.ts:150`. **Verified by code, not live.** |
| WA-02 | **P1** | The 2026-10-16 redesign work (admin pages 1–20, the partner and host workspace redesign, the editor popups) **has not been run through any `qa:*` suite**. Specs were edited to match it but never executed. The QA profile is not provisioned right now, so `npm run qa:preflight` fails on missing isolated credentials. | `qa:preflight` output this session; memory notes for 2026-10-16 say "qa:* NOT run". |
| WA-03 | **P1** | **Failed loads can hang or look empty.** 25 load calls in workspace components have no error handling, so a failed request leaves "Loading…" on screen forever or shows an empty list, with no Retry. Affected: the Offers, Reviews, Programmes and Experiences lists; Host Circles, Earnings, Insights, Offers and Reviews; both **check-in screens** (used at the door); and Org Insights and profile. This breaks the project rule "failed loads use `LoadErrorState`, never a silent empty list". Silent empty results (`.catch(() => set([]))`) also hide host join requests (`HostAttention.tsx:41`) and the rooms in "Block time" (`VendorBlockTimeDialog.tsx:28`). | Line list in §3.3. **Verified by code.** |
| WA-04 | P1 (decision) | **No way to add an admin.** Admin accounts are only created by seeding. `/admin/admins` only lists admins and changes their role, so the four sub-roles (super/finance/support/legal) cannot be staffed from the product. | `server/src/routes/admin.ts:68` (list), `PUT /admins/:id/role`; there is no create or invite route. Needs a security decision (§6, DEC-02). |
| WA-05 | P1 (blocked) | **No suspension lever for a resident** (participant or host). Trust & Safety can hide content, action reports and remove the Verified Host badge, but cannot restrict an abusive resident. | No resident status column or route. Decision **D-07 is "NEEDS INPUT (legal)"** in `hellocircle-operating-decisions.md`. |
| WA-06 | P2 | **Partner bookings are split across three tabs.** Bookings shows hall bookings and club registrations only. Experience bookings are in Experiences, programme enrolments in Programmes. Calendar does unify the schedule by day, but there is no single "all orders" list or search. | `VendorBookings.tsx` tabs `bookings` and `registrations`; `/vendor/orders` already normalises the order types for "Action needed". |
| WA-07 | P2 | **Admin lists don't paginate on the server.** `/admin/listings` and `/admin/vendors` return every row, and the audit log is capped at the latest 200 entries. That is fine today but will become a scale and performance risk. | `routes/admin.ts` (no `LIMIT` or `OFFSET`), audit `LIMIT 200` at `:1216`. |
| WA-08 | P2 | **The admin has no browsable directories for residents, hosts, Circles or bookings.** Support finds them by query (`supportLookup.ts` normalises the six order tables). There is no "list everyone or everything" view with filters. | §5 of the IA document. |
| WA-09 | P2 | **Pages not yet on the workspace design**: the create/edit activity page `/games/host` (consumer layout), `/manage/circles/:id`, centre Rooms/Hours/Availability sections, and club Sessions/Waitlist sections. | Memory note "Not restyled yet" (2026-10-16); confirmed `ManageCircle.tsx` doesn't use `HostWorkspace`. |
| WA-10 | P2 | **The host workspace has no "Venue reservations" view.** A host's venue bookings appear only in their personal My Life. `GET /api/games/host/venue-bookings` exists but feeds only the activity form's picker. | `routes/games.ts:364`. |
| WA-11 | P2 | **Customers are hard to find for partners.** Organisation → Participants is a customer list four clicks deep. | `VendorOrg.tsx` sub-tab `participants`. |
| WA-12 | P2 | **Mobile layouts were never checked on real devices.** Workspace tables fall back to `overflow-x: auto` wrappers (`admin.css:674`, `:702`). A recorded 320–390px overflow check exists only for consumer pages (sitemap audit 2026-10-11). | NV |
| WA-17 | P2 | **Two primitive sets for workspace UI.** Admin uses `adminUi.tsx` (`AdminButton`, `PageHeader`, `LoadingRows`, `EmptyMessage`, `ErrorMessage`, `OverflowMenu`, `AdminModal`, `Pager`). Partner and host use `ui.tsx` plus `workspace/*` (`Button`, `Skeleton`, `EmptyState`, `LoadErrorState`, `ActionMenu`, `Modal`) styled by an `inWorkspace` switch. That means two menus with separate keyboard code, two empty and error styles, and pagination only on the admin side. | `adminUi.tsx:473` `OverflowMenu` vs `components/ActionMenu.tsx:26`. |
| WA-13 | P3 | The Maps switch has an API but no admin control. | `GET/PUT /admin/config/maps-enabled`; no client caller other than `mapsConfig.ts`. |
| WA-14 | P3 | **No record of sent notifications.** Email goes to SMTP or the console log, and nothing records delivery history. | No delivery table in `initSchema`. |
| WA-15 | P3 | **No content tools for marketing.** Homepage content, banners, collections and SEO are not editable. What exists: the featured toggle, the editorial media library, market categories and the policy CMS. | §5 of the IA document. |
| WA-16 | P3 | Partner reporting is limited: one CSV (`/vendor/reports/bookings.csv`) plus Org → Insights. | `vendorInsights.ts`. |

**No new P0 was found in workspace scope.** The P0s still open elsewhere are commercial, not workspace defects. They
are the paid-checkout commercial model (**D-04 / D-09 "NEEDS INPUT"**, `legacy-compat-v1` commercially unapproved)
and its consequence that production paid checkout stays closed. They block a paid launch whatever is done here.

## 2. Phase 0: what the application is (verified)

- **Stack:** React 18 + Vite + TypeScript client; Express + TypeScript + MySQL (`mysql2` behind a better-sqlite3-shaped
  shim) server; npm workspaces; one origin. Schema changes are additive `ensureColumn()`s with no down-migrations and
  no foreign keys.
- **Identity:** `req.user` (vendor/admin, password), `req.resident` (magic link/password/Google),
  `req.guestEmail`, anonymous `X-Client-Id`. The Manage bridge links one `users` row to one resident.
- **Workspaces:** admin `/admin` (`AdminShell`), partner `/vendor` (`PartnerWorkspace`), host `/manage`
  (`HostWorkspace`). All are built on `WorkspaceShell`. The header merges workspace label, account and sidebar toggle
  into the global header.
- **Participation tables (deliberately not unified):** `bookings`, `registrations`, `program_enrollments`,
  `game_participants`, `circle_members`, plus `experience_bookings` and `passes`.
- **Commerce:** checkout is centralised (`checkoutService.createCheckoutSession()` records a checkout agreement), the
  webhook is signed, events are stored once, paid orders under review are held (D-10/D-11), and pricing is computed on
  the server. **Every commerce switch defaults off** except `paid_games_require_verified_host` and
  `auto_refund_unfulfillable`. That includes the ledger, Connect, Pro, rewards, customer credits, Open Booking and the
  venue/host split (`server/src/commerce/catalog.ts:400-430`).
- **Baseline run this session:** `tsc --noEmit` passes for client and server; client Vitest **279/279**; server
  Vitest (isolated Docker profile) **937 passed, 23 skipped**.

## 3. Phase 1: page audit by workspace

Per-page facts are in `workspace-page-inventory.md`. This section records quality findings.

### 3.1 Super Admin
- **Works well:** decision-first Overview; records as pages, so Back keeps filters; every decision asks for a reason
  where D-03 requires one; permission-aware navigation that shows a lock and a "not included in your role" page; icon
  tabs on Finance, Commercial, Settings, Insights and Policies; forms in popups (`AdminModal`) with a discard check.
- **Gaps:** WA-04 (no admin invitations), WA-07 (server pagination), WA-08 (no resident, host, Circle or booking
  directories), WA-13 (Maps switch control), WA-14 (delivery log). The "shared inbox" across pending, claims, hosts,
  places and reports was considered on 2026-10-16 and not built. The Overview queue plus "next after decision" covers
  most of that need.
- **Previously reported, not re-verified:** opening `/admin` without an admin session produces a nested `returnTo`
  redirect (`admin-and-vendor-reference.md` §2.3).

### 3.2 Partner (Vendor)
- **Works well:** account-state gating (pending, suspended with reason, organisation suspended → obligations page,
  removed member); staff-role tab filtering that mirrors the server; editor section cards with popup save, snapshot
  cancel, error summary and readiness rail; Bookings record page with separate booking, payment, refund and check-in
  states; vendor cancel automatically refunds.
- **Gaps:** WA-06 (bookings split by type), WA-09 (rooms, hours and sessions sections), WA-11 (customers buried),
  WA-16 (reports). Listing claims carry no staff-role check. That is an open decision, D-06 ("PROPOSED").

### 3.3 Host
- **Works well:** activity record page (participants, refunds, waitlist offers, check-in, update templates), host
  ownership checked on every write, Earnings with a separate trader view, Pro and Rewards pages in the shell.
- **Gaps:** WA-01 (unreachable when linked), WA-09 (activity form, Circle manage page), WA-10 (venue reservations).
  Participant communication is split across activity updates, `/chats` and Circle chat, with no Messages tab.
  Consolidating it is P3 and needs a design pass; CLAUDE.md lists four messaging mechanisms on purpose.

**WA-03 locations.** Each line below calls `.then(set…)` with no `.catch`:
`VendorCentreEditor.tsx:533,548` · `VendorCheckInScreen.tsx:38` · `VendorExperiences.tsx:660` ·
`VendorOffers.tsx:21,25` · `VendorOrg.tsx:599,762` · `VendorPrograms.tsx:84,680` · `VendorReviews.tsx:16` ·
`HostChatButton.tsx:99` · `HostCheckInScreen.tsx:23` · `HostCirclesTab.tsx:25` · `HostDashboardPanel.tsx:23,24` ·
`HostEarningsTab.tsx:19` · `HostInsightsTab.tsx:20` · `HostOffersTab.tsx:17,21` · `HostReviewsTab.tsx:15` ·
`ManageCircle.tsx:663` · `AdminMedia.tsx:60,63` · `AdminPolicy.tsx:190`.
Silent `.catch(() => set([]))`: `VendorAttention.tsx:35`, `VendorBlockTimeDialog.tsx:28`, `HostAttention.tsx:41`,
`VendorParticipationEditor.tsx:42`.

### 3.4 States checklist (code-reviewed)

| State | Admin | Partner | Host |
|---|---|---|---|
| Loading | Skeletons and spinners on lists | Mixed: several tabs show "Loading…" text only | Mixed |
| Empty / no-match | Separate empty vs no-match | `EmptyState` (frame removed in workspaces) | `EmptyState` |
| Error + Retry | `LoadErrorState` / `loadFailure.tsx` | Bookings, Experiences, Org yes; **others no (WA-03)** | Activities yes; **others no (WA-03)** |
| No permission | Lock + role page; server 403 | Hidden tab → Overview + toast; server 403 | Server 403 (no client role concept) |
| Pending approval | Queue + review page | "Awaiting approval" + checklist | not applicable (hosting needs no approval; the badge is optional) |
| Suspended | Partner and organisation levers | Suspended / obligations pages | **No lever (WA-05)** |
| Draft / published / archived | Listing statuses | Publish, pause, resume, duplicate | Drafts / coming soon pills |
| Payment pending / failed / review | Finance + `paymentReview` flag | Booking record payment status | Activity record |
| Refund pending | Finance refunds | "Action needed" (`refund_pending`) | Activity record refund |
| Success / failure feedback | Toasts on every write | Toasts | Toasts |

## 4. Phase 5: security and data integrity (code-reviewed)

- **Admin:** `requireAdmin` is applied once to `adminRouter`, and every route declares exactly one permission. The test
  `adminPermissions.test.ts` walks the routers and fails on any route without one. The permission table is
  deny-by-default with no relaxing mode. **Prior:** D-02/D-03 validation, all suites green on 2026-10-15.
- **Partner:** I scripted every write route in `vendorListings`, `vendorPrograms`, `vendorOperations`,
  `vendorExperiences`, `vendorParticipation`, `org`, `partnerPlan`, `payouts` and `venueSplits`.
  - Each write checks ownership through `req.vendorIds`, the org's vendor ids from `orgVendorIds()`. Each also asserts a
    staff platform role, either per route or at router level (`partnerPlan`, `payouts` and `vendorSplits` require
    `finance`; plan changes are owner-only).
  - One exception: `POST /vendor/claims`, where any staff member can file a claim. That is decision D-06.
  - **Prior:** `qa:authorization` 83/83 (2026-10-12) and `VAL-STAFF-MATRIX`.
- **Host:** every game write compares `games.host_resident_id` with `req.resident.id` (remove, refund, check-in,
  updates, cancel, edit, waitlist offer). Every Circle organiser action calls `isOrganiser()`. Split proposals check
  the game's host (`commerce/allocations.ts:127`).
- **Payments:**
  - The webhook requires a signature, and unsigned events are allowed only locally behind an explicit opt-in.
  - Events are idempotent (`webhook_events`).
  - A paid event confirms only when it matches its checkout agreement.
  - Held reviews keep capacity until a stored deadline.
  - Refunds are recorded before the provider call.
  - Live keys are refused outside production.
  - **Prior:** `qa:stripe` 51/51 on final code (2026-10-15).
- **Gaps:**
  - WA-04: admin onboarding happens outside the product, so who becomes an admin is unaudited.
  - WA-05: no resident restriction lever.
  - No admin 2FA. Not requested; listed for the decision on admin invitations.
  - The in-memory rate limiter only works on a single instance (known; CLAUDE.md).

## 5. Phase 2: comparison with the target IA (summary)

The full table is in `workspace-information-architecture.md`. Of the 46 target modules (17 admin, 15 partner,
14 host):
- **Exist** (possibly renamed or merged): 22 (48%).
- **Partial:** 24 (52%). Examples: admin Users, Hosts and Bookings exist as lookups, not directories; partner
  Availability is spread across the editor and Calendar.
- **Entirely missing:** none.
- **Missing sub-pages recommended now:** admin invitations (WA-04), admin People/Orders/Circles/Hosts directories
  (WA-08), host Venue reservations (WA-10), partner "All orders" (WA-06), and promoting partner Customers (WA-11).
- **Missing sub-pages not recommended now:** support ticketing, marketing CMS, peak/off-peak pricing, document storage
  for business verification, separate "Ticket types" for hosts. Each needs a business decision, would add new
  financial or GDPR surface, or duplicates something that already exists.

## 6. Decisions that need the owner

| ID | Decision | Why it can't be assumed |
|---|---|---|
| DEC-01 | **Corner radius.** The brief says 2px everywhere. The owner chose **8px for workspaces** on 2026-10-16. | The two instructions conflict; the latest owner instruction wins until changed. |
| DEC-02 | Admin invitations: who may invite (super only?), invite expiry, whether to require 2FA. | Privilege-widening security flow. |
| DEC-03 | When both a vendor and a resident session exist, which identity should `/manage` use? Recommended: the resident, whenever a resident session exists. | Changes cross-identity behaviour (WA-01). |
| DEC-04 | A unified, read-only partner "All orders" list over the existing tables (no table unification). | Touches a CLAUDE.md "known gap"; read-only aggregation only. |
| DEC-05 | Resident suspension and deletion: **existing D-07**. | Legal input pending. |
| DEC-06 | Re-approval of edits to approved listings: **existing D-05**. | Policy. |
| DEC-07 | Staff listing claims: **existing D-06**. | Policy. |
| DEC-08 | Fee model, Pro and rewards go-live: **existing D-04 / D-09**. | Money and tax. |
| DEC-09 | Out of scope for now: support ticketing, marketing CMS, peak pricing, document storage. | New systems, recurring costs, financial or GDPR surface. |

## 7. Verification limits (read before trusting any "works")
- **Not live-tested this session.**
  - Reusing stored demo session tokens against the dev server was refused by the session's safety classifier, and I
    did not work around it.
  - The isolated QA profile is missing (`qa:preflight` lists the absent `QA_*` inputs). Per the D-02/D-03 record,
    restoring it needs owner approval each time.
- **What did run:** both type-checks, client Vitest 279/279, server Vitest 937 passed and 23 skipped.
- **"Prior" results ran on earlier code.** The 2026-10-16 UI work came after all of them (WA-02).
- **Responsive widths 320–1920 were not measured** for the workspaces.
