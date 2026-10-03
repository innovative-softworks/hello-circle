# HelloCircle QA Audit

**Checkpoint:** 1 — repository audit only  
**Audit date:** 2026-09-27  
**Scope:** Static repository inspection. No packages installed, services started, database queried, external APIs called, or automated tests executed.

## Executive Summary

HelloCircle is an npm-workspaces TypeScript monorepo containing a React 18/Vite SPA and a Node/Express/MySQL API. It is substantially broader than the older top-level README suggests: the current implementation includes separate resident and vendor/admin identities, Google authentication through Firebase token verification, discovery/search, centres, clubs, games, programs, experiences, Circles, guest and resident transactions, Stripe Checkout/webhooks, Mapbox, notifications/chat, vendor operations, administration, and a multi-provider media pipeline.

The repository has a valuable Vitest base (11 client test files, 45 server test files, approximately 567 `it`/`test` declarations at audit time), with unusually strong route-level coverage for payment confirmation/idempotency, Circle visibility, consent, Google-account behavior, media, vendor operations, and concurrency. It has no Playwright or Cypress E2E suite, no browser-level user-journey coverage, no general web CI, no accessibility automation, and no isolated E2E/test-data environment contract.

Automation should not begin against the current default database configuration. Server Vitest uses a real MySQL database and performs cleanup; its setup blocks the literal `hello_circle` database but still permits any other configured database. A dedicated disposable `hello_circle_e2e` (or equivalent), deterministic seed/reset mechanism, Stripe test-mode account, isolated media prefix/bucket, and explicit production guard are prerequisites.

The first five P0 journeys derived from the actual application are:

1. **QA-001 — Resident authentication and session boundaries:** password/magic-link or safely stubbed Google completion, refresh persistence, logout, protected resident APIs, and expired sessions.
2. **QA-002 — Resident account setup/onboarding:** first sign-in opens `AccountSetupGate`, required/optional data behavior, skip/resume, refresh, and completion persistence. (`/onboarding` itself redirects to `/bookings?setup=1`.)
3. **QA-003 — Discovery to a public activity/listing detail:** `/home` or `/explore` → search/filter → centre, club, game, program, or experience detail; only public/published data may appear.
4. **QA-004 — Transaction integrity:** a real implemented paid path (initially centre booking) → Stripe **test** Checkout → webhook → confirmation/status/My Life, including duplicate submission and duplicate-webhook protection.
5. **QA-005 — Host/vendor publication:** authenticated vendor/host workspace → create an implemented listing/activity (initially a vendor experience or centre/club draft) → edit → submit/publish/approve as the actual state model requires → verify the public detail. The product does not expose one generic “activity” entity, so the test must follow the concrete entity workflow.

## Repository and Application Architecture

