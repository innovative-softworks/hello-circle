# 01 — Current-state architecture and payment flow

Audit date 2026-10-09. Branch `feature/commerce-engine` (local, unpushed): `staging` @ `544e663` plus five
commits (`9e488ac`…`698a444`) from the earlier Commerce Engine brief. **No code, schema or Stripe call was made for
this audit.** Earlier evidence is in `docs/commerce-*.md` and isn't repeated here.

## A. Repository architecture

| Area | Finding | Evidence |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript, one page per route, Capacitor wrapper | `client/package.json`, `client/capacitor.config.ts`, `client/src/App.tsx` |
| Backend | Express 4 + TypeScript (tsx in dev, tsc build) | `server/package.json`, `server/src/index.ts` |
| Database | MySQL 8 through the hand-rolled `mysql2` shim (no ORM). Additive `ensureColumn` migrations at boot. **No foreign keys anywhere.** Money is `INT` cents, except `rooms.rate`, `clubs.price` and `centres.from_price` (whole euros) | `server/src/db/index.ts` |
| Auth | Vendor/admin: bcrypt and session cookie. Residents: magic link, password, Google (Firebase) or Bearer. Guests: `X-Client-Id` | `auth.ts`, `guestAuth.ts`, `residents.ts` |
| RBAC | `users.role` is `vendor` or `admin`. Vendor staff get `platform_role` (`finance`, `centre_manager`, …). **Admin has no sub-roles**: there is no finance, support or legal admin | `auth.ts:requirePlatformRole`, `routes/admin.ts` (`requireAdmin`) |
| Booking model | Five separate participation tables (`bookings`, `registrations`, `program_enrollments`, `game_participants`, `experience_bookings`) plus `passes` | `docs/commerce-current-state-map.md` §2 |
| Vendor/host model | Vendors are `users` in an `organisations` org (`orgVendorIds`). Hosts are residents with `host_status='verified'`. Manage bridges the two | `CLAUDE.md`, `routes/manage.ts` |
| Payment provider | One platform Stripe account and Stripe Checkout (`mode: payment`), plus a network-free QA stub (`qaProviderStubEnabled`). **No Stripe Connect** | `checkoutService.ts:32-40` |
| Webhooks | `/api/stripe/webhook`, raw body, signature required when the secret is set. Handles only `checkout.session.*`. **No event store** | `routes/stripeWebhook.ts` |
| Refunds | Full refunds only, row-locked, idempotency key `hc-refund-<session>`, reconciles external full refunds | `checkoutService.ts:refundPaidOnce` |
| Cancellation | Status-only. Per-org cut-off (`org_policies.cancellation_hours`). Refunds are a separate finance action | `selfCancel.ts`, `routes/*` cancel routes |
| Subscriptions | **None.** `users.provider_tier` is admin-assigned and only drives a badge | `auth.ts:64` |
| Coupons | Admin, vendor and host coupons with funding, limits, archive and a redemption ledger (built in Phase 3 of the earlier brief) | `pricing.ts`, `bookingIntegrity.ts`, `coupon_redemptions` |
| Credits / wallet | **None** (passes are prepaid session packs, not credit) | `routes/passes.ts` |
| Rewards | **None** | — |
| Email | nodemailer. Without SMTP, delivery is disabled (no content is logged) | `email.ts` |
| Notifications | `notifications` table (vendor/admin/resident), push via Firebase | `notifications.ts`, `push.ts` |
| Policy/legal pages | Static `PrivacyPolicy.tsx` (`/privacy`) and `CookiePolicy.tsx` (`/cookies`) with **visible placeholders** (`[Company Legal Name]`, `[Registered Address, Ireland]`, `[privacy@yourdomain.ie]`). **There is no Terms page**, yet signup says "I agree to … Privacy Policy and Terms" and records `terms_accepted_at` and `terms_version` (an env string) | `client/src/pages/PrivacyPolicy.tsx:40-41`, `components/MagicLinkCompleteAccount.tsx:90-95`, `server/src/terms.ts` |
| Help | Static help guide pages (`/help-guide/*`), not editable | `client/src/pages/helpGuide/` |
| Admin tools | Admin dashboard: moderation, reports (with case view), audit log, coupons, commercial rules, orders, shadow pricing | `pages/AdminDashboard.tsx`, `components/AdminCommerce.tsx` |
| Tests | Server Vitest in an isolated Docker MySQL (58 files, 597 tests). Client Vitest (16 files, 105 tests). Guarded `qa:*` integration harness (Stripe test mode only). GitHub "Web CI" | `server/TESTING.md`, `.github/workflows/web-ci.yml` |
| Env handling | `.env` and `.env.*` gitignored. Templates in `deploy/staging/*.env.template`. **No secrets in tracked files** (`git grep` for `sk_live/sk_test/whsec_` found nothing) | `.gitignore`, `git ls-files` |
| Deploy/migrations | Single-origin Node process. Schema migrates on boot (`initSchema`). Staging and prod on one VPS. Nightly DB backups with a passed restore drill | `DEPLOY.md`, memory: prod backups |

