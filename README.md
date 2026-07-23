# Hello Circle

Community centres & sports clubs guide for Ireland — book a hall, register your kid for a club, and (for
vendors/admins) manage listings, bookings and moderation.

A React (Vite + TypeScript) client and a Node.js (Express + TypeScript + SQLite) API, run as an npm
workspaces monorepo.

---

## Tech stack

| Layer | Stack |
|---|---|
| Client | React 18, React Router 6, TypeScript, Vite 6 (no CSS framework — hand-rolled styles in `theme.ts`/`index.css`) |
| Server | Node.js (ESM), Express 4, TypeScript, `better-sqlite3` (file-based SQLite, no external DB server) |
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
    ├── hello-circle.sqlite    # SQLite database file — created + seeded automatically on first run
    ├── uploads/                # user-uploaded listing photos (local disk)
    └── src/
        ├── index.ts           # app entry: middleware, route mounting, listen()
        ├── auth.ts            # session cookies, password hashing, requireVendor/requireAdmin guards
        ├── email.ts           # SMTP sender (nodemailer) with dev console-log fallback
        ├── notifications.ts   # in-app notification log + email fan-out on booking/registration
        ├── util.ts            # shared helpers (client-id parsing, ref generation, error types)
        ├── types.ts           # server-side domain types
        ├── db/
        │   ├── index.ts       # SQLite connection, schema (CREATE TABLE), column migrations
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

No external database or services are required to run locally — SQLite is a file on disk, and email falls
back to console logging if SMTP isn't configured.

---

## Getting started (local dev)

```bash
npm install       # installs both workspaces (client + server) from the repo root
npm run dev        # starts the API on :3001 and the client on :5173 (Vite proxies /api + /uploads to it)
```

Open the client URL printed in the terminal (usually **http://localhost:5173**).

On first run, the server:
- creates `server/hello-circle.sqlite` and seeds it with sample centres/clubs
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
| `SMTP_HOST` | no | SMTP server hostname (e.g. `smtp.gmail.com`). Without this + `SMTP_USER`/`SMTP_PASS`, emails are **logged to the console** instead of sent — the app still works fully. |
| `SMTP_PORT` | no (default `587`) | SMTP port |
| `SMTP_USER` | no | SMTP auth username |
| `SMTP_PASS` | no | SMTP auth password. **For Gmail/Google Workspace, this must be an [App Password](https://myaccount.google.com/apppasswords), not the account's normal login password** — SMTP auth is rejected otherwise once 2-Step Verification is on. |
| `MAIL_FROM` | no (falls back to `SMTP_USER`) | The "from" address on outgoing mail |
| `HELLO_CIRCLE_ADMIN_EMAIL` | no (default `admin@hellocircle.ie`) | Email of the auto-seeded admin account |
| `HELLO_CIRCLE_ADMIN_PASSWORD` | no (default `changeme123`) | Password of the auto-seeded admin account — **change this before any real deployment** |

The client has no build-time env vars — it talks to `/api` and `/uploads` as relative paths, proxied to the
API in dev (`client/vite.config.ts`) and expected to be reverse-proxied the same way in production.

---

## Data & notifications

- **Database**: a single SQLite file (`server/hello-circle.sqlite`), created and migrated automatically on
  startup (`server/src/db/index.ts`) — no separate migration step to run.
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

Run the built server with `npm run start --workspace server` (runs `node dist/index.js`); it still needs
`server/.env` and `server/hello-circle.sqlite` alongside it, and reads `PORT` from the environment.

---

## Deployment guide

The app is two separately-buildable pieces — a static client bundle and a Node API — so pick one of two
shapes:

### Option A — single combined deployment (simplest)

Serve the built client as static files from the same Express server, so the whole app is **one process, one
origin**. This avoids all cross-origin cookie/CORS complexity, since the session cookie is `httpOnly` +
`sameSite: lax` with no `secure` flag set — which works cleanly same-origin, but needs care cross-origin
(see Option B). This repo doesn't wire static-serving in yet; to add it:

```ts
// in server/src/index.ts, after the API routes:
app.use(express.static(path.join(__dirname, "../../client/dist")));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "../../client/dist/index.html")));
```

Then deploy the whole repo to any Node host (Render, Railway, Fly.io, a VPS, etc.), run `npm install && npm
run build`, and start with `node server/dist/index.js`.

### Option B — separate client/server deployments

- **Client**: deploy `client/dist` (static output) to any static host (Vercel, Netlify, Cloudflare Pages,
  S3+CDN, …).
- **Server**: deploy `server/` to a Node host as above.
- **Reverse-proxy `/api` and `/uploads`** from the client's domain to the server (e.g. a Vercel rewrite, or
  an Nginx/Caddy proxy) so the browser sees everything as same-origin — this is what keeps the session
  cookie working without touching its `sameSite`/`secure` flags.
- If you *can't* proxy and the client/server genuinely live on different origins, you'll need to change the
  session cookie to `sameSite: "none"; secure: true` (`server/src/routes/auth.ts`) and set CORS to the
  client's exact origin instead of the current `cors({ origin: true, credentials: true })` (which reflects
  *any* origin — fine for local dev, too permissive for production).

### Things to change before a real deployment

- **Admin password**: set `HELLO_CIRCLE_ADMIN_PASSWORD` (and ideally `HELLO_CIRCLE_ADMIN_EMAIL`) — don't ship the
  seeded default.
- **CORS**: lock `cors({ origin: true, ... })` in `server/src/index.ts` down to your real client origin(s).
- **SQLite file persistence**: `server/hello-circle.sqlite` must live on a persistent volume — most container
  platforms wipe local disk on redeploy/restart. Mount a volume at the server's working directory, or
  point the DB path at one (`server/src/db/index.ts`).
- **Uploads persistence**: same issue as above for `server/uploads/` — mount a persistent volume, or swap
  `multer`'s disk storage for an object store (S3, R2, etc.) if you need durability across redeploys.
- **SMTP credentials**: without them, booking/registration confirmation emails silently become
  console-log lines instead of real emails — set `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` for real delivery.

---

## Scripts reference

| Command (run from repo root) | What it does |
|---|---|
| `npm install` | Installs dependencies for both workspaces |
| `npm run dev` | Runs API (`:3001`) + client dev server (`:5173`) concurrently |
| `npm run build` | Builds server (`server/dist`) then client (`client/dist`) |
| `npm run dev --workspace server` | API only, with hot reload (`tsx watch`) |
| `npm run dev --workspace client` | Client only (Vite dev server) |
| `npm run start --workspace server` | Runs the built server (`node dist/index.js`) — production |
| `npm run preview --workspace client` | Serves the built client bundle locally, for a quick prod-build smoke test |

---

## Notes

- Guests never create an account — "My bookings" is scoped by a random id the client generates and stores
  in `localStorage`, sent as an `X-Client-Id` header.
- Booking availability is derived from real rows in the `bookings` table (a room/date/time slot is blocked
  once something else has been booked over it).
- New vendor listings (and new vendor accounts) go in as `pending` and need admin approval before they're
  publicly visible — see [`docs/roles-and-flows.md`](docs/roles-and-flows.md) for the full moderation flow.
