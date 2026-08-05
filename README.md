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

The client has no build-time env vars — it talks to `/api` and `/uploads` as relative paths, proxied to the
API in dev (`client/vite.config.ts`) and expected to be reverse-proxied the same way in production.

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
  seeded default, especially if the database is reachable from any IP.
- **CORS**: lock `cors({ origin: true, ... })` in `server/src/index.ts` down to your real origin, since same-origin
  deployment no longer needs it permissive.
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