| Area | Observed implementation | QA implication |
|---|---|---|
| Repository | npm workspaces: `client`, `server`, `packages/types`, `packages/design-tokens`; `package-lock.json` | Use npm and place Playwright at the root unless implementation constraints emerge. |
| Frontend | React 18, React Router 6, Vite 6, TypeScript; hand-rolled CSS/theme | Browser coverage must account for SPA navigation, lazy routes, responsive chrome, and launch gates. |
| Backend | Node ESM, Express 4, TypeScript | Playwright API fixtures can seed through purpose-built test endpoints or a test-only DB helper. |
| Database | MySQL/MariaDB via `mysql2`; schema/migrations are initialized in server code | E2E must use a separate database. Parallel workers need isolated data namespaces or worker schemas. |
| Public routing | Home/discovery, centres, clubs, games, programs, experiences, Circles, county/activity SEO pages | Smoke coverage must use concrete seeded IDs/slugs and public states. |
| Identity | Four mechanisms: vendor/admin cookie user, resident cookie identity, verified guest email, anonymous `X-Client-Id` | Do not model auth as a single role. Maintain separate storage states and negative API tests per identity. |
| Authorization | Server middleware plus resource ownership/organiser/platform-role checks | UI redirects are insufficient; P0 checks must call protected APIs directly. |
| Payments | Shared Stripe Checkout service for bookings, registrations, games, programs, passes, experiences; raw webhook route; server-side pricing | Use Stripe test mode only; assert DB-visible state after webhooks and idempotency. |
| Google auth | Firebase client SDK; server verifies Firebase ID tokens; explicit completion/linking rules | Do not automate Google UI. Stub/fixture token verification only in an isolated test mode and retain manual provider smoke. |
| Maps/geocoding | Mapbox GL client; Nominatim-compatible server geocoder; app kill switch | Mock external tiles/geocoding for most tests; keep one controlled integration check. |
| Media | Local upload, Cloudflare R2, optional Cloudinary editorial assets; `sharp`, HEIC conversion, variants/quotas | Test by provider mode. Use isolated object prefixes and never production buckets. |
| Notifications | In-app/email/push and chat; SMTP fallback logs in development; Firebase Admin push | Use a mail sink and fake push adapter in E2E. Assert persisted notifications, not third-party delivery. |
| Analytics/logging | First-party analytics modules/events observed; console/server logging | No dedicated error-monitoring SDK was identified in the inspected dependencies. Add test-side console/network collection. |
| Mobile | Capacitor dependencies and one `mobile-ci.yml` | Web Playwright does not replace native-device QA. Existing workflow references `apps/mobile`, which is not present in the audited file inventory and needs validation. |
| Launch/SEO gates | `VITE_LAUNCH_MODE`; server-generated robots/sitemap/OG handling | Test both prelaunch and public modes. Current default fails closed to prelaunch. |

## Existing QA Architecture

### Automated testing

- Vitest is configured separately in client and server workspaces and invoked by root `npm test`.
- Client coverage is primarily pure logic/helper regression testing (redirects, activity status, participation language, media URL behavior, favourites, notifications, prices, and related helpers). No React component/browser testing library is declared.
- Server coverage is largely route/integration based and uses real MySQL for transaction, row-lock, and concurrency behavior.
- High-value existing server suites cover Circle join/visibility authorization, Google identity linking, vendor signup/approval, account linking, Stripe webhook idempotency, payment confirmation payloads, registrations/capacity, media authorization/processing, reviews, consent, sharing, reports, chat, and vendor operations.
- `server/vitest.setup.ts` reportedly rejects an unset DB name and the literal production name `hello_circle`. Test rows use namespaced IDs and per-file cleanup, but interrupted runs can leave rows behind.
- There is no Playwright configuration, E2E directory, browser fixture layer, saved storage states, accessibility library, or HTML E2E report.
- The `@vitest/browser-playwright` string in the lockfile is an optional/transitive Vitest package reference, not an installed/configured Playwright suite.

### CI/CD and deployment

- Only `.github/workflows/mobile-ci.yml` was found. It is path-filtered and does not build or test the client/server web application.
- No web PR workflow, E2E workflow, staging post-deploy workflow, Cypress configuration, Docker/Compose test environment, or checked-in staging contract was identified.
- Local environment files exist under `server/` and `client/`; they were not opened and their values were not exposed. No `.env.test.example` exists.
- Environment documentation is extensive, but the top-level README contains stale simplifications (for example “no third-party auth provider” and local-disk-only uploads) that no longer describe the code.

### Selectors and accessibility affordances

- The UI contains useful semantic roles, labels, and many `aria-label` attributes, especially for navigation, dialogs, maps, chat, calendars, media controls, and icon-only buttons.
- No systematic `data-testid` convention was found. That is acceptable: role/label/text selectors should remain primary.
- Browser coverage is required to determine whether custom controls, focus management, errors, and responsive interactions are actually accessible.

## Current Test Coverage

### Meaningfully covered at route/unit level

