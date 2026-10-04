# HelloCircle — External integrations

## Phase 12 update — 2026-10-03 (current)

**Pre-consent third-party requests (privacy review — not a legal compliance claim):**

| Domain | Resource | Why | Essential? | Before consent? | Phase 12 |
|---|---|---|---|---|---|
| fonts.googleapis.com / fonts.gstatic.com | Bricolage Grotesque + Hanken Grotesk | App typography | No (can be self-hosted) | **Yes**, every page | **Removed.** Self-hosted via `@fontsource-variable/*` 5.3.0 (OFL-1.1); 0 Google Fonts requests (verified, PART-13-FONTS) |
| images.unsplash.com | 12 hot-linked photos (auth screens, Home hero, venue marketing, Header mega-menu, `placeholderImage.ts`) | Editorial imagery | No | **Yes**, on those pages | **Unchanged, documented.** Self-hosting needs each image's rights confirmed; not copied without that |
| www.googletagmanager.com | GTM | Analytics | No | No (consent-gated; `VITE_GTM_CONTAINER_ID`) | Unchanged |
| api.mapbox.com | Map tiles | Maps | Only on map views | Only when a map is shown | Unchanged |

Remaining concern: Unsplash hot-links still disclose visitor IP and referrer to Unsplash before consent. Recommendation: serve product imagery from HelloCircle-controlled media (R2) once rights are confirmed. `client/public/design-system.html`, an internal static design reference, still links Google Fonts.

**Stripe webhook policy:** signature verification is the default everywhere. Unsigned events are accepted only with `ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true` in local development; never when `NODE_ENV=production` or `APP_ENV` is staging or production. A clear startup warning appears when the unsafe mode is on. Covered by `server/src/stripeWebhookPolicy.test.ts`.

## Phase 11A update — 2026-10-03

- **Stripe refunds (HC-QA-091, Policy A):** fixed. External full refunds reconcile without a second refund; partial refunds are refused safely. Verified with real TEST payments across all 5 models (`stripe-refund-external` batch).
- **Stripe gate intermittency:** see HC-QA-095.
- **Analytics:** `VITE_GTM_CONTAINER_ID` (HC-QA-093). Staging must use `off` or a staging container.
- **Server unit tests:** never use provider credentials. Live-provider tests are gated behind `HC_LIVE_PROVIDER_TESTS=1` and require a staging/test bucket name.
- **Staging provider isolation requirements:** `QA_STAGING_PROVISIONING.md` §6.

## Phase 11 update — 2026-10-03

No staging environment exists (see `QA_STAGING_ENVIRONMENT.md`), so every "staging" item below was run on an **isolated local production-build stack** where that was safe. The stack:
- the production client bundle, served single-origin by the Node server;
- a throwaway tmpfs MySQL container;
- Mailpit on loopback;
- backend outbound limited to the DB, Mailpit and, for the Stripe run only, `api.stripe.com:443`.

**Stripe (TEST mode, real Stripe-delivered webhooks): PASS, with one P2 finding.**

`livemode=false` was asserted before the backend started. The Stripe CLI `listen` forwarded real Stripe events to `/api/stripe/webhook`. Its signing secret was short-lived, held in a 0600 file that was deleted after the run, and redacted from logs.

