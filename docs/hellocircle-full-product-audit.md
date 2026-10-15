# HelloCircle — Full Product & Technical Audit

_Audit date: 2026-10-14. Branch `feature/commerce-engine` **including uncommitted working-tree changes** (admin redesign,
`components/admin/*`, admin/seed/geocode edits). Version `0.9.0` (pre-launch). Audit only — no application code,
configuration or data was changed._

**Evidence labels used throughout**

| Label | Meaning |
|---|---|
| **[C]** code-inspected | Read in source during this audit |
| **[T]** test-verified | Covered by a test suite that was **run during this audit** and passed |
| **[P]** probe-verified | Unauthenticated, read-only HTTP request against the local dev API (`localhost:3001`, DB `hello_circle_dev`) |
| **[D]** DB-read | Read-only `SELECT` against `hello_circle_dev` (never `hello_circle`) |
| **[U]** unverified | Taken from existing documentation, or inferred, and not confirmed here |

No browser verification was performed in this session. No writes of any kind were sent to any environment.

---

## 1. Executive summary

HelloCircle is a pre-launch (v0.9.0) participation marketplace for Ireland: residents discover and join local activity
(community-centre room hire, sports-club registration, multi-week programmes, bookable experiences/adventures,
resident-hosted ad-hoc "activities" (called Games in code) and recurring Circles), while venues/clubs/operators
("vendors"/"partners") list and run their supply, and HelloCircle staff moderate and run commerce from an admin
workspace. It is a React + Vite SPA served by a single Express/TypeScript process on MySQL, with Stripe Checkout
for payments and an extensive (largely switched-off) commerce engine for ledgers, settlements, Connect payouts,
Pro subscriptions, credits and reward points.

**Overall state.** Feature breadth is very large (~75 client routes, ~60 Express routers, ~145 tables). The core
resident flows (browse → book/register/enrol/join → My Life) and vendor/admin operations are implemented end-to-end
in code. The advanced commerce layer is implemented but **almost entirely disabled by default** [C][D], and public
consumer surfaces are hidden behind a **launch gate** unless `VITE_LAUNCH_MODE=public`, with venue pages behind a
second gate (`VITE_VENUE_PAGES_PUBLIC`) [C]. In production, **paid checkout is closed by default** unless
`PAID_CHECKOUT=open` [C].

**Highest-priority findings** (full list §9):

1. **Commercial-rule edits only reach checkout for experiences, and only when two switches are on.** Centre, club,
   programme, game and pass checkout use hard-coded 23% VAT / 5% fee / €100 deposit (`server/src/pricing.ts`,
   `bookings.ts:55`), and the client duplicates the same constants (`client/src/api/public.ts:295`). The published
   `cancellation` and `checkout` rule keys are not read by any code; the real cancellation cut-off comes from
   `org_policies` and a hard-coded 48h/90d default (`db/queries.ts:510`). [C]
2. **Suspending a vendor does not hide or stop their listings.** Public reads and checkout only filter on listing
   `status='approved'`, not on the owner's account status (only passes check it). [C]
3. **Rejected listings are a dead end for vendors.** The publish endpoints only accept `draft`; there's no
   path from `rejected` back to `draft`/`pending` except an admin manually setting it. Admin rejection takes no reason
   and doesn't notify the vendor. [C]
4. **Admin sub-roles only gate commerce, finance, coupons, policies, complaints, traders, help and admin roles.**
   Any admin (including `legal`/`support`) can approve or suspend vendors, approve, reject or delete listings, change
   vendor staff roles and provider tiers, toggle org feature flags, edit notification templates and send demand
   notifications. Listing status changes, deletes and edits, claim decisions, review unhide, organisation create/assign
   and provider-tier changes **aren't audit-logged**. [C]
5. **No admin-side resident suspension exists.** Moderation can close a Circle or hide a review, but a resident
   account can't be suspended. Resident and vendor "deactivation" is self-service and reverses on the next sign-in. [C]
6. **Documentation drift is significant.** `docs/admin-and-vendor-reference.md` says programme routes have no
   staff-role guard. That's **wrong now**: `vendorPrograms.ts` uses `assertPlatformRole` on every write [C].
   `CLAUDE.md` says there's no CI (there is `.github/workflows/web-ci.yml`), that dev accepts unsigned webhooks (it now
   refuses them unless `ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true`), that CORS reflects any origin (now `PUBLIC_ORIGIN(S)`),
   and that `apps/mobile` exists (`apps/` is empty). See §2.4.
7. **Operational readiness gaps.** Monitoring and error tracking amount to `console.error` only. The rate limiter and
   the background sweeps run in memory in one process. Admin lists are paginated client-side and the audit log is
   capped at 200 rows. Settlement and transfers only run when triggered manually. [C]

**Checks run in this audit:** `tsc --noEmit` server ✅, client ✅; client Vitest 31 files / 266 tests ✅;
`npm run qa:check` (harness safety tests) 3 files / 97 tests ✅. **Not run:** server Vitest (needs Docker, which was
down), Playwright `qa:*` integration suites, `vite build`, any browser checks.

---

## 2. Current product architecture

### 2.1 Stack
| Layer | Implementation | Evidence |
|---|---|---|
| Client | React 18 + Vite + TypeScript SPA, React Router v6, route-level `lazy()` code splitting, Context-based state (`AuthContext`, `GuestContext`, `MyStuffContext`, `DashboardNavContext`, `ThemeContext`), hand-rolled styling (`theme.ts`, `index.css`, per-area CSS), Lucide icons, Capacitor hooks (`native.ts`) | `client/src/App.tsx`, `main.tsx` [C] |
| Shared packages | `packages/types` (client types re-export), `packages/design-tokens` | [C] |
| Server | Express + TypeScript (ESM, top-level await), ~60 routers mounted flat under `/api/*`, serves `client/dist` + SPA fallback (single origin) | `server/src/index.ts` [C] |
| Database | MySQL/MariaDB via `mysql2/promise` behind a better-sqlite3-style shim (`db.prepare().get/all/run`, `db.transaction`); schema created/migrated idempotently at boot (`initSchema()`, 263 `ensureColumn` calls, ~145 tables, no FKs, no down-migrations) | `server/src/db/index.ts` (3,928 lines) [C] |
| Payments | Stripe Checkout (all paid types), Stripe Billing (Pro), Stripe Connect Express + Accounts v2 thin events (payouts) | `checkoutService.ts`, `routes/stripeWebhook.ts`, `payments/connect.ts`, `commerce/subscriptions.ts` [C] |
| Auth providers | bcrypt passwords, magic links, Firebase (Google sign-in) | `auth.ts`, `guestAuth.ts`, `googleAuth.ts`, `firebaseApp.ts` [C] |
| Media | Local disk `/uploads` (Multer), R2 presigned uploads, Cloudinary editorial provider, local AVIF/sharp processing | `routes/uploads.ts`, `routes/media.ts`, `server/src/media/*` [C] |
| Maps / geocoding | Mapbox GL on the client (`VITE_MAPBOX_TOKEN`), with an admin `maps_enabled` kill switch; server geocoding proxy to OSM Nominatim (`GEOCODER_BASE_URL` override) | `client/src/mapbox.ts`, `routes/geocode.ts`, `routes/config.ts` [C] |
| Email / push | nodemailer SMTP with a console fallback; device push tokens (Firebase) | `email.ts`, `push.ts` [C] |
| Background work | In-process `setInterval`: waitlist-offer expiry sweep (15 min) and Pro subscription grace sweep (hourly). Nothing else is scheduled | `index.ts:107-110` [C] |
| CI | GitHub Actions `web-ci.yml`: `npm ci`, build, client tests, server tests | [C] |
| Deploy | One Node process per environment; prod and staging on one VPS behind nginx (`deploy/staging/*.template`); staging tester gate (`stagingGate.ts`) | [C], `DEPLOYMENT.md` gitignored [U] |