- Capacity and concurrent registration/game joins.
- Stripe webhook confirmation idempotency for selected transaction types.
- Confirmation/status response data for multiple transaction types.
- Google resident/vendor/admin resolution, completion, collision, and explicit linking.
- Vendor signup → pending → admin approval → authorized access.
- Circle join modes, membership, organiser-only actions, private-field and image redaction, polls, and plan-to-activity concurrency.
- Consent enforcement, resident password signup, account linking, invitations, favourites, reviews, reports, chat, vendor listings/operations/schedules/insights, media endpoints, and selected lifecycle rules.
- Pure client business helpers and navigation-link construction.

### Missing or not demonstrated

- Browser-level smoke, authentication, onboarding, discovery, booking, payment-return, publication, admin, vendor, Circle, and profile journeys.
- Real client/server contract coverage in a browser; current route tests usually mount routers with test middleware.
- Cross-role storage-state fixtures and systematic negative RBAC matrix.
- Full payment lifecycle for every transaction type, including browser duplicate submit, delayed/failure events, abandoned Checkout, and reconciliation.
- Visual/responsive coverage at 1440×900 and 390×844.
- Keyboard/focus/dialog checks and automated accessibility scanning.
- Console error, uncaught exception, and unexpected network-response policy.
- SEO assertions across public, draft, private, account, and launch-gated pages.
- Controlled Mapbox/Nominatim failure and relationship tests.
- End-to-end media persistence and variant display across supported formats/providers.
- Performance budgets or request-count checks.
- Web CI and staging smoke execution.

## Critical Gaps and Risks

Risk priority here means “must be protected/verified”; it does not claim a product defect unless explicitly labeled.

### P0 — release blocker/security/data/payment

| Risk | Evidence / reason | Required verification |
|---|---|---|
| No safe E2E environment boundary | Local envs exist; no staging or E2E contract was identified. Existing server tests touch real MySQL. | Dedicated DB, test-only credentials, hostname/DB/Stripe/media guard, and deterministic reset before browser automation. |
| Transaction consistency across six purchase types | Shared Checkout exists, but callers own pending-row lifecycle; only selected idempotency is covered. | Server-side pricing, capacity lock, paid-before-confirmed, duplicate submit/webhook, async success/failure, expiry, and reconciliation tests. |
| Authorization spans four identity systems | Vendor/admin, resident, verified email, and anonymous client ID have different powers. | API-negative matrix plus UI route behavior; ensure one identity cannot be confused for another. |
| Private Circle data/media leakage | Existing regressions show this area has required hardening; strong route tests exist but no deployed/browser check. | Guess IDs as guest/non-member/invited user; verify detail, subresources, chat, members, polls, plans, and asset URLs remain redacted. |
| Draft/unapproved/private content exposure | Several entities have draft/pending/approved/published states. | Direct public endpoint and URL checks, search/discovery exclusion, SEO noindex/robots behavior. |
| Ownership isolation | Vendors, staff roles, organisers, hosts, and guests operate on resource IDs. | Host/vendor A vs B mutation/read tests; admin-only tests; guest `X-Client-Id` tampering tests. |
| Test credentials and artifact handling | Future authenticated browser tests will create cookies, storage-state files and traces. | Ignore those artifacts, use synthetic QA identities, and restrict CI artifact access/retention. |

### P1 — high priority

| Risk | Evidence / reason | Required verification |
|---|---|---|
| No web CI | Current workflow is mobile-only and appears to target a missing `apps/mobile` path. | Add build + unit/integration CI, then a small isolated smoke suite. |
| Read permissions for invited vendor staff are broad/undefined | Product permission audit states write permissions are scoped but org-wide reads are not. | Product decision plus regression tests for bookings, registrations, notifications, and finance visibility. |
| Refunds are off-platform | No Stripe refund call exists; cancellation can diverge from payment reality. | Document operations, user messaging, audit trail, and reconciliation; do not assert automatic refund. |
| Test cleanup is not crash-safe | Existing docs acknowledge residual rows and a notification cleanup race. | Disposable DB/reset and unique-run namespace; teardown must be a backstop, not primary isolation. |
| Third-party dependencies | Firebase, Stripe, Mapbox/Nominatim, R2/Cloudinary, SMTP/push can make E2E flaky or costly. | Default fakes/mocks plus limited tagged integration checks. |
| Browser accessibility and mobile UX unknown | Semantic affordances exist, but no browser automation. | Desktop/mobile keyboard, overflow, dialog focus, bottom navigation, form and map checks. |
| Documentation drift | README does not represent current auth/media/product scope. | Refresh operational test documentation before onboarding contributors. |

