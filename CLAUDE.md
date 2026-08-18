# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This file describes the `v2-0`/`v3-0` branches. The main difference from `main`/`v1-0` is the database:
> these branches run on MySQL (`mysql2`) instead of file-based SQLite (`better-sqlite3`), and the server
> serves the built client itself (single origin) instead of documenting two deploy options.

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
data (Dublin/Cork centres and clubs) and their picsum.photos-backed gallery images — see the note on
`img()`/`imgs()` below.

## What this is

Hello Circle — a community centres & sports clubs directory for Ireland: book a hall, register a kid for a
club, and (for vendors/admins) manage listings, bookings and moderation. React (Vite + TS) client, Express
(TS) + MySQL API, npm workspaces monorepo (`client/`, `server/`).

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

There is no test suite and no lint script in this repo currently.

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

## Architecture

**Three roles, two of which need accounts.** `user` (guest, no account — "My bookings" is scoped by a
random id the client generates into `localStorage` and sends as `X-Client-Id`, see `client/src/clientId.ts`),
`vendor` (lists a centre or a club, starts `pending` until an admin approves), `admin` (moderates
everything). Full spec/rationale in `docs/roles-and-flows.md` (written pre-MySQL-migration — data model
details there may be stale, but the roles/flows description still holds). Session auth is cookie-based
(`hello_circle_session`, httpOnly, `sameSite: lax`, `secure` only when `NODE_ENV=production`), hashed with
bcryptjs — no third-party auth provider. `server/src/auth.ts` has the guards: `attachUser` (populates
`req.user`, never rejects), `requireVendor`, `requireAdmin`, `requireVendorOrAdmin`. Vendor signup
(`routes/auth.ts`) now takes the full listing intake in one form (vendor type, business name, address,
county, phone, description) and creates the pending `centres`/`clubs` row in the *same* DB transaction as
the user row — no separate "create your listing" step after approval. It deliberately does **not** log the
new vendor in (no session cookie set on signup) — they log in themselves once an admin approves them.

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

Schema setup lives in `initSchema()` in the same file — base tables are `CREATE TABLE IF NOT EXISTS`, and
every change since then is an additive, idempotent `ensureColumn(table, column, ddl)` helper (checks
`information_schema`/`SHOW COLUMNS` before `ALTER TABLE ADD COLUMN`), with a backfill `UPDATE` where a
non-constant default is needed. There is no separate migration tool/step — extend `initSchema()` the same
way for new schema changes; never edit an already-shipped `CREATE TABLE` block. Shared read queries
(`listCentres`, `getCentre`, `getClub`, …) live in `server/src/db/queries.ts`; seed data + first-run admin
bootstrap + the `reset-demo` script's reset logic live in `server/src/db/seed.ts`.

**Rooms are real, independently bookable spaces again** — a centre can have any number of named rooms, each
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

**Routes are mounted flat in `server/src/index.ts`** under `/api/*`, one router per resource
(`routes/centres.ts`, `routes/clubs.ts`, `routes/bookings.ts`, `routes/registrations.ts`,
`routes/reviews.ts`, `routes/availability.ts`, `routes/uploads.ts`, `routes/coupons.ts`, `routes/auth.ts`,
`routes/vendor.ts` [vendor-scoped CRUD on own listing], `routes/admin.ts` [approval/moderation]). Public
centre/club routes only ever return `approved` rows. The Stripe webhook (`routes/stripeWebhook.ts`) is
mounted *before* `express.json()` with `express.raw()` instead, because Stripe's signature check needs the
untouched raw body bytes — keep any new raw-body-dependent route ahead of the JSON body parser too. In
production (`NODE_ENV=production`) the webhook handler *requires* `STRIPE_WEBHOOK_SECRET` and refuses
unverified events; in dev, an unset secret just skips signature verification.

**Payments**: Stripe Checkout (`server/src/stripe.ts`) plus a pricing engine (`server/src/pricing.ts`) that
computes VAT (23%), a 5% platform fee, coupon discounts, and deposits server-side — never trust a
client-supplied total or discount. Bookings/registrations start `payment_status: 'pending'` and only flip to
`'paid'` when the Stripe webhook confirms the charge. Without `STRIPE_SECRET_KEY` set, checkout endpoints
return 503 but nothing else breaks.

**Times**: all `DATETIME` columns are stored/interpreted as UTC (the pool is configured with
`timezone: "Z"`) regardless of the Node process's own local timezone. `server/src/irelandTime.ts` converts
Ireland wall-clock dates/times (as entered by a vendor/guest, e.g. a booking date+slot) to the correct UTC
instant, DST-aware (`Europe/Dublin` is UTC+0 in winter, UTC+1 in summer) — use it rather than hand-rolling
timezone math anywhere a booking/coupon-expiry date needs to be compared against "now" or displayed.

**Notifications**: every new booking/registration writes a row to the `notifications` table (visible to the
owning vendor's dashboard Messages tab and to every admin) and attempts to email guest + vendor + admins via
`server/src/notifications.ts` / `server/src/email.ts` (nodemailer, console-log fallback when SMTP env vars
are unset). A failed/unconfigured email is logged and swallowed — it never blocks the booking itself.
`server/src/index.ts` also installs a process-wide `unhandledRejection` handler so an uncaught async error
(e.g. a rejected Stripe or MySQL call) logs instead of crashing the server.

**Client** (`client/src/`): `App.tsx` is the route table; `AuthContext.tsx` holds vendor/admin session
state, `MyStuffContext.tsx` holds the guest "my bookings" count. `api.ts` has one typed fetch wrapper per
API endpoint — add new server routes there rather than calling `fetch` ad hoc from pages. `types.ts` mirrors
server response shapes by hand (no shared/generated types package between client and server — keep both in
sync manually when changing an API shape). No CSS framework; styling is hand-rolled via `theme.ts` (design
tokens) and `index.css`. One file per route under `pages/`; shared UI under `components/`. The "New to
Ireland" checklist page (`pages/Checklist.tsx`, `/checklist`) from `main` was removed on this branch;
`pages/PrivacyPolicy.tsx` (`/privacy`) and `pages/CookiePolicy.tsx` (`/cookies`) were added, plus a
`components/CookieNotice.tsx` consent banner rendered globally in `App.tsx`.

**Deployment is single-origin now.** `server/src/index.ts` serves `client/dist` itself via
`express.static` + a SPA fallback (`app.get("*", ...)`, skipping `/api/*` and `/uploads/*`) — the whole app
is one Node process, one origin, avoiding cross-origin cookie/CORS complexity by construction. `DATA_DIR`
(`server/src/dataDir.ts`, default: the server package root) controls where `uploads/` lives — point it at a
mounted persistent volume in production, since container/PaaS hosts typically wipe local disk on
redeploy. `start.bat` is a Windows convenience launcher (`cd` to the repo root, `npm run dev`) — dev-only,
not part of the build/deploy path. CORS is still `cors({ origin: true, credentials: true })` (reflects any
origin) — fine for same-origin production deploys, but should be locked to a real origin if that ever
changes.

`reference/` is a static design export (not runnable app code) kept only for visual reference.