| Check | Result |
|---|---|
| Paid booking with a single-use 10% coupon, hosted Checkout, test card | `checkout.session.completed` delivered → **200**. Booking `paid`/`confirmed`. `total_cents` 14608 equals Stripe `amount_total` 14608 EUR. Coupon used 1×. 2 notifications. Return path `/payment/success` |
| Real redelivery of the same event (`stripe events resend`) | Delivered again, 4 log lines for the event. **No state change**: payment, status, total, slot count, coupon use and notifications were all identical |
| Expiry (`checkout.sessions.expire`) | `checkout.session.expired` delivered. Booking `payment_status=failed`. The **slot was released**: the same slot rebooked 201 |
| Refund through HelloCircle (vendor finance) | 200. Stripe shows 1 refund of 14608 EUR, `succeeded`. Booking `refunded`. 1 audit row. A second refund returns **409** with no second Stripe refund |
| Refund outside HelloCircle (Stripe API, i.e. a Dashboard refund) | `charge.refunded` delivered, **200 but ignored**. The booking stays `paid`/`confirmed` and its slot stays held. A later HelloCircle refund returns **502 "try again"** forever. No double refund. → **HC-QA-091 (P2)**; policy decision below |
| Emails produced (Mailpit) | Booker: confirmation and refund. Vendor: new booking and refund. Admin: new booking. Links use `CLIENT_URL` only. No token-bearing content |

**Not done:** delivery to a public HTTPS staging endpoint, and Stripe's own automatic retry after a non-2xx response. Both need a staging URL registered as a Stripe webhook endpoint.

**Refund reconciliation decision (yours).** Recommendation: **Policy A**, all refunds inside HelloCircle, plus making `refundCheckoutSession()` reconcile Stripe's `charge_already_refunded` to `refunded` with an "external refund" audit, so an accidental Dashboard refund self-heals instead of failing. Policy B would need `charge.refunded` and partial-refund reconciliation across all five participant tables.

**Mapbox (production bundle, real token from `client/.env`, never printed): PASS.**
- `/adventures` map view, desktop and mobile:
  - a real Mapbox canvas loads (17 and 11 `api.mapbox.com` responses, all OK);
  - the 5 Dublin listings cluster as "5", and the Galway listing shows as a pin;
  - a listing with **no coordinates** is correctly left off the map and still appears in the list view (7 cards).
- The experience detail map (opened with "View map", a cost-control lazy load) shows the pin and popup, and "Get directions" is present.
- **Provider failure** (Mapbox requests aborted): "Map failed to load — browse the list instead.", the list stays usable, no page errors.
- Telemetry (`events.mapbox.com`) was blocked during the test.
- P3 note (not recorded): the header says "7 adventures" while 6 pins show, with no "1 not on map" hint.