### P2 — medium priority

- Search/filter URL state, empty/error/loading states, pagination, and personalized discovery need browser coverage.
- Media formats, corrupt/oversize input, retry/replacement/deletion, quota errors, variants, and persisted display need an integration matrix.
- Notification links, unread counts, chat windows, email fallback, and push behavior need end-to-end validation.
- SEO metadata and local landing routes need structured automated checks.
- Failed/repeated requests, image sizes, map calls, and route load performance are unmeasured.
- Native Capacitor behavior (keyboard, browser return, push, deep links) needs a separate device strategy.

### P3 — low priority

- Cross-browser expansion beyond Chromium.
- Visual-regression baselines for stable high-value screens.
- Wider viewport/device matrix and cosmetic consistency checks.

## Product Bugs vs Audit Findings

No product was executed in this checkpoint, so **no runtime product bug is claimed**. Findings above are architecture/test gaps or risks. Two repository/operations issues warrant investigation:

1. **QA-FINDING-001 — Web application has no CI gate.** Severity/Priority: P1. The only workflow found is mobile-specific and does not validate current web builds/tests.
2. **QA-FINDING-002 — Mobile configuration handling is unverified.** No severity assigned. An untracked `client/android/app/GoogleService-Info.plist` was present in the initial audit snapshot. Its filename alone does not demonstrate a secret leak; Firebase client configuration can be public by design. The prior P0 classification was unsupported and is withdrawn. No contents were inspected or exposed.

These are not yet application bugs. Any future failure should be classified as application bug, test bug, environment issue, test-data issue, external-service issue, or flaky test.

## Actual Role/Permission Model to Test

| Action | Visitor / client ID | Resident | Circle organiser / game host | Vendor owner | Vendor invited staff | Admin |
|---|---:|---:|---:|---:|---:|---:|
| Browse public content | Yes | Yes | Yes | Yes | Yes | Yes |
| Guest centre booking / club registration | Yes | Yes | Yes | Not a vendor function | Not a staff function | Not an admin function |
| Save/follow/profile/household | No | Yes | Yes | Only if separately linked as resident | Only if separately resident | Only if separately resident |
| Create Circle/game | No | Yes | Yes | Only through resident identity | Only through resident identity | Only through resident identity |
| Manage own Circle/game | No | Member-limited | Yes, resource-scoped | Via resident relationship only | Via resident relationship only | No implicit override observed |
| Manage organisation listings | No | No | No | Yes | Platform-role dependent | Admin override/moderation |
| Read organisation operations | No | No | No | Yes | Broad org reads currently observed; intent unresolved | Yes |
| Moderate/approve | No | No | No | No | No | Yes |

This matrix must be encoded in API tests before relying on hidden UI controls.

## Proposed Playwright Architecture

Use root-level Playwright Test with TypeScript and Chromium first. Keep it separate from Vitest.

```text
playwright.config.ts
tests/
  smoke/
  auth/
  onboarding/
  discovery/
  transactions/
  host-vendor/
  circles/
  permissions/
  accessibility/
  seo/
  api/
  fixtures/
    base.fixture.ts
    personas.fixture.ts
    network-observer.fixture.ts
  pages/
    sign-in.page.ts
    explore.page.ts
    booking.page.ts
    manage.page.ts
  support/
    environment-guard.ts
    test-data-client.ts
    stripe-events.ts
    console-policy.ts
  test-data/
    media/
```

Configuration proposal:

- `baseURL` exclusively from `E2E_BASE_URL`; refuse an absent value and refuse known production hosts unless `E2E_ALLOW_PRODUCTION_SMOKE=true` and the project is explicitly read-only.
- Chromium desktop 1440×900 and mobile 390×844 projects; start with desktop smoke and add mobile to critical flows.
- `trace: "on-first-retry"`, `screenshot: "only-on-failure"`, `video: "retain-on-failure"`, HTML + line reporters, zero local retries and one CI retry.
- Separate `production-smoke` project containing only tagged non-mutating tests.
- Saved storage states for `QA_RESIDENT`, `QA_VENDOR_OWNER`, scoped vendor staff roles, and `QA_ADMIN`; create state through APIs, never committed cookies.
- API-first setup through a test-only authenticated fixture service or direct DB helper that is unavailable in production. Unique run/worker IDs and deterministic cleanup/reset.
- Central response/console observer that fails unexpected first-party 5xx and uncaught exceptions, records unexpected 4xx, and allowlists documented third-party noise only.
- Semantic selector order: role → label → placeholder → stable text → narrowly added `data-testid`.
- Tests independent and parallel-safe. Serial mode only for an indivisible lifecycle within one test.

## Changes Required Before Automation Begins

1. Provision and document a local disposable E2E database and preferably a staging environment. No staging configuration was identifiable in the repository.
2. Add `.env.test.example` without secrets and ensure `.env.test`, Playwright auth state, reports, results, traces, screenshots, and videos are ignored.
3. Implement an environment guard that validates base URL, DB name, Stripe key prefix (`sk_test_`), webhook secret, media target/prefix, email sink, and launch mode before mutations.
4. Provide deterministic fixtures for at least one public listing/session per transaction family, a resident, vendor owner, relevant staff roles, admin, private Circle, draft/unapproved content, sold-out/cancelled content, and two distinct owners.
5. Choose a reset strategy: disposable schema/database per run is preferred. Existing after-hook cleanup is insufficient for E2E.
6. Provide a safe Stripe webhook test mechanism (Stripe CLI against local/staging or signed fixture events). Never put Stripe secret keys in test source.
7. Decide the invited-staff read policy and encode it before completing the RBAC matrix.
8. Triage the untracked Google service-config file and add secret scanning.
9. Update stale environment/testing documentation and validate whether the existing mobile workflow is usable.
10. Only then install `@playwright/test` and browser binaries in an approved implementation checkpoint.

## Required Environment Variables

Proposed QA variables (names can be adjusted during Checkpoint 2):

| Variable | Purpose |
|---|---|
| `E2E_BASE_URL` | Local/staging web origin; mandatory. |
| `E2E_API_URL` | API origin when not same-origin. |
| `E2E_ENVIRONMENT` | `local`, `staging`, or `production-smoke`. |
| `E2E_ALLOW_PRODUCTION_SMOKE` | Explicit opt-in; only read-only tagged tests. |
| `DB_NAME` | Must be a dedicated E2E/test DB, never production. |
| `QA_RESIDENT_EMAIL` / `QA_RESIDENT_PASSWORD` | Resident persona, from secret store. |
| `QA_VENDOR_EMAIL` / `QA_VENDOR_PASSWORD` | Approved vendor-owner persona. |
| `QA_ADMIN_EMAIL` / `QA_ADMIN_PASSWORD` | Admin persona, used only where necessary. |
| `QA_VENDOR_STAFF_*` | Separate role-scoped staff personas as RBAC expands. |
| `STRIPE_SECRET_KEY` | Must begin `sk_test_`. |
| `STRIPE_WEBHOOK_SECRET` | Test/staging webhook signing secret. |
| `VITE_FIREBASE_*`, `FIREBASE_*` | Dedicated Firebase test project if provider integration is exercised. |
| `VITE_MAPBOX_TOKEN` | Restricted QA token for the limited integration project. |
| `MEDIA_PROVIDER` and provider-specific vars | Dedicated QA storage/prefix only. |
| `SMTP_*` / mail-sink variables | Local mail capture; never personal/live recipients. |
| `VITE_LAUNCH_MODE` | Explicitly select prelaunch/public behavior under test. |

