# Hello Circle

Community centres & sports clubs guide for Ireland — book a hall, register your kid for a club, and (for
vendors/admins) manage listings, bookings and moderation.

A React (Vite + TypeScript) client and a Node.js (Express + TypeScript + MySQL) API, run as an npm
workspaces monorepo.

---

## Tech stack

| Layer | Stack |
|---|---|
| Client | React 18, React Router 6, TypeScript, Vite 6 (no CSS framework — hand-rolled styles in `theme.ts`/`index.css`) |
| Server | Node.js (ESM), Express 4, TypeScript, `mysql2` (MySQL/MariaDB — needs a running database server) |
| Auth | Cookie-based sessions (httpOnly, `bcryptjs` password hashing) — no third-party auth provider |
| Email | `nodemailer` over SMTP, with a console-log fallback when unconfigured |
| Uploads | `multer`, saved to local disk under `server/uploads/`, served statically |

---

## Folder structure

```
hello-circle/
├── package.json              # root — npm workspaces (client, server) + combined dev/build scripts
├── package-lock.json
├── README.md
├── docs/
│   └── roles-and-flows.md    # product spec: roles (user/vendor/admin), flows, data model, open questions
├── reference/                 # original design export — not runnable, kept for visual reference only
│   ├── Halla.dc.html
│   ├── support.js
│   └── screenshots/
│
├── client/                    # Vite + React + TypeScript frontend
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts        # dev-server proxy: /api and /uploads → http://localhost:3001
│   ├── tsconfig.json
│   ├── public/
│   │   ├── favicon.svg
│   │   └── illustrations/    # static image assets
│   └── src/
│       ├── main.tsx          # entry point
│       ├── App.tsx           # router / route table
│       ├── AuthContext.tsx   # current-user session state (vendor/admin)
│       ├── MyStuffContext.tsx# guest "my bookings" count (localStorage-scoped)
│       ├── api.ts            # typed fetch wrappers for every API endpoint
│       ├── types.ts          # shared TS types mirroring server response shapes
│       ├── theme.ts          # color/spacing/font tokens
│       ├── clientId.ts       # random per-browser id for guest booking lookups
│       ├── components/       # shared UI: Header, Footer, cards, icons, illustrations, form widgets
│       └── pages/            # one file per route: Home, Browse, CentreDetail, ClubDetail,
│                              # BookingFlow, RegistrationFlow, MyBookings, Login, VendorSignup,
│                              # VendorDashboard, AdminDashboard, Checklist ("New to Ireland")
│
└── server/                    # Express + TypeScript API
    ├── package.json
    ├── tsconfig.json
    ├── .env                   # local secrets — gitignored, not committed
    ├── .env.example           # documents every variable the server reads
    ├── uploads/                # user-uploaded listing photos (local disk)
    └── src/
        ├── index.ts           # app entry: middleware, route mounting, listen()
        ├── auth.ts            # session cookies, password hashing, requireVendor/requireAdmin guards
        ├── dataDir.ts         # where uploads/ lives — override with DATA_DIR for a persistent volume
        ├── email.ts           # SMTP sender (nodemailer) with dev console-log fallback
        ├── notifications.ts   # in-app notification log + email fan-out on booking/registration
        ├── util.ts            # shared helpers (client-id parsing, ref generation, error types)
        ├── types.ts           # server-side domain types
        ├── db/
        │   ├── index.ts       # mysql2 pool, async prepare/get/all/run shim, schema, column migrations
        │   ├── seed.ts        # seed data + admin-account bootstrap (first run only)
        │   └── queries.ts     # shared read queries (listCentres, getCentre, getClub, …)
        └── routes/
            ├── auth.ts         # signup/login/logout, session cookie issuance
            ├── centres.ts      # public centre listing/detail (approved-only)
            ├── clubs.ts        # public club listing/detail (approved-only)
            ├── availability.ts # room availability lookups
            ├── bookings.ts     # guest room bookings (+ triggers notifications)
            ├── registrations.ts# guest club registrations (+ triggers notifications)
            ├── reviews.ts      # guest reviews (rating gated on a prior booking/registration)
            ├── uploads.ts      # image upload endpoint (multer, disk storage)
            ├── vendor.ts       # vendor-only: own listings CRUD, rooms, stats, notifications inbox
            └── admin.ts        # admin-only: vendor approval, listing moderation, review moderation
```

