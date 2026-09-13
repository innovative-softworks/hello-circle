# Deploying to Hostinger (Cloud/Business hosting, hPanel Node.js app manager)

This targets Hostinger **Cloud/Business hosting** using hPanel's built-in Node.js app manager
(Passenger-based). That manager only does a basic `npm install` + process supervision — it doesn't
understand npm workspaces and won't run the TypeScript/Vite build, so the build happens over SSH and
hPanel is only used to run the already-built server.

If this app outgrows shared/cloud hosting (heavier traffic, need for background workers, more control over
process management), a Hostinger KVM VPS with PM2 + Nginx is a more robust next step — same Node/MySQL
stack, just without Passenger's constraints.

## Prerequisites

- SSH access enabled (hPanel → Advanced → SSH Access)
- A domain/subdomain pointed at the hosting account
- Stripe live keys, if payments are going live

## 1. Create the MySQL database

hPanel → Databases → MySQL Databases → create a database + user. Note the **exact host** hPanel shows for
it — on Cloud/Business this is often not literally `localhost`.

## 2. Get the code onto the server

```bash
ssh <user>@<host>
git clone <repo-url> ~/hello-circle
cd ~/hello-circle
```

## 3. Install + build from the repo root

Must run from repo root (not `server/`) because of the npm workspaces — `client` depends on
`packages/types` / `packages/design-tokens`.

```bash
npm install
VITE_LAUNCH_MODE=public npm run build
```

`VITE_LAUNCH_MODE=public` is required for a real public launch — without it every route redirects to
`/coming-soon` (`client/src/App.tsx`). Leave it unset for a staging/preview deploy.

If going public for real, also remove the `noindex` tag in `client/index.html` and the `Disallow: /` in
`client/public/robots.txt` before this build.

## 4. Write `server/.env` on the server

Not committed — create it fresh on the box:

```
NODE_ENV=production
PORT=3001
DB_HOST=<host from hPanel's MySQL page>
DB_PORT=3306
DB_USER=u123456_xxx
DB_PASSWORD=...
DB_NAME=u123456_hellocircle
CLIENT_URL=https://yourdomain.com
PUBLIC_ORIGINS=https://yourdomain.com
HELLO_CIRCLE_ADMIN_EMAIL=you@yourdomain.com
HELLO_CIRCLE_ADMIN_PASSWORD=<real password, not changeme123>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
# optional: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM for real outgoing email
```

`STRIPE_WEBHOOK_SECRET` is required once `NODE_ENV=production` is set — the webhook route refuses
unverified events without it.

`CLIENT_URL` / `PUBLIC_ORIGINS` must exactly match the final `https://` domain — Stripe redirect URLs and
CORS both depend on it.

## 5. Configure the Node.js app in hPanel

hPanel → Advanced → Node.js → Create application:

- **Application root**: `hello-circle/server` — not the repo root. Passenger sets cwd to this path, and
  `dotenv/config` looks for `.env` relative to cwd, so this is what makes it find `server/.env`.
  `server/package.json` already has `"type": "module"`, so ESM output works from here.
- **Application startup file**: `dist/index.js`
- **Node version**: newest available (20.x)
- Do **not** use hPanel's own "Run NPM install" for this app — install/build already happened from the
  repo root in step 3; re-running install scoped to `server/` alone will conflict with the
  workspace-hoisted `node_modules`.
- Save and start the app.

## 6. Uploads persistence

`DATA_DIR` defaults to the server package folder, so uploads land in `~/hello-circle/server/uploads` — this
is normal persistent disk on shared/cloud hosting, no extra config needed.

## 7. Domain + SSL

Point the domain/subdomain at this Node app in hPanel; it should provision free SSL (Let's Encrypt)
automatically.

## 8. Stripe webhook

In the Stripe dashboard, add an endpoint at `https://yourdomain.com/api/stripe/webhook`, subscribe to the
checkout/session events in use, copy the signing secret into `STRIPE_WEBHOOK_SECRET` (step 4).

## 9. First boot checklist

- Tail logs via hPanel's Node.js log viewer, confirm no DB connection errors during `initSchema()` +
  seeding.
- Log in as the seeded admin (`HELLO_CIRCLE_ADMIN_EMAIL` / `HELLO_CIRCLE_ADMIN_PASSWORD`) and change the
  password immediately if it was left at a default.
- Do a real end-to-end booking/checkout against Stripe test mode before flipping to live keys.

## Redeploying

```bash
ssh <user>@<host>
cd ~/hello-circle
git pull
npm install               # only if dependencies changed
VITE_LAUNCH_MODE=public npm run build
```

Then hit **Restart** on the app in hPanel — Passenger will not pick up a new `dist/` on its own.