Existing application variables remain documented in README/server environment templates; they should be copied by name, not value, into `.env.test.example` only when a test environment actually needs them.

## Test Data Requirements

- Seed IDs must be stable or discoverable by unique QA slugs; all mutable records include run and worker identifiers.
- Personas: anonymous visitor, guest client ID, verified-email guest, resident (new/incomplete/complete), Circle organiser/member/outsider/invited, game host, vendor owner, each staff role, suspended/pending vendor, and admin.
- Content: public/draft/pending/unpublished/cancelled/expired/sold-out variants for concrete implemented entities.
- Payments: free and paid sessions, capacity 1 race fixture, coupon, pending/paid/failed/expired records, and test webhook event IDs.
- Circles: open, approval, invite-only, closed, and two different organisers.
- Media: valid JPEG/PNG/WebP/AVIF/HEIC (when supported), corrupt, unsupported, and oversized fixtures with known dimensions/checksums.
- External services: mail sink, fake push adapter, mocked geocoder/maps for normal runs, and dedicated provider-integration tags.

## CI/CD Recommendation

### Pull requests

1. `npm ci` with npm cache.
2. `npm run build`.
3. Client pure tests.
4. Server unit/route tests against an ephemeral MySQL service with an explicitly named test database.
5. Chromium smoke tests against a locally started production build.
6. Upload HTML report/traces/videos only on failure; short artifact retention.

Use path filters only to skip truly unrelated work. Do not run the full provider/payment/mobile matrix on every commit.

### Staging deployment

- Deploy → health check → read/write smoke with isolated QA data → QA-001 through QA-005 → permission/API critical subset.
- Scheduled or manual provider integration suite for Stripe test webhooks, Firebase, Mapbox/geocoder, and media storage.
- Production: read-only health, public navigation, assets, metadata, and non-destructive monitoring only.

## First Tests to Implement After Approval

1. Environment guard unit tests, then `/api/health`, landing/home load, primary assets, navigation, console/network observer.
2. QA-001 resident and vendor/admin auth boundaries, logout, refresh, invalid login, protected APIs.
3. QA-002 account-setup gate persistence and mobile behavior.
4. QA-003 discovery/search/filter to seeded public detail plus draft exclusion.
5. QA-004 centre booking with Stripe test webhook, confirmation, My Life, duplicate/capacity assertions.
6. QA-005 one concrete host/vendor publication lifecycle with owner-vs-other-owner negative tests.
7. Private Circle and cross-role API permission tests before broader feature coverage.

## Checkpoint 1 Result

- **Files changed:** `QA_AUDIT.md`, `QA_TEST_MATRIX.md` only.
- **Tests added:** none.
- **Tests executed:** none; intentionally blocked pending a dedicated database/environment guard.
- **Confirmed runtime bugs:** none, because the application was not run.
- **Blockers at initial audit:** no documented staging environment; no dedicated E2E DB/reset; no Playwright; no web CI; unclear invited-staff read policy.
- **Next checkpoint (requires approval):** finalize QA architecture/environment contract, then implement only the Playwright foundation and its safety guard.

## Approved foundation follow-up

Approval was received after the initial audit. Playwright, its environment guard, a small mocked-API browser suite and a separate live read-only API smoke suite are now implemented. See `tests/README.md` for executable instructions and `QA_REPORT.md` for actual results. Earlier sections record the initial audit baseline, not the current implementation state.

No database provisioning, real authentication, booking/payment automation or CI workflow was added in this foundation checkpoint. The mocked suite establishes frontend behavior and exposes a reproducible mobile cookie-banner defect; it does not complete QA-001 through QA-005. Application files are unchanged.

Additional evidence: `CLAUDE.md` documents local `hello_circle_dev` and canonical `hello_circle` databases, and explicitly states that `server/.env.example` was removed. The original audit's reference to server environment templates should therefore be read as README documentation, not an existing file. Client analytics include consent-gated Google Tag Manager (`client/src/analytics.ts`), alongside server analytics modules.
