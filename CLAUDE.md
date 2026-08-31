# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This file describes the `v2-0`/`v3-0`/`v4-0` branches. The main difference from `main`/`v1-0` is the
> database: these branches run on MySQL (`mysql2`) instead of file-based SQLite (`better-sqlite3`), and the
> server serves the built client itself (single origin) instead of documenting two deploy options.

## Dev vs. prod database

Two local MySQL databases exist side by side: **`hello_circle_dev`** (safe to reset/reseed freely — this is
what `server/.env` points at by default) and **`hello_circle`** (treated as prod — real/canonical data, never
point routine local dev work at it). `server/.env.production` holds the same shape of config with
`DB_NAME=hello_circle`, for the rare case you deliberately need to run against prod data (e.g.
`cp server/.env.production server/.env` for a one-off task, then switch back). Both `.env` and `.env.*` are
gitignored — never commit real prod credentials into `.env.production`, even though the file itself is
tracked-ignorable by pattern, not by name.

To reset/reseed the dev database from scratch:
```bash
export DB_NAME=hello_circle_dev   # or just make sure server/.env points at it
npm run reset-demo --workspace server   # wipes + reseeds the 2 demo centres / 2 demo clubs + gallery images
```
`resetDemoListings()`/`seedIfEmpty()` (`server/src/db/seed.ts`) are what generate the Ireland-themed sample
data (Dublin/Cork centres and clubs) and their gallery images — deterministic placehold.co color-block
placeholders (`placeholderImage()` in that file), not real photography; swap in curated photos before
shipping. (Previously picsum.photos — moved off it after an outage there broke every seeded listing photo
at once; see the comment above `placeholderImage()`.)

## What this is

Hello Circle — a participation platform for community centres, sports clubs, and informal local activity in
Ireland: browse what's on, book a hall or a session, register a kid for a club, join or host an ad-hoc game,
form a recurring Circle around a shared activity — and, for vendors/admins, manage listings, sessions,
bookings, staff and moderation. React (Vite + TS) client, Express (TS) + MySQL API, npm workspaces monorepo
(`client/`, `server/`).

The product has grown well past a single-table booking MVP. Four distinct identity/participation surfaces
now coexist in the same codebase — see "Who uses this" below before assuming "user" means what it used to.

## Commands

```bash
npm install                          # installs both workspaces from repo root
npm run dev                          # API on :3001 + client on :5173, concurrently (root script)
npm run build                        # server tsc build, then client tsc + vite build (root script)
npm start                            # runs the built server (node dist/index.js) — also serves the built client

npm run dev --workspace server       # API only, hot reload via tsx watch
npm run dev --workspace client       # client only (Vite dev server)
npm run reset-demo --workspace server  # tsx src/scripts/resetDemo.ts — wipes back to 2 demo centres + 2 demo clubs
npm run preview --workspace client   # serve the built client bundle locally
```

There is no lint script in this repo currently. There is a small Vitest suite on each workspace (`npm run
test --workspace server` / `--workspace client`, or `npm test` from the root to run both) — server covers
capacity/games/registrations/the Stripe webhook (`server/src/**/*.test.ts`), client covers a handful of pure
utility functions (`client/src/**/*.test.ts`); neither is close to comprehensive (no route/component/
integration coverage), so still verify payment-adjacent changes by hand against `hello_circle_dev` per the
"Known gaps" section below.

**Requires a running MySQL/MariaDB server reachable from the machine running the API** — there's no bundled
database on this branch. There is no `server/.env.example` on this branch (it was removed); every env var
the server reads is documented in `README.md`'s Environment variables table instead — check there (or
`server/src/dataDir.ts`, `server/src/db/index.ts`, `server/src/stripe.ts`) before assuming a var doesn't
exist. Key ones: `DB_HOST` (default `127.0.0.1`), `DB_PORT` (`3306`), `DB_USER` (`root`), `DB_PASSWORD`
(empty), `DB_NAME` (code default `hello_circle`, but `server/.env` overrides this to `hello_circle_dev` — see
"Dev vs. prod database" above) — the target database must already exist (`CREATE DATABASE <name>;` first);
the app creates/migrates tables inside it on startup, not the database itself.

First run: the server awaits `initSchema()` + seeding before it starts listening (schema/seed queries are
async against MySQL, so this is a real `await` at module load, not fire-and-forget) and seeds an admin
account — `admin@hellocircle.ie` / `changeme123` by default, overridable via `HELLO_CIRCLE_ADMIN_EMAIL` /
`HELLO_CIRCLE_ADMIN_PASSWORD`.