**Geocoding (public Nominatim, 2 requests through the app's own router):** "Glendalough, Wicklow" returned 2 results, the first at 53.0108 / -6.3263, in about 1.8 s. A nonsense query returned an empty list (200) in about 1.6 s. The app's queue limits it to 1 request/second and sends an identifying User-Agent.

**Analytics consent (production bundle):**

| Choice | Tracker requests |
|---|---|
| No choice yet | 0 |
| "Necessary only" | 0 (also after navigating) |
| "Accept" | `www.googletagmanager.com` requested |

Before consent, `dataLayer` holds one in-memory event (`vendor_landing_viewed`) and nothing leaves the browser. This is the existing Phase 10 decision item. GTM container contents were not verified, since they need GTM preview access.

**Still BLOCKED, needing isolated staging credentials:**
- Firebase/Google sign-in: only one apparently-production Firebase project exists;
- R2 cloud uploads, variants and AVIF: only one shared bucket;
- real staging email delivery and SPF/DKIM: only one shared Gmail sender.

**Logs:**
- No secret appeared in any backend log or result file.
- One Stripe CLI banner line (its short-lived local signing secret) was redacted in the scratchpad.
- The only backend outbound block was the deliberately dead geocoder port.

## Phase 10A update — 2026-10-03

**Email (local sandbox):** vendor application acknowledgement and approval emails now exist (HC-QA-058). They were verified two ways:
- the guarded harness (QA mail observer, safe facts only);
- a real local Mailpit SMTP sink: 1 acknowledgement + 1 approval across 3 approve calls, correct recipient, `CLIENT_URL/login` link, no token-bearing content.

The backend log contained no secrets. Staging delivery remains BLOCKED.

**Media (local mode):** resident uploads now work without R2 (HC-QA-062). Files are magic-byte validated and stored locally after the per-entity permission check. Restricted Circle covers are kept out of the public path and streamed only after membership checks. The cloud R2/AVIF pipeline remains BLOCKED (separate staging integration).

**Stripe:** 26/26 on the first attempt after remediation.

OAuth and Maps are unchanged (BLOCKED / NOT CONFIGURED).

## Phase 10 baseline (historical)

Only isolated local infrastructure and approved test sandboxes were used. No live keys, no production database, no real customer messages.

| Integration | Status | What was verified | What remains |
|---|---|---|---|
| **Stripe (TEST mode)** | **PASS** | `npm run qa:stripe` **26/26** on the third run. Run 1 timed out starting the backend; run 2 timed out waiting for Stripe's hosted page to load. Both were external timeouts with no assertion failure, and the app had redirected correctly to checkout.stripe.com. Covers signatures, amount integrity, expiry, concurrency, hosted payments, refunds, return URLs, HC-QA-048/049/050/051. In the UI with no provider configured: "Payments aren't configured yet" (understandable) | Real Stripe webhook delivery to a staging endpoint (existing gap). The hosted-page timeout suggests raising that test's navigation timeout |
| **Email** | **PASS (local SMTP sandbox) / BLOCKED (staging delivery)** | A local Mailpit container (isolated, loopback) received: resident "Confirm your email" (×3 signups), magic link, resident reset, vendor reset. Recipients correct. Links point to `CLIENT_URL`. Expiry stated (reset 30 min, magic link 15 min, single use). Unknown-email reset sends nothing and returns 200 (no enumeration). Server logs contain 0 token-bearing strings | No vendor signup or approval email exists (058). Two concurrent magic links both valid (087). Booking/cancellation emails NOT VERIFIED (paid paths need Stripe; free activity join intentionally sends none). Staging domain and deliverability (SPF/DKIM) BLOCKED: no staging |
| **OAuth (Firebase / Google)** | **BLOCKED** | Firebase is not configured in isolation. The UI degrades gracefully: "Google sign-in isn't available right now — please use email instead." Apple is placeholder-only ("coming soon", 082) | New and existing Google users, account linking, logout/re-login and session persistence need a staging Firebase project |
| **Media (R2 / Cloudinary / local AVIF)** | **BLOCKED (cloud pipeline) / FAIL (local fallback for residents)** | Local mode: vendor JPEG/PNG/large uploads accepted (stored raw). Resident host uploads fail: 503 → 503 → 401 fallback (062). The local fallback trusts the client MIME type (084). The Circle-cover protected endpoint design was code-reviewed only | Real uploads with JPEG/PNG/WebP/HEIC/large to staging R2, variant/AVIF generation, replace/delete, private Circle cover authorization (403 for non-members) |
| **Maps (Mapbox)** | **NOT CONFIGURED** | With maps disabled, map UI is hidden and list views remain usable; "Get directions" link present. No geocoding traffic (geocoder pointed at a dead local port) | Explore map, clusters, zoom/pan, pin selection, mobile map, missing/invalid coordinates, provider failure: need an approved Mapbox test token |
| **Analytics (GTM)** | **PASS (consent gating)** | Before consent: no GTM request, empty dataLayer. "Necessary only": no GTM. "Accept": `gtm.js` requested. The choice can be changed at `/cookies` ("Change my cookie choice"). Pre-consent events queue in memory only and nothing leaves the browser (by design; sent if the user later accepts on the same page load: decision item) | GTM container tags and event names (signup, login, join, Circle join, payment success) need a GTM preview/debug session. Google Fonts loads before consent (privacy decision) |

## Safety record

- Backend outbound was restricted to the exploration MySQL and the local SMTP sink. No blocked-outbound attempts were logged.
- The browser blocked every non-local host except placehold.co and Google Fonts (static assets), and Stripe hosts in the Stripe gate.
- The Stripe test key was read only by the existing guarded `qa:stripe` profile (key in `~/.config/hellocircle-qa`, never printed).