---

## Prerequisites

- Node.js 20+ (developed against Node 22)
- npm 10+ (workspaces support)
- A running MySQL (or MariaDB) server, reachable with the credentials in `server/.env`

Email falls back to console logging if SMTP isn't configured — no external service required for that part.

---

## Getting started (local dev)

```bash
npm install       # installs both workspaces (client + server) from the repo root
npm run dev        # starts the API on :3001 and the client on :5173 (Vite proxies /api + /uploads to it)
```

Open the client URL printed in the terminal (usually **http://localhost:5173**).

On first run, the server:
- creates the schema on the configured MySQL database and seeds it with sample centres/clubs
- seeds one admin account: `admin@hellocircle.ie` / `changeme123` (override via env vars — see below)

### Test accounts

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | `admin@hellocircle.ie` (or `HELLO_CIRCLE_ADMIN_EMAIL`) | `changeme123` (or `HELLO_CIRCLE_ADMIN_PASSWORD`) | Seeded automatically |
| Vendor | sign up at `/vendor/signup` | — | New vendors start `pending` until an admin approves them from the Admin dashboard |
| User (guest) | — | — | No account needed — bookings/registrations are scoped by a random id in `localStorage` |

---

## Environment variables

The server reads `server/.env` (see `server/.env.example` for the template). Copy it and fill in real values:

```bash
cp server/.env.example server/.env
```

| Variable | Required? | Purpose |
|---|---|---|
| `PORT` | no (default `3001`) | API port |
| `DB_HOST` | no (default `127.0.0.1`) | MySQL host |
| `DB_PORT` | no (default `3306`) | MySQL port |
| `DB_USER` | no (default `root`) | MySQL user |
| `DB_PASSWORD` | no (default empty) | MySQL password |
| `DB_NAME` | no (default `hello_circle`) | MySQL database name |
| `DATA_DIR` | no (defaults to the server folder) | Where `uploads/` lives — point at a mounted persistent volume in production |
| `SMTP_HOST` | no | SMTP server hostname (e.g. `smtp.gmail.com`). Without this + `SMTP_USER`/`SMTP_PASS`, emails are **logged to the console** instead of sent — the app still works fully. |
| `SMTP_PORT` | no (default `587`) | SMTP port |
| `SMTP_USER` | no | SMTP auth username |
| `SMTP_PASS` | no | SMTP auth password. **For Gmail/Google Workspace, this must be an [App Password](https://myaccount.google.com/apppasswords), not the account's normal login password** — SMTP auth is rejected otherwise once 2-Step Verification is on. |
| `MAIL_FROM` | no (falls back to `SMTP_USER`) | The "from" address on outgoing mail |
| `HELLO_CIRCLE_ADMIN_EMAIL` | no (default `admin@hellocircle.ie`) | Email of the auto-seeded admin account |
| `HELLO_CIRCLE_ADMIN_PASSWORD` | no (default `changeme123`) | Password of the auto-seeded admin account — **change this before any real deployment** |
| `STRIPE_SECRET_KEY` | no (checkout returns 503 without it) | Stripe secret key — `sk_test_...` for test mode, `sk_live_...` for real charges |
| `STRIPE_WEBHOOK_SECRET` | no in dev, **required in production** (`NODE_ENV=production`) | Signing secret from the Stripe webhook endpoint (`whsec_...`) — without it in production, the webhook is refused rather than accepting unverified events |
| `CLIENT_URL` | no (default `http://localhost:5173`) | Public origin used for Stripe Checkout success/cancel redirect URLs — must be the real deployed domain in production |
| `PUBLIC_ORIGINS` (or `PUBLIC_ORIGIN`) | no (falls back to reflecting the request origin) | Comma-separated list of allowed CORS origins — **set this to the real deployed domain(s) in production**, since the fallback (reflecting any origin) is broader than a production deploy needs |
| `TRUST_PROXY_HOPS` | no (default off) | Number of trusted reverse-proxy hops in front of the process — set this behind a load balancer/CDN so the rate limiter keys on the real client IP (`X-Forwarded-For`) instead of the proxy's |
| `FIREBASE_PROJECT_ID` | no | Firebase project id — shared by native push notifications (mobile app) and Google sign-in token verification (`server/src/googleAuth.ts`). Without this + `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`: push is **logged to the console** instead of sent (see `MOBILE_SETUP.md` §7 in the `hello-circle-mobile` repo), and `POST /api/guest/google` / `POST /api/auth/google` respond **503**. See "Google Sign-In setup" below for the full setup. |
| `FIREBASE_CLIENT_EMAIL` | no | Firebase service account client email |
| `FIREBASE_PRIVATE_KEY` | no | Firebase service account private key (paste as-is; literal `\n` escapes are un-escaped automatically) |
| `MEDIA_PROVIDER` | no (default `local`) | `local` keeps uploads on the existing `/uploads` disk pipeline; `r2` switches image uploads to Cloudflare R2 (`server/src/media/`) — requires every `R2_*` var below to be set, and **throws at startup if `r2` is requested with any of them missing in production** (`NODE_ENV=production`); in dev, an incomplete `r2` config just warns and falls back to `local`. |
| `R2_ACCOUNT_ID` | only if `MEDIA_PROVIDER=r2` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | only if `MEDIA_PROVIDER=r2` | R2 API token (S3-compatible), scoped to the media bucket |
| `R2_BUCKET` | only if `MEDIA_PROVIDER=r2` | R2 bucket name (`hellocircle-media`) |
| `R2_ENDPOINT` | only if `MEDIA_PROVIDER=r2` | R2's S3-compatible endpoint (`https://<account-id>.r2.cloudflarestorage.com`) |
| `R2_PUBLIC_DOMAIN` | no | Custom domain bound to the R2 bucket (Cloudflare dashboard → R2 → bucket → Settings → Custom Domains) — without it, delivery URLs are just the raw object key (unusable as a URL); with it, images are served at `https://<domain>/<key>` |
| `R2_IMAGE_RESIZING_ENABLED` | no (default `false`) | Whether Cloudflare's Image Resizing (`/cdn-cgi/image/...`) is actually turned on for the zone `R2_PUBLIC_DOMAIN` sits on — this is a **separate toggle from just binding the custom domain**, confirmed by a live probe: raw object delivery worked immediately, but the transform path 404'd until this is explicitly enabled in the Cloudflare dashboard (may require a paid plan). `false` serves the raw, un-resized/un-format-converted image (correct, just unoptimized); only set `true` once you've confirmed `/cdn-cgi/image/width=300,format=auto/<some-real-key>` on your domain returns an actual resized image, not a 404. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | no | Optional SECOND media provider, for a small admin-curated editorial image collection only (`server/src/media/cloudinaryClient.ts`) — never the default for ordinary uploads (those stay on R2). Leaving these unset just means the "Media" tab in the admin dashboard has nothing to enable; it never affects R2 uploads or delivery. |
| `CLOUDINARY_FOLDER` | no (default `hellocircle/editorial`) | Folder prefix every editorial upload is scoped under — never caller-controlled |
| `CLOUDINARY_UPLOADS_ENABLED` | no (default `false`) | Deploy-time half of the Cloudinary pause switch — must be `true` (in addition to credentials being set) before an admin can turn Cloudinary uploads on at runtime via the admin dashboard's `cloudinary_uploads_enabled` app-settings toggle. Cloudinary starts **disabled** by default even with valid credentials, per the media architecture's "off until explicitly enabled" policy. Existing Cloudinary assets keep rendering regardless of this flag — it only gates new uploads. |
| `MEDIA_LOCAL_PROCESSING_ENABLED` | no (default `false`) | When `true`, new R2 uploads (`POST /api/media/upload`) are decoded, resized to every required size, and AVIF-encoded **on this server** (`sharp` + `heic-convert` for HEIC), then uploaded as several static pre-sized files — instead of storing one original and letting Cloudflare Image Resizing transform it dynamically. Added because Image Resizing can't take an AVIF file as its transform *source* on this account/zone (confirmed live: `HTTP 415`). When `false`, R2 uploads use the original presigned-direct-to-bucket flow (`/api/media/authorize` + `/finalize`), which remains fully intact as the rollback path. Does **not** apply to Cloudinary — editorial uploads are untouched by this flag. |

Two runtime (no-redeploy) pause switches also exist as `app_settings` rows, toggled from the admin dashboard's Media tab (`PUT /api/admin/media/config/uploads-enabled` and `.../cloudinary-enabled`), the same pattern as the pre-existing `maps_enabled` kill switch: `media_uploads_enabled` (global, default on) and `cloudinary_uploads_enabled` (Cloudinary-specific, default off, and only settable to `true` when `CLOUDINARY_UPLOADS_ENABLED=true`). Neither ever affects delivery of images already uploaded.

Other than talking to `/api` and `/uploads` as relative paths (proxied to the API in dev via
`client/vite.config.ts`, expected to be reverse-proxied the same way in production), the client has these
build-time env vars:

| Variable | Required? | Purpose |
|---|---|---|
| `VITE_LAUNCH_MODE` | no (default gated) | Pre-launch lockdown switch (`client/src/App.tsx`). Any value other than `public` — including unset — redirects every route except the vendor-recruitment pages (`/`, `/for-venues`), `/coming-soon`, everything under `/vendor`/`/admin`, auth pages, and the legal pages to `/coming-soon`. Set to `public` (and remove the `noindex` tag in `client/index.html` + the `Disallow: /` in `client/public/robots.txt`) for the real public launch. |
| `VITE_MEDIA_PUBLIC_DOMAIN` | no | Must match the server's `R2_PUBLIC_DOMAIN` exactly — `client/src/media.ts`'s `getMediaUrl()` only rewrites a stored image URL when it starts with `https://<this value>/`; otherwise every stored URL (legacy `/uploads/...`, external placeholder/marketing URLs, or an R2 URL before this is set) renders unchanged. |
| `VITE_MEDIA_IMAGE_RESIZING_ENABLED` | no (default `false`) | Must match the server's `R2_IMAGE_RESIZING_ENABLED` — `false` renders the raw R2 object URL (correct, unoptimized); `true` rewrites it into a `/cdn-cgi/image/...` transform URL, which 404s if Image Resizing isn't actually turned on for the zone. |
| `VITE_CLOUDINARY_CLOUD_NAME` | no | Must match the server's `CLOUDINARY_CLOUD_NAME` — `client/src/media.ts`'s `getMediaUrl()` only rewrites a stored URL into a Cloudinary transform when it starts with `https://res.cloudinary.com/<this value>/image/upload/`; no credentials are needed client-side since building a transform URL doesn't require signing. |
| `VITE_MAPBOX_TOKEN` | no (maps degrade to a "temporarily unavailable" fallback without it) | Mapbox GL JS public token (`pk.*`) for `DiscoveryMap.tsx`/`SinglePinMap.tsx` — scope it to the production domain via Mapbox's own token-restriction settings before launch. Geocoding/address search (`server/src/routes/geocode.ts`, `client/src/components/AddressSearch.tsx`) is unrelated and still uses Nominatim — this token only affects map *rendering*. |
| `VITE_MAPBOX_ENABLED` | no (default `true`) | Operational kill switch (`client/src/mapbox.ts`) — set to `false` to force every map component into its "unavailable" fallback without downloading the mapbox-gl bundle at all, e.g. during a real Mapbox cost/outage incident. This is an app-level lever, not a Mapbox-account-side spending cap — check the Mapbox account dashboard for actual usage/billing. |
| `GEOCODER_BASE_URL` | no (default `https://nominatim.openstreetmap.org`) | Server env var (not `VITE_*`) — the Nominatim-compatible geocoding endpoint `server/src/routes/geocode.ts` proxies. Lets a self-hosted or third-party instance be swapped in without a code change. |
| `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID` / `VITE_FIREBASE_APP_ID` | no (Google sign-in button shows as unavailable without all four) | The Firebase **Web app** config (`client/src/firebase.ts`) — not secret, just identifies the project; see "Google Sign-In setup" below for where to get these and what else needs enabling alongside them. |

---

## Google Sign-In setup

Google sign-in (`server/src/googleAuth.ts`, `client/src/firebase.ts`/`googleSignIn.ts`) is built on **Firebase
Authentication**, reusing the same Firebase project already configured for native push (`FIREBASE_PROJECT_ID`/
`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` above) rather than a second, separate OAuth setup. The server
verifies the Firebase ID token the client SDK produces (`firebase-admin`'s `verifyIdToken`) and mints this
app's own normal session cookie from it — Firebase never issues a HelloCircle session directly, and nothing
about the existing password/magic-link session architecture changes.

**It's login-only for vendor/admin** (`POST /api/auth/google`) — an email with no existing HelloCircle account
gets sent back to `/vendor/signup`'s full listing intake, never a bare auto-created account, so Google sign-in
can't be used to skip admin approval or grant a role. **It's login-or-signup for residents**
(`POST /api/guest/google`) — the lightweight resident identity has no such intake step, so a brand new Google
identity creates a resident the same way the existing magic-link flow does on first verify.

Code-side, this is complete without any further changes. What's still required, and can only be done by
someone with access to the relevant consoles (not something this app's own credentials can do — same posture
as the R2 CORS setup elsewhere in this README):

1. **Firebase console → Authentication → Sign-in method** → enable the **Google** provider for the project
   named by `FIREBASE_PROJECT_ID`.
2. **Firebase console → Authentication → Settings → Authorized domains** → add every origin the client is
   actually served from: `localhost` is included by default (covers local dev on any port, e.g. `:5173`); add
   the real production domain (e.g. `hellocircle.ie`) and any staging domain before testing sign-in there —
   Firebase's own popup/redirect flow refuses to complete from an origin not on this list.
3. **Firebase console → Project settings → General → "Your apps"** → if there's no **Web** app registered yet
   for this project (the existing entries are likely Android/iOS only, for push), click "Add app" → Web, and
   register one (a nickname is enough, Firebase Hosting isn't needed). Copy its `apiKey`, `authDomain`,
   `projectId`, and `appId` into `client/.env` (and `client/.env.production` for a real deploy) as
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`.
   These four are not secret — they identify the project, not authorize access — but the domain restriction
   in step 2 is what actually gates who can complete a sign-in.
4. **Google Cloud console → APIs & Services → OAuth consent screen** (same underlying GCP project as the
   Firebase project) → confirm the app name/support email/logo are filled in reasonably; while the app is in
   "Testing" publish status, only explicitly added test users can complete Google sign-in at all, so either
   add real test accounts or move the consent screen to "In production" before wider testing.

⚠️ **The Firebase service-account private key already in `server/.env`/`server/.env.production` was
previously exposed in a session transcript and has not been rotated (tracked separately — see internal
notes)**. That's an existing, unrelated issue predating this feature, but it means the same credential this
feature's server-side token verification depends on should be rotated before any real production launch,
not assumed safe to carry forward as-is.

---

## Data & notifications

- **Database**: MySQL, schema created and migrated automatically on startup (`server/src/db/index.ts`) — no
  separate migration step to run. Needs a reachable MySQL/MariaDB server (see `DB_*` env vars above).
- **Roles**: `user` (guest, no account), `vendor` (lists centres/clubs, needs admin approval), `admin`
  (moderates everything). Full spec in [`docs/roles-and-flows.md`](docs/roles-and-flows.md).
- **Bookings/registrations**: every new booking or club registration writes a row to the `notifications`
  table (visible to the owning vendor in their dashboard's Messages tab, and to every admin) and attempts
  to email the guest, the vendor, and every admin. A failed or unconfigured email never blocks the booking
  itself — it's logged and swallowed.
- **Uploads**: listing photos are saved to `server/uploads/` on local disk and served at `/uploads/<file>`.
  This is **not persistent** on most cloud hosts with ephemeral filesystems — see deployment notes below.

---

## Build (production bundles)

```bash
npm run build
```

This runs, in order:
1. `server`: `tsc` compiles `server/src` → `server/dist` (plain Node/CommonJS-free ESM JS)
2. `client`: `tsc && vite build` type-checks then bundles into `client/dist` (static HTML/JS/CSS)

Run the built server with `npm start` (or `npm run start --workspace server`; both run `node dist/index.js`).
It needs `server/.env` alongside it (or the equivalent env vars set another way) and a reachable MySQL
server — there's no bundled/embedded database anymore.

---

## Deployment guide

The server serves the built client itself (`server/src/index.ts` has `express.static` + a SPA fallback
route), so the whole app deploys as **one process, one origin** — no separate static host, no cross-origin
cookie/CORS complexity. Currently deployed as:

- **Server + client**: one Node web service (e.g. Render), built with `npm install && npm run build` and
  started with `npm start`, auto-deploying from GitHub.
- **Database**: MySQL hosted separately (e.g. Hostinger), reached over the network via `DB_*` env vars — if
  the host running Node isn't on the same provider as the database, remote access needs to be allowed on
  the database side for the Node host's outbound IP (or a wildcard, if the host doesn't have a fixed IP).

### Things to change before a real deployment

- **Admin password**: set `HELLO_CIRCLE_ADMIN_PASSWORD` (and ideally `HELLO_CIRCLE_ADMIN_EMAIL`) — don't ship the
  seeded default, especially if the database is reachable from any IP. `seedAdminIfMissing()` now logs a
  `console.error` at boot if `NODE_ENV=production` and this is still unset, but it does not block startup.
- **CORS**: set `PUBLIC_ORIGINS` to your real deployed domain(s) — without it, `server/src/index.ts` falls back
  to reflecting any request origin, which is broader than a same-origin production deploy needs.
- **Uploads persistence**: `server/uploads/` (path configurable via `DATA_DIR`) needs to live on a
  persistent volume — most container/PaaS hosts wipe local disk on redeploy/restart. Mount a volume, or
  swap `multer`'s disk storage for an object store (S3, R2, etc.) if you need durability across redeploys.
- **SMTP credentials**: without them, booking/registration confirmation emails silently become
  console-log lines instead of real emails — set `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` for real delivery.

---

## Scripts reference

| Command (run from repo root) | What it does |
|---|---|
| `npm install` | Installs dependencies for both workspaces |
| `npm run dev` | Runs API (`:3001`) + client dev server (`:5173`) concurrently |
| `npm run build` | Builds server (`server/dist`) then client (`client/dist`) |
| `npm start` | Runs the built server (`node dist/index.js`), which also serves the built client — production |
| `npm run dev --workspace server` | API only, with hot reload (`tsx watch`) |
| `npm run dev --workspace client` | Client only (Vite dev server) |
| `npm run preview --workspace client` | Serves the built client bundle locally, for a quick prod-build smoke test |

---

## Notes

- Guests never create an account — "My bookings" is scoped by a random id the client generates and stores
  in `localStorage`, sent as an `X-Client-Id` header.
- Booking availability is derived from real rows in the `bookings` table (a room/date/time slot is blocked
  once something else has been booked over it).
- New vendor listings (and new vendor accounts) go in as `pending` and need admin approval before they're
  publicly visible — see [`docs/roles-and-flows.md`](docs/roles-and-flows.md) for the full moderation flow.