## Who uses this — four identity/participation surfaces

Unlike the original 3-role model this file used to describe, there are now **three separate identity
systems**, populated independently on every request by three separate pieces of middleware
(`attachUser` → `attachGuestEmail` → `attachResident`, mounted in that order in `server/src/index.ts`), plus
a fourth, older, account-less mechanism that predates all of them:

1. **`req.user`** (`server/src/auth.ts`) — password-authenticated `vendor` or `admin` accounts, cookie
   session (`hello_circle_session`, httpOnly, bcryptjs-hashed). This is the original MVP role model.
2. **`req.resident`** (`server/src/residents.ts`) — passwordless identity behind a *magic-link* email flow
   (`server/src/guestAuth.ts` issues a short-lived `guest_login_tokens` row that becomes a
   `guest_sessions` cookie on verify; `residents.ts` then finds-or-creates the actual `residents` row keyed
   on that verified email). This is the identity behind household members, favourites, Circles, Games,
   Passes, and receipts — a resident is not a `users` row and has no `role`.
3. **`req.guestEmail`** — the verified email from step 2, attached before the `residents` lookup runs; you'll
   see routes read this directly when they only need "is this email verified," not the full resident profile.
4. **The anonymous `X-Client-Id` header** (`client/src/clientId.ts`, `server/src/util.ts`'s `clientIdFrom()`)
   — a random id the client generates into `localStorage` with no auth at all. This is still the *primary*
   ownership key for a booking/registration made without ever signing in via magic link — "My bookings"
   works for a pure guest purely off this header. A signed-in resident's bookings additionally get
   `resident_id` set, so `residents.ts`'s receipts endpoint can find them without needing the client id too.

None of these four share a table, and nothing unifies them — a person who both registered a child for a club
as a pure guest *and* later signs in via magic link with the same email will not automatically see that old
booking linked to their resident account. Don't assume "the current user" has one obvious meaning in a new
route; check which of the three middlewares actually populated something before writing a guard.

**Vendor/admin roles**, for the `req.user` side specifically:
- `vendor` — lists a centre and/or a club (a vendor account is no longer locked to one type; see
  `ListingsTab` in `VendorDashboard.tsx` and `POST /vendor/claims` in `routes/vendor.ts`), starts `pending`
  until an admin approves. `server/src/routes/auth.ts`'s `/signup` takes the full listing intake in one form
  and creates the pending `centres`/`clubs` row in the *same* DB transaction as the user row — no separate
  "create your listing" step after approval. It deliberately does **not** log the new vendor in (no session
  cookie set on signup) — they log in themselves once an admin approves them.
- `admin` — moderates everything; also owns what used to be a separate "Platform Admin" persona/route
  (`/platform-admin`, `PlatformAdmin.tsx`, `routes/platformAdmin.ts`) — that surface was folded into
  `AdminDashboard.tsx`/`routes/admin.ts` and the standalone page/router were deleted. Look in `admin.ts` for
  organisation CRUD, RBAC role assignment, provider-tier assignment, the audit log, and moderation reports —
  they're all here now, not in a separate router.
- **Organisations + RBAC are real and enforced**, not schema-only scaffolding. Every vendor has an `org_id`
  (1:1-backfilled at boot for pre-existing vendors, assigned at signup for new ones — see
  `server/src/db/index.ts`'s vendor-org backfill and `routes/auth.ts`'s signup transaction). `orgVendorIds()`
  in `auth.ts` is what makes "your own listings" mean "every listing owned by any user in your org," not just
  your own user id — `attachVendorIds` middleware populates `req.vendorIds` for exactly this. An org owner
  (not `invitedStaff`) is unrestricted; an *invited* staff member is narrowed to their assigned
  `platform_role` (`centre_manager | facility_manager | finance | communications | read_only_analyst`) via
  `requirePlatformRole(...)`/`hasPlatformRole()` — check current usage with
  `grep -rn "requirePlatformRole(" server/src/routes` before assuming a route is or isn't gated, since this
  has been extended well past its original single-endpoint pilot. `routes/org.ts` (`/api/vendor/org`) is the
  owner-only org profile/policies/staff-invite surface; `client/src/components/VendorOrg.tsx` is its UI.

## Architecture

**MySQL via a hand-rolled async shim that mimics better-sqlite3's API.** `server/src/db/index.ts` wraps a
`mysql2/promise` pool behind `db.prepare(sql).get/all/run(...params)` and `db.transaction(async (tx) => {...})`
— every call site is `await`ed where the old SQLite code was synchronous, but the call shape is otherwise
unchanged. Two things to know before touching this file or writing new queries:
- `run()` supports both positional (`?`) and MySQL2 named (`@field`) placeholders — the named form is
  detected by passing a single plain-object argument, and is what `seed.ts`/`bookings.ts`/`registrations.ts`/
  `notifications.ts` use for inserts with many optional fields.
- `undefined` params are normalized to `null` before every query, because the `COALESCE(?, col)`
  partial-update pattern used throughout `admin.ts`/`vendor.ts` relies on being able to pass `undefined` for
  an untouched field (better-sqlite3 did this automatically; mysql2 throws on `undefined` otherwise).
- MySQL returns `SUM()`/`AVG()` DECIMAL results as strings, not numbers, unless `decimalNumbers` is set on
  the pool (it isn't) — coerce with `Number(...)` at the response boundary rather than assuming a numeric
  aggregate came back typed correctly (see `routes/vendor.ts`'s `/listings` rating coercion and `/stats`
  `totalViews` coercion for the pattern).

Schema setup lives in `initSchema()` in the same file — base tables are `CREATE TABLE IF NOT EXISTS`, and
every change since then is an additive, idempotent `ensureColumn(table, column, ddl)` helper (checks
`information_schema`/`SHOW COLUMNS` before `ALTER TABLE ADD COLUMN`), with a backfill `UPDATE` where a
non-constant default is needed. There is no separate migration tool/step and **no down-migration path at
all** — extend `initSchema()` the same way for new schema changes; never edit an already-shipped `CREATE
TABLE` block. There are also no MySQL foreign-key constraints declared anywhere in the schema — every
relationship, including the polymorphic `listing_type`/`listing_id` pairs used across `reviews`,
`favourites`, `passes`, `notifications`, `reports`, and `waitlist_entries`, is enforced entirely in
application code, not the database. Shared read queries (`listCentres`, `getCentre`, `getClub`, …) live in
`server/src/db/queries.ts` — this pattern is *not* yet extended to circles/programs/games/passes, whose
status/visibility filtering is currently reimplemented per-router instead of centralized; be careful copying
an existing filter rather than re-deriving it by hand. Seed data + first-run admin bootstrap + the
`reset-demo` script's reset logic live in `server/src/db/seed.ts`.

**Five separate tables independently model "someone participating in something"**: `bookings` (centre/room
hire), `registrations` (club sign-up), `program_enrollments` (multi-session Program enrollment),
`game_participants` (ad-hoc Game join), and `circle_members` (persistent Circle membership, unpaid). Each
tracks its own participant reference, its own `payment_status` (where applicable), and its own capacity
check against a different parent table. This is *not* an accident to "fix" reflexively — it's the direct,
if-duplicated, result of the product's Activity → Offering → Session → Enrollment model having been built
piecemeal across several features rather than as one migration. A real unification (collapsing these into
one shape) is a deliberate, large, multi-week effort that touches Stripe webhooks, pricing, waitlists, and
notifications — don't attempt it as a side effect of an unrelated change; treat the five as parallel and keep
each one internally consistent instead.

**Rooms are real, independently bookable spaces** — a centre can have any number of named rooms, each
with its own capacity/rate/payment method/active flag, managed via `GET/POST/PUT /vendor/centres/:id/rooms`
in `server/src/routes/vendor.ts` (alongside that file's `/blocks`/`/hours` sub-resources, same
`ownsCentre()`-gated pattern). `centres.capacity`/`.from_price` are a computed rollup (`MAX(cap)`/`MIN(rate)`
over active rooms — see `recomputeCentreRollup()` in `vendor.ts`), not vendor-editable directly, so every
existing read surface (`CentreCard`, `DiscoveryMap`, `Browse.tsx`'s price sort, admin's listing facts) keeps
working unchanged against those two scalars. A centre always has >= 1 active room — enforced both by a
zero-rooms backfill in `initSchema()` and by a "can't deactivate your last room" 409 guard in the rooms `PUT`
handler — a "removed" room is deactivated (`active = 0`), never hard-deleted, so historical `bookings.room_id`
references stay valid. The public booking route is still `/book/:centreId` (no `:roomId` segment) — room
selection happens as the first step *inside* `BookingFlow.tsx` instead, defaulting instantly for
single-room centres. `room_blocks` can be scoped to one room or the whole centre (`room_id IS NULL`).
Per-room opening hours don't exist yet — every room in a centre still shares the centre's single
`opens_at`/`closes_at` window (or `centre_hours` if set).

**Routes are mounted flat in `server/src/index.ts`** under `/api/*`, roughly one router per resource — see
`index.ts` itself for the full current mount list rather than trusting a stale summary here, since routers
have been added/removed (`platformAdmin.ts` was deleted; `circles.ts`, `games.ts`, `passes.ts`, `programs.ts`,
`household.ts`, `favourites.ts`, `feedback.ts`, `residents.ts`, `guestAuth.ts`, `org.ts` were added since the
original MVP). `routes/vendor.ts` itself is now just a ~20-line mounter — `requireVendor`/`attachVendorIds`
applied once, then four domain sub-routers (`vendorListings.ts`, `vendorPrograms.ts`, `vendorOperations.ts`,
`vendorInsights.ts`, plus shared ownership/rollup helpers in `vendorHelpers.ts`) mounted under it, split out
of what used to be one 1088-line file — still reached the same way from outside (`/api/vendor/*`). Public
centre/club routes only ever return `approved` rows. The Stripe webhook
(`routes/stripeWebhook.ts`) is mounted *before* `express.json()` with `express.raw()` instead, because
Stripe's signature check needs the untouched raw body bytes — keep any new raw-body-dependent route ahead of
the JSON body parser too. In production (`NODE_ENV=production`) the webhook handler *requires*
`STRIPE_WEBHOOK_SECRET` and refuses unverified events; in dev, an unset secret just skips signature
verification.

**Payments**: Stripe Checkout session creation is centralized in `server/src/checkoutService.ts`
(`createCheckoutSession()`/`pricingLineItems()`) — every payment path (`bookings.ts`, `registrations.ts`,
`games.ts`, `programs.ts`, `passes.ts`) calls into this shared service rather than hand-rolling its own
`stripe.checkout.sessions.create` call, though each still owns its own pending-row insert/cleanup (and, for
`bookings.ts`, its own row-locked transaction) since every resource's pending-row shape differs. The
`{ type, ref }` metadata contract `checkoutService.ts` writes into every session is what
`stripeWebhook.ts`'s `confirm*`/failure-handling functions match on to route a paid or expired session back
to the right table — don't change `type`'s literal values (`"booking" | "registration" | "game" | "program" |
"pass"`) without updating `stripeWebhook.ts` in lockstep. `server/src/pricing.ts` computes VAT (23%), a 5%
platform fee, coupon discounts, and deposits server-side — never trust a client-supplied total or discount.
Bookings/registrations/games/programs/passes start `payment_status: 'pending'` (or free/cash paths skip
straight to `'paid'`) and only flip to `'paid'` when the Stripe webhook confirms the charge. Without
`STRIPE_SECRET_KEY` set, checkout endpoints return 503 but nothing else breaks.

**Times**: all `DATETIME` columns are stored/interpreted as UTC (the pool is configured with
`timezone: "Z"`) regardless of the Node process's own local timezone. `server/src/irelandTime.ts` converts
Ireland wall-clock dates/times (as entered by a vendor/guest, e.g. a booking date+slot) to the correct UTC
instant, DST-aware (`Europe/Dublin` is UTC+0 in winter, UTC+1 in summer) — use it rather than hand-rolling
timezone math anywhere a booking/coupon-expiry date needs to be compared against "now" or displayed.

**Notifications**: every new booking/registration writes a row to the `notifications` table (visible to the
owning vendor's dashboard Messages tab and to every admin) and attempts to email guest + vendor + admins via
`server/src/notifications.ts` / `server/src/email.ts` (nodemailer, console-log fallback when SMTP env vars
are unset). The same table also serves *resident*-facing notifications now (`notifications.resident_id`,
alongside the original vendor/admin `recipient_id`) — `residentsRouter`'s `/me/notifications` routes are the
resident-scoped read/mark-read pair, mirroring the vendor ones in `vendor.ts`. A failed/unconfigured email is
logged and swallowed — it never blocks the booking itself. `server/src/index.ts` also installs a
process-wide `unhandledRejection` handler so an uncaught async error (e.g. a rejected Stripe or MySQL call)
logs instead of crashing the server.

**Client** (`client/src/`): `App.tsx` is the route table — check it directly for the current page list rather
than trusting a stale enumeration here. `AuthContext.tsx` holds vendor/admin session state, `GuestContext.tsx`
holds resident/magic-link session state, `MyStuffContext.tsx` holds the guest "my bookings" count,
`DashboardNavContext.tsx` lets the Vendor/Admin dashboards register a burger-menu trigger in the global
`Header`. `api.ts` has one typed fetch wrapper per API endpoint — add new server routes there rather than
calling `fetch` ad hoc from pages. It's now a thin barrel (`export * from "./api/core"` etc.) re-exporting six
domain modules under `client/src/api/` — `core.ts` (the shared `request()`/`ApiError`), `public.ts`
(guest-facing browsing/transactions, no account needed), `resident.ts` (magic-link session, household,
favourites, games, circles, passes, …), `vendorAuth.ts` (signup/login/password-reset/invite-accept),
`vendor.ts` (the vendor dashboard's own CRUD/ops/insights calls), and `admin.ts` — split out of what used to
be one 1076-line file. Every existing `from "../api"` import site is unchanged, since the barrel keeps the
public import path stable; add a new wrapper to whichever domain module it belongs to (or `api.ts` itself
stays untouched). `VendorDashboard.tsx` similarly split into `components/Vendor*.tsx` files (one per tab) plus
`vendorFormat.ts` for shared formatters, the same pattern already used for `VendorOrg.tsx`/`VendorPrograms.tsx`.
`types.ts` mirrors server response shapes by hand (no shared/generated types package
between client and server — keep both in sync manually when changing an API shape). No CSS framework;
styling is hand-rolled via `theme.ts` (design tokens, no formal spacing/type scale yet — inline pixel values
are common) and `index.css` (also the home of the app's `@media` responsive escape-hatch utility classes,
since inline styles can't express breakpoints). `ui.tsx` is the closest thing to a component library
(`Button`, `LinkButton`, `Card`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `DashboardTopPanel`, `Drawer`,
`NavSidebar`, table style constants, …) — no Storybook, no visual regression tooling. One file per route
under `pages/`; shared UI under `components/`. `pages/PlatformAdmin.tsx` was deleted (folded into
`AdminDashboard.tsx`, see "Who uses this" above); the pre-existing "New to Ireland" checklist page
(`pages/Checklist.tsx`, `/checklist`) was removed earlier and stays removed. `pages/PrivacyPolicy.tsx`
(`/privacy`) and `pages/CookiePolicy.tsx` (`/cookies`) exist, plus a `components/CookieNotice.tsx` consent
banner rendered globally in `App.tsx`.

**Deployment is single-origin.** `server/src/index.ts` serves `client/dist` itself via `express.static` + a
SPA fallback (`app.get("*", ...)`, skipping `/api/*` and `/uploads/*`) — the whole app is one Node process,
one origin, avoiding cross-origin cookie/CORS complexity by construction. `DATA_DIR`
(`server/src/dataDir.ts`, default: the server package root) controls where `uploads/` lives — point it at a
mounted persistent volume in production, since container/PaaS hosts typically wipe local disk on redeploy.
`start.sh`/`start.bat` are convenience launchers (`cd` to the repo root, `npm run dev`) — dev-only, not part
of the build/deploy path. CORS is still `cors({ origin: true, credentials: true })` (reflects any origin) —
fine for same-origin production deploys, but should be locked to a real origin if that ever changes. The
in-memory rate limiter (`server/src/rateLimit.ts`) resets on process restart and won't survive a
multi-instance deploy — fine at current scale, replace with a shared store before scaling past one instance.

`reference/` is a static design export (not runnable app code) kept only for visual reference.

## Known gaps, not to be "fixed" opportunistically

These are real, acknowledged product/architecture gaps — worth knowing about so you don't accidentally step
into fixing (or worse, half-fixing) one as a side effect of an unrelated task:

- **The five participant-tracking tables aren't unified** (see above) — a real fix is a large, deliberate
  migration, not a quick refactor.
- **RBAC's scope is still being actively extended**, not finished — check current `requirePlatformRole(...)`
  usage in `server/src/routes/*.ts` before assuming any given vendor-scoped route is or isn't gated.
- **No CI, and the Vitest suites are thin** (see above) — no automated safety net for checkout/cancellation
  paths beyond what the server's handful of `*.test.ts` files cover. Verify payment-adjacent changes by hand
  against `hello_circle_dev`, never `hello_circle`.
- **Resident preferences (`interests`/`availability`) are stored as CSV text**, not a structured/queryable
  shape — fine for display, not yet a foundation for real personalization/recommendations.