## B. Already built on this branch (earlier brief, reusable)

| Piece | Reuse in this programme |
|---|---|
| `commerce_rule_versions` and the resolver (global → scenario → category → partner, effective-dated, draft → approved → published, rollback, audit with a reason) | Base of the versioned configuration service. Needs `review`, `scheduled` and `retired` states (§17 of the new brief) |
| `server/src/commerce/money.ts` (integer bps maths, half-up rounding, `allocate()` largest-remainder) | Kept. A **second formula** (`pe-2`) is needed for the new fee model (§6) |
| Quotes, `commerce_orders`, `pricing_snapshots`, shadow pricing, Experiences on the engine behind switches | Kept. Snapshots gain tax-rule, plan and policy versions plus partner allocations |
| Coupon funding, limits and `coupon_redemptions` | Kept. Extended to the §13 field set (budget, stacking, eligibility, versions, approval) |
| Phase 0.5 hardening (R3 R4 R5 R8 R10 R14) | Done |

## C. Current payment flow (live on `staging`/prod; engine switches off)

```
Customer ──▶ resource route (bookings/registrations/programs/games/passes/experiences)
              │ price = list (+ coupon)  → pricing.ts computePricing():
              │   taxable = list − discount
              │   + VAT 23% on taxable  + 5% "platform fee" on taxable  (+ €100 deposit for online venue hire)
              │ row + coupon use reserved in one row-locked transaction (status pending)
              ▼
         checkoutService.createCheckoutSession()  ── Stripe Checkout on the PLATFORM account (metadata {type, ref})
              ▼
Stripe ──▶ POST /api/stripe/webhook (signature verified)
              │ checkout.session.completed / async_payment_succeeded → confirm*() → pending → paid (idempotent by row state)
              │ checkout.session.expired / async_payment_failed → endPendingHold() (releases coupon)
              ▼
         Money stays on the platform Stripe balance. NO transfer, NO payout record,
         NO ledger. Vendor/host settlement is manual and off-platform (checkoutService.ts:32-40).

Refund: vendor finance (or host, for games) → refundPaidOnce() → stripe.refunds.create (full only)
Cash/free: no Stripe; row inserted already paid.
```

Gap against the brief: today **the customer pays a 5% fee plus 23% VAT on top**, and the partner is notionally
owed the full list price. The brief requires **no customer fee, the displayed price is the price paid, and a 9%
(Free) or 7% (Pro) success fee plus VAT deducted from the partner**.

## D. Data-quality findings (summary; details in 04)

- Money columns are `INT` cents (OK up to €21M per row). Three whole-euro price columns exist (R11).
- There are no currency columns on legacy tables (EUR implied). The engine tables have `currency`.
- Duplicate Stripe event processing is protected only by row state; there is no `webhook_events` table.
- Financial records are mutable: `payment_status` is updated in place. Snapshots (engine only) are immutable.
- There are no foreign keys and few unique constraints beyond `ref`.
- There are no refund records (only `payment_status='refunded'`), no transfer/payout references and no
  reconciliation.
- Bookings, registrations and passes derive amounts in the frontend for display only; the server recomputes.
- Hardcoded rates remain in legacy paths (see 03).