### 2.2 Request pipeline (order matters)
`cors` → **raw-body Stripe webhooks** (`/api/stripe/webhook`, `/api/stripe/webhook/v2`) → `express.json` →
`cookieParser` → optional staging gate → `attachUser` → `attachGuestEmail` → `attachResident` → `/uploads` static →
routers → `/robots.txt`, `/sitemap.xml`, `/.well-known/*`, `/mobile-verify`, OG-tag-injected SPA fallback. [C]

### 2.3 Environment switches that change product behaviour
| Switch | Where | Default | Effect |
|---|---|---|---|
| `VITE_LAUNCH_MODE=public` | client build + server (`robots`, sitemap) | **gated** | While gated, only partner pitch, auth, legal, `/vendor*`, `/admin`, `/profile`, `/bookings`, `/my-life`, `/manage*`, `/games/*`, `/circles/*`, `/host/*` and `/i/*` are reachable; everything else redirects to `/coming-soon`. `/` is `ForVenues` while gated and `Home` once public. |
| `VITE_VENUE_PAGES_PUBLIC=true` | client | off | Centre and club browse, detail, booking and registration routes stay on `/coming-soon` even after public launch. |
| `PAID_CHECKOUT=open/closed` | server (`commerce/releaseGates.ts`) | open outside production, **closed in production** | Paid bookings are refused with "Paid bookings aren't open yet". |
| `PARTNER_FEE_MODEL_STATUS` | **code constant** `"proposed"` | — | Blocks Pro purchase and rewards outside tests, whatever the switch says. |
| `commerce.*` switches | `app_settings` (admin → Commercial rules) | see §6 | Engine, ledger, Connect, Pro, credits, rewards, coupons v2, Open Booking, splits |
| `maps_enabled` | `app_settings` | true | `/api/config` → `mapsEnabled` [P: `true` on dev] |
| `STAGING_GATE_USERS_FILE` | server | unset | Branded tester login in front of the whole app (webhooks exempt) |
| `APP_ENV`, `NODE_ENV` | server | — | Live Stripe keys are refused outside production, and unsigned webhooks are never allowed in production or staging |

### 2.4 Documentation vs. code — conflicts found
| Document | Claim | Code reality |
|---|---|---|
| `docs/admin-and-vendor-reference.md` §3.4 | "`vendorPrograms.ts` has no `requirePlatformRole` guard; any staff can create/edit/delete programmes" | **Outdated.** Every write calls `assertPlatformRole` (centre_manager/facility_manager by listing type; refund → finance), and creation also checks the org `programs` flag (`vendorPrograms.ts:64,126,167,175,219,278,309,360`) [C] |
| `CLAUDE.md` "Known gaps" | "No CI" | `.github/workflows/web-ci.yml` runs build, client tests and server tests [C] |
| `CLAUDE.md` Architecture | "in dev, an unset secret just skips signature verification" | Unsigned events are refused unless `ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true`, and never in production/staging (`stripeWebhookPolicy.ts`) [C] |
| `CLAUDE.md` Deployment | "CORS is still `origin: true`" | Restricted to `PUBLIC_ORIGINS`/`PUBLIC_ORIGIN` when set; reflects origin only when unset (`index.ts:128-141`) [C] |
| `CLAUDE.md` Client | `packages/*` "shared with `apps/mobile`" | `apps/` is empty in this repo (a separate mobile repo is referenced in comments) [C] |
| `CLAUDE.md` Client | `api.ts` barrels "six domain modules" | Ten modules: core, public, resident, vendorAuth, vendor, admin, invitations, manage, media, sharing [C] |
| `docs/roles-and-flows.md` §1–2 | Residents are magic-link only, "No password, ever" | Residents also have password signup/login/reset (`guestAuth.ts:189,233,367,390`) and Google sign-in [C] |
| `docs/roles-and-flows.md` §7 | Vendor cancel is "status-only, no Stripe refund" | Provider cancellations auto-refund online-paid orders (`providerCancelRefund.ts`), used by bookings, registrations, programmes and experiences [C] |
| `docs/roles-and-flows.md` §7 | `client/src/pages/ManageActivities.tsx` | Removed; `/manage/activities` redirects to `/manage?tab=activities` [C] |
| `docs/roles-and-flows.md` §5 | "No messaging/inbox feature" | `chat_messages`/`chat_reads`, `/api/chat`, the `/chats` page and listing chats exist [C] |
| `docs/roles-and-flows.md` §2 | Circles are "not a social feed: no posts" | Circles now have polls, plan ideas, moments, recent activity and chat [C] |
| `docs/admin-and-vendor-reference.md` §2.3 | Known gaps list | Still accurate for audit-logging, client-side pagination, `/stats` using `CURDATE()`, and no maps toggle in the UI [C] |
| `docs/product/*` (24 files) | Older product spec set | Not re-verified line by line; treat as historical. **[U]** |

---

## 3. User and permission matrix

### 3.1 Identity systems (none share a table)
| Identity | Table / cookie | Sign-in methods | Status model | Evidence |
|---|---|---|---|---|
| Anonymous guest | none; `X-Client-Id` header (localStorage UUID) | none | — | `client/src/clientId.ts`, `util.ts clientIdFrom()` [C] |
| Resident | `residents`; `guest_sessions` cookie | Magic link, password (signup/login/reset), Google (Firebase); email verification step (`/me/resend-verification`) | `deactivated_at` (self-service, soft; reversed by signing in) | `routes/guestAuth.ts`, `residents.ts` [C] |
| Vendor / admin | `users` (`role` vendor/admin); `hello_circle_session` cookie (httpOnly, `sameSite=lax`, `secure` in production, 30 days, DB-backed `sessions`) | Password; Google **login only** (no signup, and no auto-link by email, since `PUT /auth/link-google` needs an authenticated session) | `status` pending/approved/suspended; `deactivated_at` (self-service, reversed on login) | `auth.ts`, `routes/auth.ts` [C] |
| Linked vendor ⇄ resident | `users.resident_id` | Link by emailed token (`/manage/link/request` → `/link/confirm`), or `/manage/become-provider` (verified host → new linked vendor) | Switch mints the other cookie without a password (`/manage/switch`), audit-logged | `routes/manage.ts` [C] |

### 3.2 Roles and what the server actually enforces
| Role | Gate | Can | Cannot / notes |
|---|---|---|---|
| Anonymous guest | — | Browse approved listings; book a centre and register for a club (owned by client id); quote, enrol and buy experiences; look up and cancel own bookings by ref + client id; leave a review only after a verified booking or registration | Games, Circles, passes, receipts and favourites all need a resident session [C] |
| Resident | `requireResident` | Everything above, plus household, favourites, follows, routines, search alerts, notifications, receipts, payment methods, credits (if enabled), passes, games (join/host), Circles (join/create/organise), invitations, chat, reports, complaints/appeals, data export, deactivation | Paid **hosting** needs `host_status='verified'` while `commerce.paid_games_require_verified_host` is on (default **on**) [C] |
| Resident host | resident + ownership of the game or Circle | `/manage` workspace: edit, cancel and lifecycle own games; remove, refund and check in participants; updates; waitlist offers; host coupons; earnings, insights and payout account (if Connect is on); split proposals (if splits are on); Circle organiser and co-organiser tools | Verified Host is a **badge** granted by admin approval of a host application [C] |
| Vendor — org owner (`invited_staff=0`) | `requireVendor` (status `approved`) + `attachVendorIds` | All org listings (any user in `org_id`), org profile and policies, staff invites, all tabs | Pending: dashboard shows "Awaiting approval", and every `/api/vendor/*` call returns 403. Suspended: login refused [C] |
| Vendor — invited staff | as above + `requirePlatformRole` / `assertPlatformRole` | `centre_manager`: centres, rooms, hours, blocks, centre bookings (cancel/resend/check-in), centre-side programmes and experiences. `facility_manager`: clubs, club registrations and waitlist offers, club-side programmes and experiences. `finance`: refunds, coupons, payments, earnings, CSV export, payouts, splits, plan, trader profile. `communications`: broadcast messages, review replies. `read_only_analyst`: CSV export, earnings and demand reads | **Ungated for any staff:** `POST /vendor/claims` (claim a listing), every GET (listing, booking and participant reads), `/vendor/participation/circles` GET. Org profile, policies and invites are owner-only (`org.ts`) [C] |
| Admin — `super` (or null `admin_role`) | `requireAdmin` | Everything, including `/admins` role management (can't demote self or the last super) | — [C] |
| Admin — `finance` | `requireAdminRole("finance")` | `/commerce/*`, `/finance/*`, `/coupons*` **plus all ungated admin routes** | — [C] |
| Admin — `support` | `requireAdminRole("support")` | `/complaints`, `/traders` **plus all ungated admin routes** | — [C] |
| Admin — `legal` | `requireAdminRole("legal")` | `/policies`, `/help`, `/traders` **plus all ungated admin routes** | — [C] |

**Ungated for every admin sub-role** (`routes/admin.ts`): stats, vendors (approve/suspend), host applications,
listings (approve/reject/delete/edit/feature), claims, reviews (unhide; hiding is `DELETE /api/reviews/:id` with
`requireAdmin`), organisations (create/flags/assign), vendor platform-role and provider-tier, demand and
demand-notify, marketplace health, recommendation weights, market categories, reports, audit, support search,
status, notification templates, place suggestions, maps toggle, and `/api/admin/media/*`. The client nav
(`components/admin/adminNav.ts`) matches this split. [C]

### 3.3 Organisation boundary
- "Your data" = rows whose `vendor_id` is any user in the caller's `org_id` (`orgVendorIds`, `auth.ts:301`). Every
  vendor gets a 1:1 org at signup or through the boot backfill. [C]
- Coupons a vendor creates apply only to listings in the creator's org (`pricing.ts listingInCreatorOrg`). [C]
- Per-org feature flags (`open_booking`, `programs`, `experiences`) are opt-out rows in `feature_flags` and are
  enforced on the server. [C]
- Admin "assign organisation" (`PUT /centres|clubs/:id/organisation`) and custom organisations are described in the
  UI as scaffolding with no effect on access; ownership still follows `vendor_id` → `users.org_id`. [C/U]
- An authorization Playwright suite exists (`tests/integration/specs/authorization-*.spec.ts`) but **was not run**. [U]

---

## 4. Route / page inventory

Status key: **Complete** (end-to-end in code), **Partial** (works with known gaps), **Gated** (reachable only under a
flag), **Scaffold**, **Unreachable** (no route). The "Gate" column is the launch-gate behaviour (L = blocked while
`VITE_LAUNCH_MODE` isn't `public`; V = also needs `VITE_VENUE_PAGES_PUBLIC`). All rows are [C] unless marked.
Loading/empty/error handling was found by scanning each page for spinner/skeleton/EmptyState/ErrorState/setError
usage; it was not exercised in a browser.

### 4.1 Public discovery and detail
| Route | Component | Purpose / user | Main API | Auth / gate | States | Status |
|---|---|---|---|---|---|---|
| `/` | `ForVenues` (gated) / `Home` (public) | Partner pitch / consumer home | discover, config | L-exempt | Home: no explicit empty/error found | Complete |
| `/home` | `Home` | Consumer home (alias) | `/api/discover`, `/api/next-steps` | L | — | Complete |
| `/explore` | `Explore` | Unified search + results mode, map | `/api/search`, `/api/discover` | L | Skeleton, EmptyState | Complete |
| `/search`, `/ask` | `SearchRedirect` | Legacy → `/explore?q=` | — | L | — | Redirect |
| `/browse/:category` | `Browse` | Centre/club browse + compare | `/api/centres`, `/api/clubs` | L+V | Skeleton, EmptyState | Complete (gated) |
| `/centres/:id` | `CentreDetail` | Venue detail, rooms, reviews | `/api/centres/:id`, reviews, availability | L+V | Skeleton | Complete (gated) |
| `/clubs/:id` | `ClubDetail` | Club detail, sessions, passes | `/api/clubs/:id`, club-sessions | L+V | Skeleton | Complete (gated) |
| `/programs`, `/programs/:id` | `Programs`, `ProgramDetail` | Programme browse/detail + enrol | `/api/programs*` | L | Spinner, error | Complete |
| `/experiences`, `/adventures`, `/volunteer` | `ExperienceKindBrowse` wrappers | Experience browse by kind | `/api/experiences` | L | (component) | Complete |
| `/experiences/:id`, `/adventures/:id` | `ExperienceDetail` | Departure picker, quote, checkout | `/api/experiences/:id`, `/sessions/:sid/quote|checkout` | L | Spinner, error | Complete |
| `/games` | `Games` | Activities feed (games), filters | `/api/games` | L | Skeleton, Empty, Error | Complete |
| `/games/:id` | `GameDetail` | Activity detail, join/waitlist/pay | `/api/games/:id`, `/quote`, `/join` | L-exempt | Spinner | Complete |
| `/circles` | `Circles` | Circle discovery | `/api/circles`, `/suggestions` | L | (no empty found) | Complete |
| `/circles/:id` | `CircleDetail` | Circle page: join, plans, polls, moments, chat | `/api/circles/:id/*` | L-exempt | Spinner, Empty | Complete |
| `/provider/:id` | `ProviderProfile` | Public vendor profile | `/api/providers/:id` | L | Spinner, NotFound | Complete |
| `/host/:id` | `HostProfile` | Public host profile | `/api/residents/:id/host-profile` | L-exempt | Spinner, Empty, NotFound | Complete |
| `/:county/:activity` | `LocalActivity` | Local SEO landing | `/api/discover` (public) | L | Skeleton, Empty | Complete |
| `/free-time` | `FreeTimeMode` | "I have N hours" suggestions | discover | L | Spinner, Empty, error | Complete |
| `/compare` | → `/browse/centres` | Legacy | — | — | — | Redirect |

### 4.2 Transactions and confirmation
| Route | Component | Purpose | API | Auth | Status |
|---|---|---|---|---|---|
| `/book/:centreId` | `BookingFlow` | Room → date/slot → details → pay (or cash/free) | `/api/bookings/quote|checkout|status`, availability | Guest or resident (L+V) | Complete; paid path closed in prod by `PAID_CHECKOUT` |
| `/register/:clubId` | `RegistrationFlow` | Club registration (child/household) | `/api/registrations/quote|checkout` | Guest or resident (L+V) | Complete |
| `/payment/success`, `/payment/cancel` | `PaymentSuccess`, `PaymentCancel` | Post-Stripe landing; polls status; abandon releases hold | `/status/:ref`, `/api/checkout/:ref/abandon` | — | Complete |
| `/make-it-happen` | `MakeItHappen` | Open Booking cost-sharing | `/api/make-it-happen` | Resident (L) | **Gated off**: 503 while `commerce.open_booking` is off (default) |
| `/suggest-place` | `SuggestPlacePage` | Suggest a missing place | `/api/place-suggestions` | L | Complete |
| `/i/:token` | `InvitationLanding` | Personal invitation | `/api/invitations/token/:t` | L-exempt; sign-in prompt | Complete |
| `/dev/booking-kit` | `BookingKitPreview` | Booking UI kit preview | — | Dev builds only | Internal |

### 4.3 Resident account ("My Life")
| Route | Component | Purpose | API | Status |
|---|---|---|---|---|
| `/bookings`, `/my-life` | `MyBookings` | Next up, needs-you, waiting-for, history across all 5 participation types; magic-link token landing; `?setup=1` onboarding | `/api/residents/me/participation`, `/needs-attention`, bookings/registrations lookups | Complete; guest view uses client id only |
| `/profile` | `Profile` | Tabbed settings: details, interests, privacy, payment methods, credit (switch), household, saved, following, routines, passes, receipts, notifications, hosting/become a host, safety, help | `/api/residents/me/*`, `/api/household`, `/api/favourites`, `/api/credits/me` | Complete (`?tab=` read on load) |
| `/chats` | `Chats` | Chat inbox (resident or vendor) | `/api/chat/mine` | Complete |
| `/onboarding` | → `/bookings?setup=1` | Legacy | — | Redirect |

### 4.4 Creation and hosting (resident)
| Route | Component | Purpose | API | Status |
|---|---|---|---|---|
| `/games/host`, `/games/host/:gameId` | `HostGamePage` | Create/edit an activity (optionally on a paid venue booking) | `POST/PUT /api/games`, `/host/venue-bookings` | Complete; price requires verified host (switch on) |
| `/circles/start` | `StartCirclePage` | Create a Circle | `POST /api/circles` | Complete |
| `/become-a-host` | `BecomeAHost` | Host pitch → application | `/api/residents/me/host-application` | Complete |
| `/manage` | `ManageHome` | Host workspace tabs: overview, activities, circles, calendar, insights, earnings, reviews, offers. Vendor/admin sessions are redirected to `/vendor` | `/api/games/host/*`, `/api/manage/workspaces`, `/api/host/*` | Complete; tab from URL on load only |
| `/manage/circles/:id` | `ManageCircle` | Organiser: overview, plans, members, settings | `/api/circles/:id/*` | Complete |
| `/manage/pro`, `/manage/rewards` | `ProDetailsPage`, `RewardsHistoryPage` (host scope) | Pro plan / reward history | `/api/host/plan` | **Gated**: shows "Pro isn't available" while the switch is off; no sign-in redirect (shows an error state) |
| `/manage/activities` | → `/manage?tab=activities` | Legacy | — | Redirect |

### 4.5 Partner (vendor) workspace
| Route | Component | Purpose | Status |
|---|---|---|---|
| `/for-venues`, `/partners`, `/pricing` | `ForVenues`, `Pricing` | Partner marketing + public plans (`/api/pricing/*`) | Complete |
| `/vendor/signup` | `VendorSignup` | Account + org + first listing (centre or club) in one transaction; no session issued | Complete |
| `/vendor` | `VendorDashboard` (`ManageShell`) | Tabs: overview, listings, programs, experiences, schedule, messages, bookings, earnings, reviews, offers, demand, org. Staff see only the tabs their role allows (`vendorTabAccess.ts`). Tab read from `?tab=` on first load only | Complete / Partial (older shell, no URL sync) |
| `/vendor/centres/:id` | `VendorCentreEditPage` | General, location, contact, amenities, accessibility, rooms, hours, blocks, participation | Complete |
| `/vendor/clubs/:id` | `VendorClubEditPage` | General, pricing, sessions, includes, photos, waitlist | Complete |
| `/vendor/programs/:id` | `VendorProgramEditPage` | Programme, sessions, enrolments, attendance | Complete |
| `/vendor/experiences/:id` | `VendorExperienceEditPage` | Experience, departures, bookings | Complete |
| `/vendor/pro`, `/vendor/rewards` | Pro / rewards (vendor scope, `finance` role) | **Gated** (switch off + fee model "proposed") |
| `/accept-invite` | `AcceptInvite` | Staff invitation → set password → staff account | Complete |
| `/manage/link-confirm` | `ManageLinkConfirm` | Confirm vendor ⇄ resident link | Complete |

### 4.6 Admin
`/admin` → `AdminDashboard` → `components/admin/AdminShell` with URL-synced `?tab=` (and `&section=` for finance).
Tabs: overview, pending, support, listings, vendors, claims, hostApplications, placeSuggestions, organisations,
demand, marketplaceHealth, coupons*, commerce*, finance* (*finance role), reviews, policies (legal/support), audit,
notificationTemplates, media, settings. A non-admin session is redirected to login with a nested `returnTo`
(documented gap). Full per-tool table: `docs/admin-and-vendor-reference.md` §2.2, which is accurate for this tab set.
[C]

### 4.7 Auth, legal, trust, support, errors
| Route | Component | Notes |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password` | `Login`, `ForgotPassword`, `ResetPassword` | Vendor/admin password, Google login; `AuthEditorialShell` (no header/footer) |
| `/signin`, `/signin/create`, `/signin/email-link` | `SignIn`, `SignUp`, `EmailLinkSignIn` | Resident magic link, password and Google; `safeReturnTo()` (`authRedirect.ts`, unit-tested [T]) |
| `/privacy`, `/cookies` | CMS policy (`/api/policies`) with static fallback | Cookie choices control on `/cookies` |
| `/policies`, `/policies/:key` | `PolicyIndex`, `PolicyPage` | Versioned CMS documents |
| `/about`, `/contact`, `/complaints` | static / `Complaints` (complaint, notice, appeal) | Company identity placeholders pending (see §11) |
| `/help-guide/*` (5 routes) | help-guide pages | Static |
| `/coming-soon` | `ComingSoon` | Launch-gate splash, launch signups |
| `*` | `NotFound` | 404 |
| Global overlays | `AccountSetupGate`, `PolicyAcceptanceGate`, `CookieNotice`, `SessionExpiryBanner`, `AppUpdateBoundary` (chunk reload) | |

### 4.8 Unreachable / orphaned
- `pages/CommercePreview.tsx`: no route. `pages/AskHelloCircle.tsx`: no route (folded into Explore). [C]
- `App.tsx` still checks `isStandaloneLanding` for `/landing`, but `/landing` now redirects to `/`, so that branch is dead. [C]
- Repo root `undefined/` folder (4 screenshots from 2026-10-12) is an artefact of a path variable that was undefined. [C]

---

## 5. Workflows and state transitions

### 5.1 Customer signup / login [C]
Anonymous (client id) → **resident** via magic link (`/guest/request-link` → `/verify` → optional `/verify/complete` for
new accounts), password signup (`/guest/signup` + email verification), or Google (`/guest/google` → `/google/complete`).
A session cookie is issued, and `findOrCreateResident` keys on the verified email. The `AccountSetupGate` popup runs
onboarding. **Gap:** bookings made as a guest before sign-in aren't linked retroactively (by design, open question §11).

### 5.2 Vendor → organisation → account approval → listing approval [C]
`/vendor/signup` (one transaction: `users` pending + organisation + listing) → no session → admin **Vendors**: approve
(email sent once per real transition, audited) → vendor logs in, finishes the listing (`draft`) → `POST
/vendor/<type>/:id/publish` (draft → `pending`, required fields checked) → admin **Pending approvals**: approve (409
unless the vendor is approved; followers notified; experiences also run demand matching) or reject.

Listing state machine: `draft → pending → approved ⇄ paused`; `pending → rejected`; admin can set
`pending|approved|rejected|deleted`.

**Gaps:**
- `rejected` → nothing (vendor can't edit-and-resubmit; publish requires `draft`).
- Rejection takes no reason and doesn't notify the vendor.
- Edits to an approved listing go live **without re-review**.
- Admin listing status changes aren't audited.

### 5.3 Staff invitation and role assignment [C]
Owner → `POST /vendor/org/staff/invite` (email + one of five roles) → token email → `/accept-invite` (GET
`/api/invites/:token`, POST `/api/auth/accept-invite` creates a `users` row in the org, `invited_staff=1`). Owner can
revoke pending invites. Admins can change a vendor's `platform_role` (audited). **Gap:** no owner-side "change or remove
existing staff member" endpoint was found in `org.ts` (only invite and revoke-pending). **[C, needs product confirmation]**

### 5.4 Listings, rooms, hours, blocks, availability [C]
Centres: rooms are created and edited, never deleted (`active=0`), with ≥1 active room enforced; `centres.capacity`
and `from_price` are rolled up from rooms. Opening hours are per centre (`centre_hours`), not per room. Blocks are
per room or per centre. Availability: `/api/availability`. Claims: vendor `POST /vendor/claims` on an unowned
(`vendor_id IS NULL`) listing → admin approve (needs approved vendor) or reject (not audited).

### 5.5 Clubs, sessions, programmes, enrolment, waitlists, attendance [C]
Clubs have recurring `club_sessions`; registration is per club (with session-level capacity locks, per
`registrations.test.ts`). Programmes go `draft|published|paused|archived` (delete = archive) with sessions,
enrolments (`program_enrollments`), attendance (`present|absent|late|cancelled|no_show`) and a check-in kiosk.
Waitlists (`waitlist_entries`): an offer has a 48h window, swept every 15 min to promote the next person. Vendor can
manually offer a club waitlist place.

### 5.6 Experiences [C]
Vendor creates an experience (draft → publish → pending → admin approve) → departures (`experience_sessions`) →
customer quote (`/sessions/:sid/quote`) → checkout (legacy pricing unless the engine switches are on) → webhook
confirms. Customer self-cancel is allowed up to the org `cancellationHours`; an online-paid cancellation stays `paid`
with refund "pending" until the provider refunds (Refund Policy A, `selfCancel.ts`). Vendor cancel of a booking or
departure auto-refunds online payments once (`refundOnProviderCancel`); failures are left "refund pending" and
audited. Attendance can be marked attended/no-show.

### 5.7 Resident hosting, games and Circles [C]
**Game** (UI: "activity"): create (free, or paid if the host is verified) → optional `centreId` + `bookingRef` (must be
the host's own paid, non-cancelled future booking, `venueBookingProblem`) → lifecycle (`publish_at`,
`booking_open/close`, min participants + confirmation deadline) → join (row-locked capacity; paid → Stripe) → waitlist
→ check-in / confirm attendance → updates → cancel (host) / leave (participant) → host refund per participant.

**Circle:** create → join (open, or request/approve) → organiser/co-organiser roles (promote/demote) → invites →
plan ideas → polls → confirm plan (creates a linked game) → status changes (close) → moderation via reports.

### 5.8 Venue booking by a host [C]
Customer cancellation of a booking that a non-cancelled activity is held on is **blocked (409)** with a pointer to the
activity. Vendor cancellation **cancels the linked activities** and audits `game.cancelled_with_venue_booking`. This
appears to resolve the "no booking→game cascade" P0 in `docs/booking-checkout-audit-2026-10-11.md`. [C; not
re-run end-to-end]

### 5.9 Payments → confirmation → ledger → settlement → payout [C]
Checkout creates a pending row and a Stripe session with metadata `{type, ref}` (`checkoutService.ts`). The webhook is
signature-verified, stored once in `webhook_events` (duplicates acknowledged without reprocessing; in-flight → 409;
failures retried, then parked for review) → `confirm*` flips `pending→paid` idempotently (a late payment for an
expired/cancelled hold becomes `paid`+`cancelled`, which is the "refund required" state) → `afterPaid` records
`payment_records` and, if `commerce.settlement_ledger` is on, ledger postings. Settlements (`POST
/admin/finance/settlements/run`) and transfers (`/transfers/run`) are **manual admin actions** and only meaningful with
the ledger and Connect switches on (both off by default). Hosts and vendors onboard Connect Express from Earnings when
`commerce.connect_v1` is on.

### 5.10 Subscriptions, offers, credits, rewards [C]
- **Pro:** Stripe Billing checkout (`metadata.type='subscription'`), status in `partner_subscriptions`, hourly grace
  sweep. Blocked unless the switch is on **and** the fee model is approved (a code constant).
- **Offers:** partner-funded vendor coupons (finance role), host coupons, admin platform/split coupons (reason
  required, audited).
- **Credits:** HelloCircle-funded grants by finance; redeemable only in engine-priced (experience) checkout.
- **Reward points:** earned on settlement, redeemed for a free Pro month.

### 5.11 Reports, complaints, appeals, moderation [C]
Resident `POST /api/reports` (listing, review, circle, chat message, …) → admin case panel → `dismissed|actioned|
suspended` (suspended closes a Circle or hides a review), audited. `/complaints` accepts complaint/notice/appeal
(email required, 20–5000 chars). An appeal can reference a decided report. The support-role queue in admin records a
decision and statement of reasons, which the submitter sees via `/complaints/mine`.

### 5.12 Suspension, reinstatement, deactivation [C]
- **Vendor suspend/reinstate:** admin `PUT /vendors/:id/status` (audited, **no reason required**, no email on
  suspend). Login is refused and existing sessions fail `requireVendor` (403), but **public listings remain live and
  bookable**.
- **Residents:** no admin suspension; only self-deactivation (soft, reversed by the next sign-in). Account deletion is
  not implemented (tracked as sitemap audit P1-01).
- **Vendors:** self-deactivation is soft and reversed on login.

---

## 6. Commerce rules and feature-status matrix

### 6.1 Rules that are live today (default configuration)
| Rule | Value / behaviour | Source |
|---|---|---|
| Customer platform fee | **5%** of (subtotal − discount), added on top; vendor receives full listed price | `pricing.ts` constant `PLATFORM_FEE_RATE` [C] |
| VAT | **23%** of (subtotal − discount), added on top; not applied to the deposit; the platform fee itself isn't VAT'd in the legacy calculation | `pricing.ts` `VAT_RATE` [C] |
| Venue deposit | **€100** for online (non-cash) room bookings | `bookings.ts:55` `DEPOSIT_CENTS` [C] |
| Client-side display | Same 23%/5% constants duplicated | `client/src/api/public.ts:295-296` [C] |
| Coupons | percent (1–100) or fixed; start/expiry; max uses; min spend; listing-scoped (vendor) or org-scoped; resident (host) codes only on their own listing; server-computed discount | `pricing.ts evaluateCoupon` [C] |
| Discount funding | `funding`: `partner` / `platform` / `split` (`platform_share_bps`); admin codes may be platform or split, vendor codes are partner-funded | `admin.ts`, `vendorOperations.ts` [C] |
| Cancellation cut-off | Org `org_policies.cancellation_hours`, else **48h**; booking window org value, else **90 days** | `db/queries.ts:510` [C] |
| Refunds | Customer self-cancel of online-paid → refund pending until the provider refunds. Provider cancel → automatic full refund once (idempotent, row-locked). Finance/admin refunds via `refundPaidOnce` | `selfCancel.ts`, `providerCancelRefund.ts` [C] |
| Pending capacity hold | `PENDING_HOLD_MINUTES` constant (Stripe session expiry) | `bookingIntegrity.ts` [C] |
| Paid hosting | Verified hosts only (switch default **on**) | `games.ts:108` [C] |
| Open Booking split | `ceil(total / (openSpots+1))` per joiner; separate charge, no rebate to the booker | `pricing.ts splitCostPerPerson`, **switched off** [C] |

### 6.2 Commerce engine and switches
Rule versions (`commerce_rule_versions`): draft → approve → publish, scoped global/scenario/category/partner, effective
dates, never retroactive. Dev DB has one published v1 per rule key (18 keys) [D].

| Switch (`app_settings`) | Default | Dev DB value | Status |
|---|---|---|---|
| `commerce.paid_games_require_verified_host` | **on** | default [D] | Implemented & enabled |
| `commerce.require_second_approver` | off | default | Implemented, disabled (one finance admin can draft, approve **and** publish) |
| `commerce.shadow_pricing` | off | default | Implemented, disabled |
| `commerce.engine_v2` + `engine_v2_experience` | off | default | Implemented for **experiences only**; every other type returns false in `engineEnabledFor` |
| `commerce.coupons_v2` | off | default | Implemented, disabled (redemption ledger, per-customer limits) |
| `commerce.settlement_ledger` | off | default | Implemented, disabled |
| `commerce.connect_v1` | off | default | Implemented, disabled |
| `commerce.circle_credits` (partner reward points) | off | default | Implemented; **also blocked by fee model "proposed"** |
| `commerce.pro_subscriptions` | off | default | Implemented; **also blocked by fee model "proposed"** |
| `commerce.customer_credits` | off | default | Implemented, disabled; only usable in engine checkout |
| `commerce.open_booking` | off | default ("Not launch-ready — keep off") | Implemented, disabled; `/make-it-happen` returns 503 |
| `commerce.venue_host_split_payout` | off | default | Implemented, disabled |
| `commerce.boost_vouchers` | off | default | **Documented only**: "nothing reads this switch until Phase 7" |

_Production and staging switch values were **not** inspected [U]._

### 6.3 Published rule keys that have no effect on behaviour
| Rule key | Read by code? | Consequence |
|---|---|---|
| `pricing` (fee/VAT/deposit/day rate) | Only by the engine (experiences, switched off) and the shadow pricer | Editing it changes nothing for centres, clubs, programmes, games or passes |
| `cancellation` (48h/90d) | **No** | Real values come from `org_policies` and a hard-coded default |
| `checkout.pendingHoldMinutes` | **No** | Real value is the `PENDING_HOLD_MINUTES` constant |
| `entitlements_free/pro` | Not confirmed; no reads found for the rule key in the grep | [U] |
| `plan_*`, `tax_vat`, `payment_costs`, `settlement`, `venue_split`, `rewards`, `credits`, `split_rewards`, `vat_treatment`, `availability`, `subscription_policy` | Yes (finance/settlement/Pro paths) | Effective only when the relevant switch is on |

### 6.4 Webhook safeguards [C]
- Signature is verified with the platform secret, then the Connect secret.
- Unsigned events are refused unless explicitly allowed locally.
- Live keys are refused outside production.
- Dedupe happens through `webhook_events` (`beginEvent`: duplicate / busy / process), with retries, then parking for
  review. Admin can replay from Finance → Payment events.
- **Gap:** confirmation trusts metadata `{type, ref}` and doesn't compare `amount_total` or the session id with the
  stored row before flipping to `paid`. The recorded amount comes from Stripe. A server-created session is the only
  source of that metadata, so this is a hardening item, not a known exploit.

### 6.5 Not to be inferred
The code labels the VAT treatment `provisional_pending_irish_tax_review`, and Stripe Tax isn't used. No legal or tax
compliance can be inferred from this code.

---

## 7. Data model and integration summary

### 7.1 Core entities (selected from ~145 tables, `db/index.ts`) [C]
| Domain | Tables |
|---|---|
| Identity | `users`, `sessions`, `password_reset_tokens`, `residents`, `guest_sessions`, `guest_login_tokens`, `resident_signup_tokens`, `resident_password_reset_tokens`, `manage_link_tokens`, `household_members`, `blocked_residents`, `device_push_tokens`, `consent_records` |
| Organisations | `organisations`, `org_invites`, `org_policies`, `feature_flags`, `trader_profiles` |
| Supply | `centres` (+`centre_amenities`, `centre_images`, `centre_hours`), `rooms`, `room_blocks`, `clubs` (+`club_includes`, `club_images`, `club_sessions`), `programs`, `program_sessions`, `experiences` (+`experience_images`, `experience_sessions`), `listing_attributes`, `listing_claims`, `place_suggestions`, `media_assets` |
| Participation (5 parallel models + experiences) | `bookings`, `registrations`, `program_enrollments`, `experience_bookings` (+`experience_booking_participants`), `game_participants`, `circle_members`; plus `passes`, `waitlist_entries`, `attendance` |
| Community | `games`, `game_updates`, `circles`, `circle_invites`, `circle_polls*`, `circle_plans`, `routines`, `invitations`, `chat_messages`, `chat_reads`, `follows`, `favourites`, `participation_intents`, `intent_cluster_notifications`, `search_alerts`, `search_misses`, `notify_me_subscriptions`, `referrals` |
| Trust | `reviews`, `reports`, `complaints`, `activity_feedback`, `audit_log`, `policy_documents/versions/values/acceptances`, `help_entries` |
| Messaging | `notifications` (vendor/admin `recipient_id` + resident `resident_id`), `vendor_messages`, `notification_templates` |
| Commerce | `coupons`, `coupon_redemptions`, `commerce_rule_versions`, `commerce_quotes/orders/order_lines`, `pricing_snapshots`, `commerce_shadow_diffs`, `pricing_plans`, `partner_plan_assignments`, `partner_subscriptions`, `promotion_*`, `webhook_events`, `payment_records`, `refunds`, `disputes`, `ledger_accounts/entry_groups/entries`, `order_completions`, `settlement_runs/settlements/settlement_items`, `fee_reconciliations`, `connected_accounts*`, `transfers`, `transfer_reversals`, `transfer_allocations*`, `connected_payouts`, `partner_debts`, `reward_*`, `credit_lots/uses`, `venue_split_agreements`, `allocation_snapshots/lines`, `order_party_releases`, `dispute_recovery_allocations`, `order_acknowledgements` |
| Config / ops | `app_settings`, `market_categories`, `analytics_events`, `launch_signups` |

Relationships are enforced only in application code (no FKs). Polymorphic `listing_type`/`listing_id` pairs appear in
reviews, favourites, passes, notifications, reports and waitlists.

### 7.2 Integrations (configuration presence only; values not read)
| Integration | Env var names present in `server/.env` (dev) | Status |
|---|---|---|
| MySQL | `DB_HOST/PORT/USER/PASSWORD/NAME` | dev DB `hello_circle_dev` reachable [P/D] |
| SMTP | `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM` | present (whether real or console fallback not checked) |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Connect and v2 secrets not in dev `.env`) | present; `/api/config` reports `paidCheckoutOpen: true` on dev [P] |
| Firebase (Google sign-in, push) | `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`; client `VITE_FIREBASE_*` | present |
| Cloudinary | `CLOUDINARY_*`, `CLOUDINARY_UPLOADS_ENABLED`, `MEDIA_PROVIDER` | present |
| R2 | read by `server/src/media/config.ts` (`R2_*`) | not in dev `.env` |
| Mapbox | `VITE_MAPBOX_TOKEN` (client) | present |
| Geocoding | Nominatim default, `GEOCODER_BASE_URL` override | default |
| Analytics | GTM/consent client modules; server `analytics_events` | present |
| Mobile | Capacitor hooks, `/.well-known/*` (Apple `TEAMID` placeholder still in code), `/mobile-verify` relay | Partial (Apple Team ID TODO) |

Memory notes say R2, Firebase and GitHub credentials were once exposed and rotation was deferred. That isn't
verifiable from code. **[U] — see open questions.**

---

## 8. UX and design-system findings

| Area | Finding | Evidence |
|---|---|---|
| Shells | Four shells coexist. **Consumer** (Header + MobileTabBar + Footer). **Auth** (`AuthEditorialShell`, no chrome). **`ManageShell`** (rounded, green accents) for `/vendor`, `/manage`, `/manage/circles/:id` and parts of `/profile`. **Admin cream workspace** (`components/admin/AdminShell`, `admin.css`: cream `#F7F4EC`, 0–2px radius, Inter body, Bricolage headings, collapsible sidebar, no footer) | [C] |
| Cream workspace | Implemented **only on `/admin`** (uncommitted). Vendor and host workspaces still use the older `ManageShell` and per-tab ad-hoc states. Older admin tools (`AdminFinance`, `AdminCommerce`, `AdminPolicy`, `AdminMedia`) render inside the new shell but keep their own internal styling | [C] |
| Tabs / deep links | Admin: `?tab=` is fully URL-synced (Back/Forward work). Vendor, Manage, ManageCircle and Profile read `?tab=` **on first load only**, so Back leaves the page | [C] |
| Navigation | Single source in `navigation/navConfig.ts`. "Activities" (UI) = `games` (code). Venue menu items are hidden unless venue pages are public. The header account menu has the Personal ⇄ business switcher | [C] |
| Typography / colour | Consumer body font Figtree (per memory), admin-only Inter; primary green on consumer and vendor vs. orange `#FF4B24` accent in admin; tokens in `theme.ts` + `packages/design-tokens`, with frequent inline pixel values | [C/U] |
| Components | `ui.tsx` (Button, Card, EmptyState, ConfirmDialog, Drawer, NavSidebar, …), `ListingCard`, `CtaBand`, booking kit (`components/booking/*`), `admin/adminUi.tsx`. Two parallel primitive sets now exist (`ui.tsx` vs `adminUi.tsx`) | [C] |
| Lists | Admin lists: search, filters and client-side pagination of fully loaded data. Server pagination exists only for games, circles and residents routes (`pagination.js`). Vendor bookings and orders are fully loaded | [C] |
| States | Most pages have loading, empty and error states (§4). `Home` and `Circles` showed no explicit empty or error component in the scan. Pro and rewards pages show an error instead of a sign-in prompt when signed out | [C] |
| Accessibility | Skip link, `role="alert"` usage, an accessibility-prefs profile tab, and Playwright a11y specs (`product-a11y-*`, **not run**) | [C/U] |
| Responsive | Mobile bottom tab bar (hidden on `/vendor`, `/admin`, `/manage`); admin "Sections" sheet ≤1024px; `index.css` breakpoint utilities | [C]; browser screenshots exist in `docs/admin-redesign-2026-10-14/` from an earlier session [U] |
| Transitions | Personal → business uses the header switcher (`/manage/switch`). Public → workspace: vendor/admin land on `/login` (no chrome) and then `/vendor`/`/admin`; a vendor visiting `/manage` is redirected to `/vendor` | [C] |
| Feedback | Toasts and confirm dialogs: admin uses them consistently. Elsewhere it's per-component | [C] |

---

## 9. Prioritised issues

Severity: **P0** blocks a reliable or paid launch or risks money/trust; **P1** is a significant correctness, security or
ops gap; **P2** is an important product or UX gap; **P3** is hygiene. "Next action" is a recommendation, not something
implemented here.

| # | Sev | Issue | Evidence | Impact | Recommended next action |
|---|---|---|---|---|---|
| 1 | P0 | Commercial rules don't govern most checkouts: hard-coded VAT 23%, fee 5% and €100 deposit in `pricing.ts`/`bookings.ts`, duplicated on the client; the engine is only wired for experiences (and is off) | `pricing.ts:5-8`, `bookings.ts:55`, `client/src/api/public.ts:295`, `commerce/engine.ts:64` [C] | Finance can "publish" fee/VAT changes that customers never see; the admin UI implies control it doesn't have | Decide whether `pricing` rules are authoritative. Until then, label legacy paths in the Commercial rules UI as "not applied" |
| 2 | P0 | `cancellation` and `checkout` rule keys are published but never read | grep: no reads outside `catalog.ts` [C] | Misleading admin control; real policy lives in `org_policies` and constants | Wire them up or remove them from the catalogue; document the real source |
| 3 | P1 | Suspended vendor's listings stay public and bookable | `db/queries.ts` listCentres/getCentre filter only `status='approved'`; only `passes.ts:51` checks vendor status [C] | Customers can book a provider HelloCircle has suspended | Product decision (open question §11), then filter on owner status or bulk-pause on suspend |
| 4 | P1 | Admin sub-role scope: every admin can approve or suspend vendors, approve, reject or delete listings, change staff roles and tiers, toggle org flags, send demand notifications | `admin.ts` routes without `requireAdminRole` [C] | `legal`/`support` admins hold marketplace-moderation power; least privilege isn't met | Define a role → tool matrix and add `requireAdminRole` on server routes |
| 5 | P1 | Admin actions missing from the audit log: listing status/edit/delete, claims, review unhide, org create/assign, provider tier | awk scan of `admin.ts` [C] | No accountability trail for the most consequential moderation actions | Add `writeAudit` (with reason) to these handlers |
| 6 | P1 | No admin-side resident suspension or ban; deactivation is self-reversing; account deletion not implemented | `residents.ts:556`, report `suspended` only closes a Circle or hides a review [C] | No way to remove an abusive resident | Specify a resident enforcement model (suspend, appeal) and deletion (P1-01) |
| 7 | P1 | Vendor suspension needs no reason and sends no notice; listing rejection has neither a reason nor a notice | `admin.ts:140-172, 280-322` [C] | Weak due process (and the DSA statement-of-reasons pattern used for reports isn't applied here) | Require a reason, notify, audit |
| 8 | P1 | Rejected listing dead end: publish only accepts `draft` | `vendorListings.ts:313,710`, `vendorExperiences.ts:339` [C] | Vendor can't fix and resubmit | Add a rejected → draft (or resubmit) transition |
| 9 | P1 | Edits to approved listings go live without review | no status change in `PUT /vendor/centres|clubs/:id` [C] | Content moderation bypass after first approval | Product decision: re-review for material fields, or post-hoc review |
| 10 | P1 | Ops: no error tracking or monitoring, in-memory rate limiter and sweeps, manual settlement/transfer runs, single instance | `index.ts`, `rateLimit.ts`, no Sentry/pino [C] | Silent failures and lost limiter state on restart; can't scale horizontally | Add error reporting and an uptime check; plan a shared store before multi-instance |
| 11 | P1 | Server test suite not runnable without Docker; not run in this audit | `server/TESTING.md` [C] | Payment and concurrency regressions unverified here | Run `npm run test --workspace server` with Docker, then the `qa:*` suites on an isolated profile |
| 12 | P2 | Invited staff can file listing claims (no role check); owner can't change or remove an existing staff member (only invite and revoke pending) | `vendorListings.ts:102`, `org.ts` [C] | Staff overreach; no off-boarding path in the product | Gate claims to owner/managers; add staff management |
| 13 | P2 | Webhook confirmation doesn't reconcile `amount_total` or session id against the row | `stripeWebhook.ts:546-560, 615-637` [C] | Hardening only; an amount mismatch would be recorded silently | Compare and flag mismatches for review |
| 14 | P2 | Single finance admin can draft, approve and publish rules (`require_second_approver` off) | `catalog.ts`, `rules.ts:195` [C] | Four-eyes control absent | Turn on before go-live, if two finance admins exist |
| 15 | P2 | Workspace tabs not URL-synced (vendor, manage, profile) | `VendorDashboard.tsx:74-76`, `ManageHome.tsx:70` [C] | Back/Forward and shared links break | Reuse the admin URL-sync pattern |
| 16 | P2 | Design-system split: cream admin vs. `ManageShell` vendor/host; two primitive libraries | §8 [C] | Inconsistent partner experience | Plan the vendor shell migration (already the reference doc's #1) |
| 17 | P2 | Client-side pagination for admin and vendor lists; audit log capped at 200 | `admin.ts:897-904` [C] | Degrades with data growth; audit history is unreachable past 200 | Server-side pagination + filters |
| 18 | P2 | `/stats` "bookings today" uses MySQL `CURDATE()` and counts only bookings + registrations | `admin.ts:76` [C] | Metric definition is wrong around midnight Ireland time and excludes other types | Use `irelandTime`; define the metric |
| 19 | P2 | Documentation drift (§2.4) | [C] | Other agents and devs act on wrong facts (e.g. the "programmes unguarded" claim) | Update `CLAUDE.md`, `roles-and-flows.md`, and the reference doc §3.4 |
| 20 | P3 | Orphans: `CommercePreview.tsx`, `AskHelloCircle.tsx`, the dead `/landing` branch, the root `undefined/` folder; Apple `TEAMID` placeholder | §4.8, `index.ts` [C] | Noise; Universal Links won't work on iOS | Clean up when convenient |

> **Correction to finding 3 above (2026-10-14):** the "bookable" part was wrong when written. New checkout has been refused for a suspended partner
> user's listings since commit `f3953b6` (`vendorSuspended()` in bookings, registrations, programmes, experiences and
> passes). The listings do stay visible, and the check is per user, not per organisation. See D-01 in
> `hellocircle-operating-decisions.md`.

---

## 10. Test results and limitations

| Check | Command | Result |
|---|---|---|
| Server type-check | `npx tsc --noEmit -p server` | ✅ exit 0, no output [T] |
| Client type-check | `npx tsc --noEmit -p client` | ✅ exit 0, no output [T] |
| Client unit tests | `npm run test --workspace client` | ✅ 31 files, 266 tests passed [T] |
| QA harness safety tests | `npm run qa:check` | ✅ 3 files, 97 tests passed, plus `tsc` on `tests/` [T] |
| Server unit/integration tests (83 files) | `npm run test --workspace server` | ❌ **Not run**: Docker daemon not running (the suite needs a disposable MySQL container) |
| Playwright integration (~130 specs under `tests/integration/specs`) | `npm run qa:*` | ❌ **Not run** (needs the isolated profile and Stripe test sandbox) |
| Production build | `npm run build` | ❌ **Not run** (would overwrite `client/dist` used by the local server) |
| Unauthenticated access probes | `curl` against `localhost:3001` | `/api/admin/stats`, `/api/admin/finance/ledger`, `/api/vendor/listings`, `/api/vendor/org`, `/api/residents/me/receipts` → **401** ✅. Public lists → 200. `/api/residents/me`, `/api/manage/workspaces`, `/api/auth/me`, `/api/guest/me` → 200 with null/empty identity ✅ [P] |
| Commerce switch state | `SELECT` on `hello_circle_dev.app_settings` | No `commerce.*` rows, so every switch is at its default [D] |

**Limitations:**
- No authenticated or role-specific requests were made.
- No browser session was used.
- No write path was exercised, so **end-to-end server processing of bookings, refunds, payouts, approvals and
  moderation was not verified in this audit**; those statements are code-inspected only.
- Production and staging configuration, switch values and data were not inspected.
- The audit reflects uncommitted working-tree code.
- Grep-based conclusions (e.g. "rule key X is never read") are only as complete as the search patterns used. They were
  cross-checked by searching for field names as well as rule keys.

---

## 11. Open questions code can't answer

1. When a vendor is suspended, should their listings be hidden and their future bookings honoured, cancelled or
   refunded?
2. Should edits to an approved listing require re-approval (all fields, or only material ones)?
3. What is the intended scope of each admin sub-role for marketplace moderation (vendor/listing approval, deletion,
   staff roles, org flags)?
4. Is the commerce engine meant to become the single pricing source for all types? If so, in what order, and is the
   23%-on-top / 5%-on-top legacy model the intended launch model? (VAT treatment is flagged
   `provisional_pending_irish_tax_review` in code.)
5. Production values of `VITE_LAUNCH_MODE`, `VITE_VENUE_PAGES_PUBLIC`, `PAID_CHECKOUT`, and every `commerce.*` switch.
6. Who receives money for paid games, programmes and experiences while Connect is off, and how are hosts and vendors
   paid today (off-platform)?
7. Should guest bookings be linked to a resident account after sign-in with the same email?
8. What resident enforcement model is required (suspension, ban, appeal), and when will account deletion (P1-01) ship?
9. Company identity, legal publication and email-sender details remain owner inputs
   (`docs/company-identity-and-email-readiness.md`).
10. Have the previously exposed R2, Firebase and GitHub credentials been rotated? (Noted in project memory; not
    verifiable from code.)
11. Is `PARTNER_FEE_MODEL_STATUS="proposed"` expected to change by code release only (it isn't an admin switch)?
12. What does the owner need for staff off-boarding (change role, remove member)?
