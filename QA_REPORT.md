# HelloCircle QA Execution Report

## Phase 13 — Staging provisioning & integration QA — 2026-10-04 (current)

**Staging was not provisioned and nothing was pushed or deployed.** Both depend on owner actions that can't be done safely from this environment (see "Owner actions" below). Production untouched. Stripe TEST mode only. Synthetic identities. Isolated databases.

**Git credential safety (Phase A):**
- Remote: `https` / `github.com` / `innovative-softworks/hello-circle` (**public repository**).
- The exposed token was removed from `.git/config`: the remote is now credential-free HTTPS. It **remains valid until the owner revokes it** on GitHub.
- The token value is not in any tracked or ignored repo file, not in git history (0 commits), and not in git config. It does appear in **one line of the owner's `~/.zsh_history`**, outside the repo and untouched.
- No safe push auth is available: the local SSH key isn't registered on GitHub (`Permission denied (publickey)`), and the keychain's GitHub credential is an OAuth token with **pull-only** access.
- Secret scans:
  - 947 tracked files: only known non-secrets (Firebase client config already public on the remote; synthetic test fixtures).
  - 7 unpushed commits: 25,890 added lines, no real credential.
- CI (`mobile-ci.yml`) triggers only on `main` and pull requests, so pushing the release branch wouldn't deploy anything.

**Locally fixable items done (Phases G6, Q, R):**
- **HC-QA-100 (new, P1, fixed):** activities and programme sessions created in Irish summer time were stored one day early. Reproduced in a real Europe/Dublin browser, then fixed with a shared calendar module.
- **HC-QA-077 (fixed):** "today" follows the Ireland date. 27 UTC sites plus device-local helpers now use `client/src/irelandDate.ts`, and a guard test blocks the pattern from returning.
- **HC-QA-101 (new, P2, fixed):** a Phase 12 regression where pages filtered only the first page of activities/Circles. Fixed with a server `centreId` filter and small server-filtered requests.
- **HC-QA-075 (fixed):** CLS 0.218 → 0 (mobile), 0.225 → 0.002 (desktop) on the local production build.
- **HC-QA-074 (fixed/bounded):** concurrent identical GETs coalesced; duplicates removed on activity detail, Home, My Life and Profile.
- **HC-QA-095:** structured, secret-free provider-failure diagnostics. Stripe TEST gate 3/3 runs at 34/34; not reproduced, still OPEN (UNKNOWN).
- **HC-QA-102 (new, P3):** Firefox long journeys flaky in the full batch.

**Local regression (Phase 13 code):**

| Gate | Result |
|---|---|
| Safety | 97/97 |
| Client unit | 105/105 (16 files; +14: Ireland date, guard, coalescing) |
| Server unit (isolated) | 502 passed, 23 skipped (52 files; +6: diagnostics, HC-QA-101) |
| Typecheck server/client/tests, build | Pass |
| Auth / Authorization / Security / Lifecycle | 20 / 83 / 39 / 52 |
| Booking | 38 passed, 2 skipped (unchanged) |
| Stripe (TEST) | 34/34 in 4 separate runs |
| Smoke | 14/14 |
| Product | 68 passed, 1 skipped (the perf measurement runs only on production builds); exit 0 |
| Browsers, production build | Chromium **76/76**, exit 0. Firefox 70 passed, 2 failed in the full batch (LC-UI-MOBILE timeout, HC-QA-057 desktop), both passing in isolation (HC-QA-102). WebKit 71 passed, 1 failed (known BRW-2 Tab convention), 2 skipped |

**HC-QA-067 note:** the CLS layout change made this keyboard regression intermittent in Chromium. The cause was a key pressed during the browser's own focus-scroll animation, and the test now waits for the focused control to come to rest. The assertion is unchanged, and it passes 8/8. Full analysis is in `QA_BUGS/HC-QA-067.md`.

**Blocked on staging (not done):** HTTPS/nginx/systemd, the staging DB and migration, the real Stripe HTTPS webhook / retry / expiry / refund, Firebase, R2, email, Mapbox, staging browser and mobile smoke, the HC-QA-076 load test, backup/restore and rollback rehearsals.

**Owner actions (manual, not doable from here):**
1. Revoke the exposed GitHub token on GitHub (Settings → Developer settings → Personal access tokens) and delete its line from `~/.zsh_history`.
2. Give this machine push access without a token in the URL: register `~/.ssh/id_ed25519.pub` on the GitHub account (or a deploy key with write access), **or** sign in with a credential manager (`gh auth login`) as a user with push rights.
3. Supply and approve a separate staging VPS (2 vCPU / 4 GB / 40–60 GB, Ubuntu LTS), the `staging.hellocircle.ie` DNS record, and the access method (SSH key).
4. Provide staging-only credentials, never in chat:
   - Stripe TEST secret key, and a TEST webhook endpoint secret created for the staging URL;
   - a staging Firebase project;
   - a rotated, staging-scoped R2 token and bucket;
   - an SMTP sandbox;
   - a URL-restricted Mapbox token.
5. Explicit authorisation to push `release/staging-phase11a` once (2) is done.

## Phase 12 — MVP hardening: accessibility, pagination, product cleanup — 2026-10-03

Local only. Nothing deployed, no staging provisioned, production untouched, Stripe test mode / stub only, synthetic QA identities, isolated databases.

**Fixed:** HC-QA-059, 060, 065, 070, 071, 072, 073 and 083, plus new findings **HC-QA-098** (Escape didn't close header menus, P3) and **HC-QA-099** (inbox rows were mouse-only, P3). Details and before/after evidence are in each `QA_BUGS/` file, `QA_ACCESSIBILITY.md`, `QA_PERFORMANCE.md`, `QA_PRODUCT_GAPS.md` and `QA_INTEGRATIONS.md`.

**Also done:**
- A revoked invitation becomes a non-actionable "Invitation withdrawn" notice.
- Cancelling a programme session notifies residents with a live enrolment, in-app, once.
- Sign in with Apple is hidden.
- Google Fonts are self-hosted, so there's no pre-consent request to Google.
- Unsigned Stripe webhooks are refused unless explicitly opted in locally (never in production or staging).

**Fail-before:** 16 new browser regressions, plus the pagination and webhook-policy server tests, were run against the pre-Phase-12 application code (files checked out from `d414266`, then restored and verified by checksum, 91/91). Every new browser test failed and 7 server tests failed. All pass on the Phase 12 code.

| Gate | Result |
|---|---|
| Safety | 97/97 |
| Client unit | 91/91 |
| Server unit (isolated) | 496 passed, 23 skipped (51 files). Four older `ogMeta` assertions that venue pages are indexable now run with `VENUE_PAGES_PUBLIC=true` (the launched state they describe); 3 new tests cover the gated default |
| Typecheck server/client/tests, build | Pass |
| Auth / Authorization / Security / Lifecycle | 20 / 83 / 39 / 52 |
| Booking | 38 passed, 2 skipped (unchanged) |
| Stripe / Smoke | 34/34 / 14/14 |
| Product (incl. a11y c/d/e, p12 a/b) | 67/67 |
| Browsers, production build | Chromium 74/74; Firefox 73/74 (LC-UI-DESKTOP-PARTICIPANT timed out in the full batch, then passed 2/2 in isolation: flaky under load); WebKit 70 passed, 1 skipped, 1 failed (known BRW-2 Safari Tab convention in HC-QA-001-CONSENT) |

**Not claimed:** full WCAG 2.2 AA. The checks are WCAG-oriented automated and keyboard checks, with no manual screen-reader pass. **Remaining:** Unsplash hot-links before consent (rights review needed); availability filter and non-date sorts work on loaded pages only; per-row serialisation queries bounded by page size, not removed.

## Phase 11B — MVP product gaps: cancellation & invitation control — 2026-10-03

Implemented locally, uncommitted and not deployed. Only isolated QA/test databases were used.

**Fail-before → pass-after:**
- All 13 new tests **failed** against the committed release branch (`6e85f4c`): Phase 11B application files checked out, tests unchanged, each test run individually.
- All 13 **pass** on the implementation.
- 5 new server unit tests (`selfCancel.test.ts`) pass.

| Feature | Tests | After |
|---|---|---|
| Activity invitation revoke | HC-GAP-INV-1/2 (API), HC-GAP-UI-HOST-REVOKE | ✓ |
| Circle invitation revoke | HC-GAP-CIRCLE-1/2 (API), HC-GAP-UI-CIRCLE-REVOKE | ✓ |
| Experience self-cancel | HC-GAP-EXP-1, HC-GAP-UI-EXP, HC-GAP-UI-EXP-PAID, HC-GAP-STRIPE-EXPERIENCE (real TEST payment) | ✓ |
| Programme self-cancel | HC-GAP-PROG-1, HC-GAP-UI-PROG, HC-GAP-STRIPE-PROGRAMME (real TEST payment) | ✓ |

The UI tests also pass on the production build in Chromium, Firefox and WebKit.

**Adjacent findings (fixed):**
- HC-QA-096: Circle invite accept/join races.
- HC-QA-097: refunded bookings vanished from My Life.
- My Life "Cancel booking" controls now carry contextual accessible names ("Cancel booking for <title>"). The existing BK-UI test's confirm click was scoped to the confirmation dialog; its assertion is unchanged.

**Regression (final tree):**

| Gate | Result |
|---|---|
| QA safety | 97 |
| Client unit | 91 |
| Server unit (isolated) | 48 files, 480 passed + 23 skipped |
| Typecheck and build | ✓ |
| `qa:auth` | 20 |
| `qa:authorization` | 83 |
| `qa:security-gate` | 39 |
| `qa:lifecycle` | 52 |
| `qa:booking` | 38 + 2 skipped |
| `qa:stripe` | 34/34 |
| `qa:smoke` | 14/14 |
| `qa:product` | 51/51 |

## Phase 11A — Staging preparation and deployment resilience — 2026-10-03

Nothing was deployed or provisioned. The production VPS and database were not touched, and no live Stripe was used.

**Fixed locally (each with failing-before → passing-after regressions):**

| Finding | Outcome |
|---|---|
| **HC-QA-090** (P2, deploy) | Missing assets now return a real 404 (`no-store`), hashed assets are `immutable`, HTML is `no-cache`, and the shell template follows a rebuild. The client reloads once, or shows "HelloCircle has been updated — Refresh to continue". Never blank, never loops. A **real deploy simulation** (rebuild + restart + old tab) passes in Chromium, Firefox and WebKit with exactly 1 reload |
| **HC-QA-091** (P2, payments; Policy A) | The provider state is checked first. A payment fully refunded at Stripe is reconciled with **no second refund**: one transition, a distinct audit, one notification set, and concurrent/repeat attempts are no-ops (409). A partial external refund is refused safely with operational evidence. Verified with real TEST payments across all 5 models |
| **HC-QA-092** (P3, test infrastructure) | Isolated server-test profile: a disposable `hello_circle_test_<runid>` container, scrubbed env, layered guards plus a live identity marker; it never loads `server/.env`. 3 stale tests were updated to the security contracts, non-hermetic tests fixed, and 21 live-provider tests gated. Result: 47/47 files, 475 passed, 23 skipped |
| **HC-QA-093** (P2, new) | The GTM container was hard-coded, so staging would have fed production analytics. Now `VITE_GTM_CONTAINER_ID` (`off` for staging) |
| **HC-QA-094** (P1 on the release path, new; never released) | The first HC-QA-090 fix could hijack a user's navigation with a recovery reload (Firefox/WebKit, aborted in-flight chunk). Recovery is now suppressed while the page is leaving or offline |

**New open finding:** **HC-QA-095** (P3, QA infrastructure). The Stripe gate failed intermittently at checkout creation in 2 of 4 full runs (different tests each time; 32/32 in the others). The provider error class isn't captured.

**Migration gate:** `npm run migrate --workspace server` was re-verified:

| Check | Result |
|---|---|
| Fresh DB | 0 → 76 tables / 777 columns |
| Upgrade from the `e816b56` schema with synthetic rows | 68/650 → 76/777, data preserved |
| Fresh vs upgraded | Identical, fingerprint `b2c8cc9049ad664b` |
| Second and third runs | No-ops |
| `hello_circle` | Refused |
| Rollback | **Restore the pre-migration backup.** There is no down-migration |

**Staging preparation:**
- `QA_STAGING_PROVISIONING.md`: separate VPS spec, DB users and grants, backup/restore, nginx/TLS/noindex/basic auth, `TRUST_PROXY_HOPS=1` topology check, deployment and rollback (prepared, not executed), provider isolation.
- `deploy/staging/*` templates: names only.

**Regression (final tree):**

| Gate | Result |
|---|---|
| QA safety | 97 |
| Client unit | 91 |
| Server unit (isolated only) | 47 files, 475 passed + 23 skipped |
| Typecheck (server, client, tests) | ✓ |
| Build | ✓ |
| `qa:auth` | 20 |
| `qa:authorization` | 83 |
| `qa:security-gate` | 39 |
| `qa:lifecycle` | 52 |
| `qa:booking` | 38 + 2 skipped |
| `qa:stripe` | **32/32** (HC-QA-095 intermittency noted) |
| `qa:smoke` | 14/14 |
| `qa:product` | 40/40 |

Production-build cross-browser:

| Engine | Result |
|---|---|
| Chromium | 53/53 |
| Firefox | 53/53 |
| WebKit | 49 passed; failure is BRW-2 only (known Safari Tab convention), plus 1 intentional skip (HC-QA-090 same-URL simulation, covered by the real deploy simulation) |

**Release:**
- Prepared on local branch `release/staging-phase11a`.
- Secret scan clean: no real secrets in 372 release files.
- **Not pushed.** Pushing needs explicit per-instance authorisation, and the `origin` URL embeds the previously exposed GitHub token, which should be rotated first.

**Still open:**
- P2s: 059, 060, 065, 070–076;
- accessibility items: 065, 070–072, 083;
- product gaps: invitation revoke UI, experience self-cancel, programme self-cancel;
- P3: 095.

## Phase 11 — Staging deployment & integration QA — 2026-10-03

**Decision: STAGING DEPLOYMENT BLOCKED.** No isolated staging environment exists. The only server is the production VPS, which shares its host, nginx and MySQL server with production data, and Firebase, R2 and SMTP each exist only as one shared configuration. Under the brief's "STOP if staging can mutate production data" rule, nothing was deployed. Nothing was committed or pushed. See `QA_STAGING_ENVIRONMENT.md` for the dependency classification and the decisions needed.

**Done instead, on isolated local infrastructure:**

| Area | Result |
|---|---|
| Schema migrations | New explicit step `npm run migrate --workspace server`. Verified on a fresh DB, on an existing DB at prod commit `e816b56` (+8 tables, +61 columns, data preserved) and for idempotency. Fresh and upgraded schemas are identical. The production-name guard works. Rollback is backup-restore only |
| Production-build WebKit host flow ×5 | **5/5 PASS**. BRW-1 is settled as a dev-server artifact |
| Production-build cross-browser | Chromium 50/50. Firefox 47/48: one TABLET timeout, then 2/2 on rerun. WebKit 47/48: only BRW-2, the known Safari Tab convention |
| Stripe TEST with real Stripe-delivered webhooks (CLI) | Payment, amount integrity, coupon, redelivery idempotency, expiry plus slot release, HelloCircle refund, and double-refund 409 all PASS. A refund outside HelloCircle is ignored → **HC-QA-091** |
| Mapbox | Real tiles, clustering, a single pin and directions on desktop and mobile. Listings without coordinates are left off the map. Provider failure shows the fallback text with the list still usable |
| Geocoding | 2 real Nominatim lookups: a hit, and an empty result handled |
| Analytics consent | No tracker requests before consent or with "Necessary only". GTM loads only after "Accept" |
| Email | Booking and refund emails to the booker, vendor and admin in local Mailpit. Links use `CLIENT_URL` only, with no tokens |
| Deploy behaviour | A tab open across a deploy goes blank → **HC-QA-090**. The in-memory `index.html` cache needs a restart after each build (already in the runbook) |
| Logs, limits, observability | Secret scan: 0 hits in backend logs. Rate limiters reviewed (`TRUST_PROXY_HOPS` required behind nginx). Health check is liveness-only. No tooling purchased |

**BLOCKED:**
- a public HTTPS webhook endpoint and Stripe's automatic retry;
- Firebase/Google sign-in;
- R2 uploads, variants and AVIF;
- real staging email and SPF/DKIM;
- the GTM container contents.

All of these need staging credentials.

**New findings:**
- **HC-QA-090 (P2, DEPLOYMENT):** a tab open across a deploy goes blank on its next lazy route.
- **HC-QA-091 (P2, PAYMENTS):** a refund made outside HelloCircle is ignored; the vendor refund then returns 502.
- **HC-QA-092 (P3, QA-INFRA):** 3 stale server unit tests contradict earlier intentional fixes, and the suite isn't hermetic.

**Local gate rerun (final):**

| Gate | Result |
|---|---|
| QA safety | 97 |
| Client unit | 81 |
| Typecheck (server, client) | ✓ |
| Build | ✓ |
| `qa:auth` | 20 |
| `qa:authorization` | 83 |
| `qa:security-gate` | 39 |
| `qa:lifecycle` | 52 |
| `qa:booking` | 38 + 2 skipped |
| `qa:stripe` | 26/26 |
| `qa:smoke` | 14/14 |
| `qa:product` | 37/37 |

This is identical to the Phase 10A baseline. The server unit suite (`npm run test --workspace server`) was also run, outside the earlier baseline: 4 failed on `hello_circle_dev`, explained in HC-QA-092. Process note: that run used the local dev database through `server/.env`. Its setup guard refuses `hello_circle` and email delivery is disabled under test. The causation check was then repeated on throwaway databases.

**Still open:**
- P2s 059, 060, 065, 070–076;
- accessibility items 065, 070–072 and 083;
- product gaps: invitation revoke UI, experience self-cancel, programme self-cancel.

## Phase 10A — Pre-staging remediation — 2026-10-03

Scope:
- the P1 HC-QA-052;
- functional/data P2s 053–058 and 061–064;
- accessibility P2s 066–069.

Everything is FIXED LOCALLY — NOT DEPLOYED. Nothing was committed.

**Method:**
- Each finding got an original failing-before regression in a new guarded batch, `npm run qa:product` (`tests/integration/specs/product-*.spec.ts`, 9 batches split to respect the real 10-login limiter).
- Each regression was confirmed red, the smallest systemic fix was applied, and the regression was confirmed green.
- Two first-run reds (052, 066) were caused by test bugs: a selector matched "Continue with Google", and the activity rows were collapsed. Those tests were corrected and fail-before was re-established against the pre-fix components, swapped in temporarily and then restored byte-for-byte.
- Two new adjacent defects found during cross-browser verification were fixed as well:
  - **HC-QA-088 (P2):** the shared Modal focus trap let focus escape in Safari/WebKit.
  - **HC-QA-089 (P2):** multi-step forms left focus on the bottom button after Continue.

**Harness additions (test-only, no assertion weakened):**
- A QA mail observer (`setQaMailObserver`, active only under NODE_ENV=test + QA_E2E_ENABLED) plus loopback `/api/__qa/mail` returning safe facts only.
- `qa:product` and `qa:browsers` runner modes.
- Allowlisted `QA_BROWSER` (chromium/firefox/webkit).
- Longer time budgets for Firefox/WebKit only (cold dev-server compile).
- Vendor personas accept current Terms through the real endpoint, restored by exact ID afterwards.
- Cleanup hygiene: poll options/votes deleted with their Circle's polls; analytics also matched by `metadata.entityId`. 111 orphaned poll options and 30 orphaned share events from this session's disposable DB were removed.

| Finding | Fix (summary) | Regression |
|---|---|---|
| 052 P1 | Vendor type = native radio group (fieldset/legend, focusable visually-hidden radios) | FAIL→PASS desktop+mobile, keyboard-only end-to-end; semantics test |
| 053 | Drafts not shareable (Share hidden on draft rows); ShareSheet error state + retry | FAIL→PASS |
| 054 | Poll create row-locked + identical-open-poll dedupe server-side; client in-flight guard + error | FAIL (2 polls)→PASS (1); concurrent/repeat/slow-network |
| 055 | Chat ordered send queue; draft cleared at send; failed text restored | FAIL→PASS (5/5 in order); failure path |
| 056 | Circle members notified once per plan when it becomes bookable (excl. organiser/removed) | FAIL→PASS; eligibility/no-duplicate |
| 057 | Message Circle opens this Circle's ChatModal | FAIL→PASS desktop+mobile, keyboard, no history entry; non-member authz |
| 058 | Vendor application + approval emails (approval only on a real transition) | FAIL→PASS; 4 approve calls → 1 email; also verified in local Mailpit |
| 061 | Vendor experience GET camelCase; price/duration/capacity validation | FAIL→PASS; edit/reload/zero/invalid |
| 062 | Local-mode `/api/media/upload` stores validated originals; restricted covers private | FAIL (503)→PASS; invalid/foreign/guest/private/missing |
| 063 | LoadErrorState on /games, /circles, BrowseLayout | FAIL→PASS (500 + timeout, mobile+desktop) |
| 064 | Only 401/403 sign out; transient failure = retryable error | FAIL→PASS; real signed-out still sees Sign in |
| 066 | My Life rows → Links; vendor booking rows → named buttons | FAIL→PASS (resident + vendor desktop/mobile) |
| 067 | Upload controls → buttons opening hidden input; errors announced (+ org logo) | FAIL→PASS (Enter + Space); vendor gallery |
| 068 | Label associations (host 19, Circle 9, programme 13) + aria-labels where no visible label | FAIL→PASS (zero unlabelled on scoped forms) |
| 069 | `useDialogFocus` for ConfirmDialog/JoinAuthModal (+ aria-labelledby) | FAIL→PASS desktop+mobile; adjacent cancel dialog |
| 088 (new) | Trap cycles focus on every Tab (Modal + hook) | FAIL in WebKit → PASS all engines |
| 089 (new) | GuidedFlow focuses the new step heading on step change | WebKit FAIL → PASS all engines (asserted in 052) |

### Validation (unfiltered, sequential, final code)

- Safety 97, client 81, typecheck (client/server/tests) PASS, build PASS.
- auth 20, authorization 83, security gate 39 (HC-QA-002..021).
- lifecycle 52 (HC-QA-001 + 022..033).
- booking 38 + 2 partition skips (034..047).
- Stripe 26/26 (048..051).
- mocked smoke 14/14.
- **product 37/37** (HC-QA-052..069 + 088/089).

### Cross-browser critical journeys (`npm run qa:browsers`)

Covers login/auth core, vendor signup, Explore/activity/Circle participant and host UI journeys, consent and fixed bottom chrome, the booking UI, Circle chat, host media, vendor dashboard, list/My Life error states, keyboard rows/uploads/dialogs.

- **Chromium:** 50/50.
- **Firefox:** every batch green; one batch's web server timed out at startup in one run, and the batch then passed 3/3 consecutively.
- **WebKit:** green except:
  - (a) the existing HC-QA-001-CONSENT keyboard sub-check presses plain Tab, which Safari's macOS default uses for text fields only. The consent buttons are reachable with Option+Tab and the choice works (verified).
  - (b) LC-UI-DESKTOP-HOST intermittently (3/6) hits `TypeError: Importing a module script failed` from the Vite dev server's dependency optimizer during lazy route loads. It's a dev-server artifact, but needs a production-build WebKit check in staging (see QA_BROWSER_COMPATIBILITY.md).

### Remaining Product Quality findings

- P0 0.
- P1 0.
- P2 10: 059, 060, 065, 070–076.
- P3 11: 077–087.

### Decision

No P0/P1 open. Existing gates green. HelloCircle is ready for a STAGING deployment from a QA standpoint, as a controlled, non-public, test-mode environment with the staging-integration checkpoint next. It is not public-launch/MVP ready.

## Phase 10 — Complete product quality QA — 2026-10-02/03 (current)

Scope: UX, journeys, forms, states, responsive, browser, accessibility, performance, integrations, SEO, data quality. This was a findings inventory only. Nothing was fixed, deployed or committed.

### Environment

- **Regression gates:** the guarded QA environment. The previous tmpfs container (run `qa_7a01b2c0c87998f1`) had stopped with Docker, so its volatile DB was gone. Its manifest was retired (moved, not deleted) to `.qa-data/qa_7a01b2c0c87998f1/retired-docker-stopped-manifest.json`. The stopped container was left in place. A fresh run (`qa_91df0fb79128a998`) was provisioned with the existing `qa:db:setup` and `qa:db:seed`, the same Method B as QA_ENVIRONMENT_RECOVERY.md.
- **Exploration** (separate, throwaway; the QA DB stayed untouched by exploratory data):
  - a labelled tmpfs MySQL container on 127.0.0.1:13307 with random credentials;
  - a local Mailpit SMTP sink on 127.0.0.1:11025/18025;
  - the backend on :4411, started with an empty dotenv and outbound sockets blocked except DB and SMTP;
  - Vite on :4478 using the existing isolated config (no `client/.env`).
- **Data:** synthetic personas were created through the real signup UI. Bulk volume (2k activities, 300 Circles, 3k chat messages, 2k notifications) was inserted only into the throwaway DB, for scale tests.
- **Production-build checks:** `client/dist` was temporarily swapped for an isolated build, then the original build was restored.
- Never touched: production, the dev/prod databases, and live providers. The only Stripe use was the existing `qa:stripe` test profile.

### Existing regression gates (re-run, unfiltered, sequential)

All green, with the following totals:
- safety 97, client 81, build PASS;
- auth 20, authorization 83, security gate 39 (HC-QA-002..021);
- lifecycle 52 (HC-QA-001 + 022..033);
- booking 38 + 2 partition skips (HC-QA-034..047);
- mocked smoke 14/14;
- **Stripe 26/26** (HC-QA-048..051). The first two Stripe attempts failed on external timeouts with 0 assertion failures: a backend start timeout in the Stripe preflight, then the hosted checkout page load timing out after a correct redirect. The third run passed cleanly.

### New findings (HC-QA-052..087; all OPEN)

P0 0, P1 1, P2 24, P3 11.

| ID | Sev | Category | Summary |
|---|---|---|---|
| 052 | P1 | ACCESSIBILITY | Vendor signup can't be completed by keyboard or screen reader (type tiles are mouse-only `div`s) |
| 053 | P2 | FUNCTIONAL | Share sheet spins forever on share-data failure (Share on a draft) |
| 054 | P2 | FUNCTIONAL | Double-click "Create poll" creates duplicate polls |
| 055 | P2 | DATA | Chat composer discards text typed during an in-flight send |
| 056 | P2 | FUNCTIONAL | Circle members not notified of new plans, despite UI promise |
| 057 | P2 | UX | "Message Circle" scrolls to Planning instead of opening chat |
| 058 | P2 | FUNCTIONAL | No vendor signup or approval emails; vendor never learns they're approved |
| 059 | P2 | UX | Vendor centre shown "Live" but venue pages are gated to /coming-soon |
| 060 | P2 | SEO | Sitemap and server meta index venue pages the client redirects away |
| 061 | P2 | FUNCTIONAL | Experience editor shows €NaN / defaults for saved price and duration (snake_case GET) |
| 062 | P2 | INTEGRATION | Without R2, resident hosts can't upload any image (503 → 401 fallback) |
| 063 | P2 | UX | /games shows a false "0 games" state when the API fails |
| 064 | P2 | UX | My Life shows "Sign in" to a signed-in user when the profile request fails |
| 065 | P2 | ACCESSIBILITY | Document title never changes on in-app navigation |
| 066 | P2 | ACCESSIBILITY | 40 mouse-only click targets (My Life rows, vendor booking rows, …) |
| 067 | P2 | ACCESSIBILITY | Image upload controls not keyboard-reachable |
| 068 | P2 | ACCESSIBILITY | Unlabelled controls on search, host, Circle, programme forms |
| 069 | P2 | ACCESSIBILITY | Join confirmation dialog doesn't move or trap focus |
| 070 | P2 | ACCESSIBILITY | Header menus lack aria-expanded; no aria-current |
| 071 | P2 | ACCESSIBILITY | Form field borders 1.4–1.7:1 (needs 3:1) |
| 072 | P2 | ACCESSIBILITY | Dark-mode contrast failures; 156 hard-coded colors bypass theme |
| 073 | P2 | PERFORMANCE | Unbounded list endpoints with N+1 serialization |
| 074 | P2 | PERFORMANCE | Pages download whole lists (1.96 MB on Home and activity detail); duplicate/401 calls |
| 075 | P2 | PERFORMANCE | CLS ~0.22 on almost every route (footer outside Suspense) |
| 076 | P2 | PERFORMANCE | Backend saturates ~20 rps; p95 5.8 s at 50 users (dev server) |
| 077 | P3 | DATA | UTC date used as "today" in 27 client sites |
| 078 | P3 | UX | Host Manage polish (ISO dates, "Almost full" at 1/3, hidden publish, no View) |
| 079 | P3 | UX | Activity detail polish (stale avatar, duplicate description, copy, badge clip) |
| 080 | P3 | UX | Circle page polish |
| 081 | P3 | UX | Vendor/admin polish (approval drill-down, €0 live listing, row controls) |
| 082 | P3 | UX | Auth surfaces (Apple placeholder, silent disabled submit, deep-link loss) |
| 083 | P3 | ACCESSIBILITY | Headings/H1, skip link, live regions, touch targets |
| 084 | P3 | PERFORMANCE | Images: no srcset, third-party 1920 px heroes, unresized local uploads |
| 085 | P3 | DATA | My Life counts a Circle join as "plan attended"; mobile layout gap |
| 086 | P3 | SEO | Soft 404, duplicate meta description, casing, missing JSON-LD |
| 087 | P3 | CONTENT | Email brand inconsistency; concurrent valid magic links |

### Deliverables

QA_PRODUCT_SURFACE_MATRIX.md, QA_UX_AUDIT.md, QA_ACCESSIBILITY.md, QA_RESPONSIVE.md, QA_BROWSER_COMPATIBILITY.md, QA_PERFORMANCE.md, QA_INTEGRATIONS.md, QA_SEO.md, QA_PRODUCT_GAPS.md (Phase 10 section), and QA_BUGS/HC-QA-052..087.md.

### Integration status

- Stripe PASS.
- Email PASS for the local sandbox; staging delivery BLOCKED.
- OAuth BLOCKED.
- Media BLOCKED for the cloud pipeline; local fallback FAIL for residents.
- Maps NOT CONFIGURED.
- Analytics consent PASS.

### Browsers

Chromium desktop and mobile emulation PASS. Firefox, WebKit and real devices BLOCKED (engines not installed; download not approved).

### Decision

- No P0. One P1 (052, accessibility).
- The core resident, host, Circle and vendor journeys work in Chromium.
- Not yet staging-ready without:
  - fixing 052;
  - triaging the P2 functional/data set (053–058, 061–064);
  - running cross-browser coverage.

See the final Phase 10 summary for the full recommendation.

## Phase 9 — Stripe TEST mode integration & financial lifecycle — 2026-10-01 (current)

Mode: Stripe **TEST MODE VERIFIED**. The key prefix was checked and the provider itself reported `balance.livemode=false` before any app traffic.
- **Isolation:** isolated QA database and container only. The dev and prod databases and servers were never used.
- **Credentials:** a test key in a private 0600 file outside the repository and outside the DB-mounted secrets directory. Never printed (0 secret-shaped strings in logs, evidence or results).
- **Webhooks:** signed with a fresh per-run local secret and verified by the real handler.
- **Network:** backend egress limited to `api.stripe.com:443`; the browser allowed only Stripe hosts.

Findings (all FIXED LOCALLY — NOT DEPLOYED):
- **HC-QA-048** (P1): unsigned webhook confirmed a booking.
- **HC-QA-049** (P2): activity receipt showed the list price, not the charge.
- **HC-QA-050** (P1): a single-use coupon discounted two real payments.
- **HC-QA-051** (P2): concurrent refunds returned 500.

Stripe gate `npm run qa:stripe`: **26/26**, covering:
- signature checks;
- unknown events and refs;
- amount integrity for 5 models (quote = server = DB = Stripe, EUR, integer cents);
- expiry;
- concurrency (5 models);
- provider error;
- hosted test payments (5 models) with replay and out-of-order events;
- decline, late success and isolation;
- the coupon race;
- refund, replay and 4-way concurrent refund;
- cancel before payment;
- desktop and mobile journeys;
- return-URL safety;
- HC-QA-048/049.

Regression and validation:
- safety 97, client 81, typecheck and build PASS;
- auth 20, authorization 83, security gate 39;
- lifecycle 52 (HC-QA-001, 022..033);
- booking 38 + 2 partition skips (HC-QA-034..047);
- mocked smoke 14/14.

Provider reconciliation (test sandbox): 114 sessions (0 live-mode), 43 paid, 6 refunds, 0 payments refunded twice. Provider records are kept as evidence; the 35 open sessions expire on their own.

Decision: Phase 9 signed off in Stripe TEST mode, locally. Next checkpoint: external integrations / release readiness. Real Stripe webhook delivery should be checked in staging before launch.

## Phase 8 remediation — booking integrity before Stripe — 2026-10-01 (current)

HC-QA-034..046 are fixed locally (not deployed). HC-QA-047 (programme and paid-activity confirmations hiding VAT/fee) was found and fixed in the cross-model review. The invariants are documented in QA_BOOKING_MODEL.md. No payment provider was configured or called; the outbound counter stayed at 0.

Core changes (server):
- `bookingIntegrity.ts`: 30-minute pending hold, shared capacity/seat predicates, atomic coupon consumption, validators.
- Registrations: one parent-locked reservation transaction.
- Programmes, experiences, halls and activities: hold-aware capacity, duplicate guards and input validation.
- Atomic cancels everywhere.
- The experience session cancel cascades.
- Club sessions with history are deactivated rather than deleted.
- Provider confirm functions settle under the parent lock (idempotent; a stale hold re-proves capacity or becomes refund-required).
- Quote endpoints for experiences, programmes and activities.

Client: server-quoted totals in the experience, programme and activity confirmations; consent-aware `scroll-padding`.

QA seam: `QA_PAYMENT_PROVIDER_STUB`, active only with NODE_ENV=test + QA_E2E_ENABLED and only for the booking-provider batch, plus the test-only `/api/__qa/provider`.

Current results: safety 91; client 81; typecheck + build PASS; auth 20; authorization 83; security gate 39; lifecycle gate (HC-QA-001 + 022..033) 52; booking suite 38 PASS + 2 partitioned skips (qa:booking exit 0), covering integrity, the provider state machine, remediation, desktop/mobile journeys and HC-QA-034..047; mocked smoke 14/14.

Integrity: 33 checks all zero (duplicates, orphans, over-capacity, invalid quantity/duration, negative totals, pending/stale holds, coupon over-use, active bookings on cancelled sessions, contradictory lifecycle). Only pre-existing Stage B residue remains (audit_log 6, reports 36, notifications 12). Phase 8 test hygiene was fixed for vendor-cancel and session-cancel audit rows.

Decision: Phase 8 signed off LOCALLY. Stripe TEST MODE is approved as the next isolated checkpoint (not started).

## Phase 8 — Booking integrity, no payment provider — 2026-10-01 (current)

The booking model inventory is in QA_BOOKING_MODEL.md: hall bookings, club registrations, programme enrolments, experience bookings, activity joins, and pass purchases. Stripe stayed unconfigured throughout, and the QA outbound counter stayed at 0. The new command is `npm run qa:booking`: 14 integrity/journey scenarios PASS, then it stops red at the preserved findings.

New findings (all OPEN, not fixed; each verified failing individually):

| ID | Sev | Summary |
|---|---|---|
| 034 | P1 | Club-wide capacity overbooked by concurrent registrations (6 confirmed / capacity 1) |
| 035 | P1 | Negative hall-hire duration → confirmed €0 booking; fractional duration price/slot mismatch |
| 041 | P1 (latent, blocks Stripe) | Pending checkouts don't hold capacity (registrations, enrolments, experiences); confirm doesn't recheck |
| 036 | P2 | Guests > room cap / negative accepted; past dates accepted; malformed date → 500 |
| 037 | P2 | Single-use coupons reusable on cash/free paths (used_count only recorded by Stripe webhook) |
| 038 | P2 | Duplicate identical registration/enrolment creates second record and consumes capacity |
| 039 | P2 | Experience partySize fractional (priced 1.5, stored 2) / string concatenation in capacity check |
| 040 | P2 | Vendor session cancel leaves experience bookings confirmed and un-notified |
| 042 | P2 | Experience form shows price×party (€10) but server owes VAT+fee (€12.80) |
| 043 | P2 | Focused control can sit under the mobile consent banner (HC-QA-001 residual; no scroll-padding) |
| 046 | P2 | Concurrent duplicate cancels not idempotent (2-3×200, duplicate notifications) |
| 044 | P3 | Club session hard delete orphans registrations |
| 045 | P3 | Past-dated experience sessions bookable |

Held correctly:
- Slot and capacity locking for halls, club sessions, programmes, experiences, and activities (6-way races → exactly 1).
- Client-supplied price and currency fields are ignored.
- Coupon validity, expiry, and listing scope.
- The provider boundary (503 with no committed row or notification).
- Ownership for guests and other organisations.
- Sequential cancel idempotency.
- Reschedule capacity.
- Waitlist and held-offer invariants (HC-QA-026 gate).
- Desktop and mobile booking journeys with the consent banner shown.

Current results: safety 91; client 81; typecheck + build PASS; auth 20; authorization 83; security gate 39; lifecycle gate (HC-QA-001 layout + HC-QA-022..033) all PASS; booking integrity 14 PASS + 13 preserved findings red; mocked smoke 14/14.

Integrity: all booking tables are empty after the run; no pending rows, Stripe ids, negative totals, orphans, over-capacity rows, or phantom offers. The test-hygiene gap for vendor-cancel audit rows is fixed; 8 rows from Phase 8's own earlier runs were removed by exact scope.

Decision: Phase 8 is NOT signed off locally (P1 HC-QA-034/035/041 open). Stripe test mode should wait until 034/035/041 are fixed and the booking gate is green.

## HC-QA-001 closure — 2026-10-01 (current)

HC-QA-001 (P1, mobile tab bar covering cookie consent) FIXED LOCALLY — NOT DEPLOYED; details in
QA_BUGS/HC-QA-001.md. Original QA-SMK-002 unchanged: FAIL before / PASS after.
Systemic rule: BottomChromeSync publishes measured --bottom-nav (tab bar incl. safe area) and
--bottom-chrome (whole fixed bottom stack); bars on the nav use var(--bottom-nav), floating UI uses
calc(var(--bottom-chrome) + 16px); consent z-index token between mobile bars and drawers. Also fixed in the
same class: join bar 64px assumption and 861-900px float, compare tray under the tab bar, footer under the
tab bar, and fadeUp `both` fill retaining a transform that broke position:fixed join bars on detail pages.
New real-environment batch lifecycle-ui-bottom-chrome (3 tests).

Current results: safety 91; client 81; typecheck + build PASS; auth/security 20; authorization 83;
security gate HC-QA-002..021 39; lifecycle 20 + HC-QA-001 layout 3 + finding gate HC-QA-022..033 29
(qa:lifecycle exit 0); mocked smoke 14/14 PASS. Integrity clean; Stage B residue now 24 reports / 8
notifications (unchanged pattern, not deleted). No tracked P0/P1 open. Nothing deployed.

## Phase 7 remediation & local sign-off — 2026-10-01 (current)

HC-QA-022..033 FIXED LOCALLY — NOT DEPLOYED (details and verification in each QA_BUGS file).
Original failing-before regressions unchanged and now green; extended invariants added.
Phase 7 finding gate = 9 `lifecycle-findings-*` batches (29 cases), each within the real
10-login limiter. Missing features recorded separately in QA_PRODUCT_GAPS.md (not fixed).

Application changes: server/src/routes/chat.ts (inbox ordering), routes/games.ts (Circle plan
visibility inheritance + visibility validation, lifecycle endpoint guards, cancel idempotency/
waitlist fan-out, archive guard, host leave, free-leave notice, update ordering, date validation,
waitlist-participant guard), waitlist.ts (capacity-aware offers, stale-entry resolution),
routes/circles.ts (closed poll, invitee existence, idempotent join request), routes/residents.ts
(public host count, notification ordering), client HostGamePage.tsx (state-accurate confirmation,
date min/validation), Photo.tsx + index.css (card photo click-through). No schema change.

Test hygiene: a timed-out test abandoned withActors' cleanup (reproduced with a probe). Lifecycle
specs now use lifecycle-fixture's withActors wrapper + auto fixture whose teardown (runs after
timeouts) deletes the same exact IDs; verified with a timeout probe, probes removed.

Current results (sequential, no historical substitution): safety 91 PASS; client 81 PASS;
server/client/tests typecheck PASS; build PASS; auth/security 20 PASS; authorization 83 PASS;
security gate HC-QA-002..021 39 PASS; lifecycle 20 PASS; finding gate HC-QA-022..033 29 PASS
(qa:lifecycle exit 0); mocked smoke 13 PASS / 1 known HC-QA-001 FAIL.
Integrity after rerun: lifecycle tables empty; 0 duplicates/orphans/over-capacity/phantom offers/
contradictory lifecycle rows. Pre-existing Stage B suite residue grows +6 reports/+2 notifications
per authorization+gate run (now 18/6); not deleted.

Decision: Phase 7 signed off LOCALLY. HC-QA-001 (P1 UI) remains OPEN and is the next checkpoint
before booking-integrity/payment testing. Nothing deployed.

## Phase 7 — Activity & Circle lifecycle — 2026-10-01 (current)

Isolated QA only (`hello_circle_e2e_qa_7a01b2c0c87998f1`); no deploy, production/dev DB, Stripe,
email, OAuth or cloud media. Stage B not reopened: no security regression found.

New: `npm run qa:lifecycle` (10 batches, same guards). Lifecycle scope 20 PASS
(`--grep-invert 'HC-QA-0'`); default run then stops red at preserved findings.
New findings HC-QA-022..033 (18 failing regressions, each verified for its documented reason):

| ID | Sev | Category | Summary |
|---|---|---|---|
| 022 | P1 | Functional | Chat inbox 500 with ≥2 conversations; Circle chat button and /chats vanish |
| 023 | P2 | Functional (privacy) | UI Circle plans always public; invite-only Circle plan in anonymous discovery |
| 024 | P2 | Functional | Votes accepted after poll closed |
| 025 | P2 | Data integrity | /lifecycle stores cancelled/completed; status open, nobody notified |
| 026 | P2 | Functional | Stale waitlist entries → phantom held offers; offers when full |
| 027 | P3 | Functional | Free-activity leave tells host to refund |
| 028 | P3 | Functional | Cancel/archive/leave side effects (waitlist, repeat cancel, silent archive, host self-leave) |
| 029 | P3 | Functional | Updates oldest-first within the same second |
| 030 | P3 | Data integrity | Host profile gamesHostedTotal counts drafts/private |
| 031 | P3 | UX | Activity card photo area not clickable |
| 032 | P3 | UX | Draft confirmed as "You're live."; past dates accepted |
| 033 | P3 | Data integrity | Ghost Circle invites; repeat join request re-notifies |

Regression (sequential): safety 91 PASS; client 81 PASS; auth/security 20 PASS; authorization 83 PASS;
security gate HC-QA-002..021 39 PASS; lifecycle 20 PASS (+18 preserved findings red);
mocked smoke 13 PASS / 1 known HC-QA-001. HC-QA-001 reproduced on mobile activity detail
(consent button not clickable) but does not block join. Lifecycle residue zero; 5 games/5 Circles
from interrupted debug runs removed by exact scope. Existing authorization/gate runs added
6 reports + 2 notifications (Stage B fixture residue, not cleaned here).

## Isolated QA recovery — 2026-10-01 (current; validation COMPLETE)

Fresh isolated QA environment created using existing bootstrap with newly generated
QA-only credentials, after exact Docker identity verification and retirement of the
old disposable container. No product code, authorization, guard or regression changes.
Recovery details: QA_ENVIRONMENT_RECOVERY.md. Missing-file cause remains UNKNOWN.
Both private files remain outside Git with mode 0600. No development/production or
external service contacted; no deployment. All fixes remain local and undeployed.

| Current execution | Result |
|---|---|
| Safety | 91 PASS |
| Client | 81 PASS |
| Test typechecking | PASS |
| Build | PASS; existing large Mapbox bundle warning |
| Complete authentication/security | 20 PASS |
| Complete authorization/remediation | 83 PASS |
| Ownership/IDOR subset | 23 PASS |
| Aggregation/visibility subset | 11 PASS |
| Invitation-specific subset | 11 PASS, plus response-consumption case in revocation batch |
| Non-Circle chat | One scenario PASS covering four scopes; Circle checks in full authorization |
| Account-link closure | Two PASS |
| Revocation/consumption batch | Two PASS |
| Preserved Stage B findings subset | Seven PASS (010..016) |
| Complete security gate | 39 PASS, HC-QA-002..021; no exclusions |
| Mocked smoke | 13 PASS / unchanged HC-QA-001 FAIL |

Subset definitions are recorded in QA_ENVIRONMENT_RECOVERY.md. These overlapping
views are not additive totals. All real results above are CURRENT executions against
the fresh isolated database, not historical results. The previously blocked six auth
cases and entire authorization suite completed. Recovery smoke additionally verified
real browser login/session/refresh/logout and cross-user notification denial.

Final connected preflight passed; repeat seed verified all personas without replacing
their credentials. Operation lock released. Resource fixtures returned to zero for
activities/participants, invitations, Circles/members, waitlist, bookings/enrollments,
chat messages/reads, centres/programmes/experience/club resources, and sessions.
Not a pristine DB: two synthetic experience notifications and 15 analytics events
remain, plus three vendor organisations consistent with automatic persona setup.
No global cleanup performed; this bounded fixture-hygiene follow-up is not a newly
demonstrated security defect. Configuration and sanitized evidence are retained.

Generated QA credential scan: zero matches in tracked/unignored repository files;
zero staged files, no commits made. This is a scoped check, not a universal secret audit.

Decision: **Stage B SECURITY-COMPLETE LOCALLY for the defined matrix**. No confirmed
backend P0/P1 remains OPEN locally; HC-QA-002..021 gate is green. Activity/Circle
lifecycle testing may be the next approved checkpoint, followed by guarded booking
integrity. Stripe TEST MODE only after booking-integrity passes and a separately
verified sandbox profile is established; this QA profile still rejects Stripe keys.
No next phase was started. This is not production readiness or release approval.

Remaining categories: no unresolved demonstrated security boundary defect in this
scope; raw operational token storage and other identity-writer uniqueness remain
future hardening. External payment/email/OAuth/cloud-media integrations are pending.
All production deployment and historical migration/cleanup verification is pending.
HC-QA-001 remains the separate OPEN P1 UI defect.

## Stage B final closure — 2026-10-01 (historical blocked checkpoint)

The four review gaps were runtime-tested against isolated QA. Five bounded defects
HC-QA-017..021 were reproduced, minimally fixed, and regression-tested: invitation
status/expiry, email-recipient binding, invitation creation authorization, stale
account-link confirmation, and concurrent invitation response consumption.
All five are FIXED LOCALLY — NOT DEPLOYED. Details: QA_STAGE_B_FINAL_CLOSURE.md.
No confirmed OPEN backend P0/P1 remains in tracked local findings.

Current execution results (overlapping suites must not be summed):

| Layer | Current result |
|---|---|
| Safety | 91 PASS |
| Client | 81 PASS |
| Test typechecking | PASS |
| Build | PASS; existing Mapbox bundle warning |
| Complete security gate | 39 PASS: original 31 plus eight closure scenarios |
| Closure invitations/chat/link/revocation | Eight PASS, included in gate |
| Authentication/security | 14 PASS; remaining six BLOCKED before completion |
| Full authorization/remediation / IDOR / aggregation rerun | BLOCKED; prior 75 PASS is historical, not a current full rerun |
| Mocked smoke | 13 PASS / one unchanged HC-QA-001 FAIL |

Environment blocker: private QA environment.json and empty.env are missing. Connected
preflight aborts at configuration loading, before DB access. Read-only container
verification still matches the saved isolated manifest. The cause of file loss is
unknown; credentials were not reconstructed and safety checks were not bypassed.
No development/production access, deployment or external provider calls occurred.
Restore/reprovision the isolated QA configuration through an approved recovery step,
then rerun connected preflight, qa:auth and qa:authorization before sign-off.

Stage B is NOT SIGNED OFF. Security gate green does not substitute for incomplete
final validation. Do not start lifecycle, booking-integrity or Stripe tests yet.
HC-QA-001 remains OPEN. Raw operational token storage is future hardening; external
mail/OAuth/cloud/payment integration and all production deployment/migration work
remain pending, separate from this environment blocker.

## HC-QA-016 closure — 2026-09-29 (historical)

Scope: only game join/waitlist visibility and immediate source review. Guarded isolated
Docker QA MySQL, restricted identity, real backend/API. No development/production,
deployment, Stripe client/provider call, historical cleanup or lifecycle E2E.

HC-QA-016 P1 FIXED LOCALLY — NOT DEPLOYED. Original regression unchanged: FAIL before,
PASS after. Waitlist runtime-confirmed before fix (unrelated invite-only user 201),
then denied 404 after. Canonical canViewGame/loadViewableGame reused; no policy redesign.
Join guard precedes coupons, transaction and checkout; locked-row recheck prevents
activity publication/visibility changing unnoticed before mutation. Waitlist checks
under activity row lock before insertion. Public/invitee/Circle-member controls pass;
unrelated/former member, draft/future-publish residents denied with snapshots unchanged.

Paid control stops at existing 503 unconfigured-provider boundary; pending row cleaned.
Unauthorized paid request is 404 even with invalid coupon, before provider handling.
Test-only outbound attempt counter zero; no external call or payment completion.
Two legitimate free joins produce 200/409 and exactly one participant.

Focused 4 scenarios PASS (original + 3 new). Safety 91 PASS, client 81 PASS,
build PASS (known Mapbox bundle warning), mocked smoke 13 PASS / HC-QA-001 FAIL.
Final reruns: security gate **31 PASS** (HC-QA-002..016), authentication/security
**20 PASS**, full authorization/remediation **75 PASS**, typechecking PASS.
No exclusions, retries or expected-failure markers. HC-QA-016 focused four scenarios
are included in both gate and authorization totals, not additional platform coverage.

Subgroup views of the same full authorization execution (overlapping, not separately
summed runs): ownership/IDOR 23 PASS (ownership, personal, attendance-relations,
stage-b-attendance/vendor/org/host/circles/booking/personal batches); aggregation/
visibility bundles 11 PASS (leakage, visibility-adjacent, stage-b-aggregation,
stage-b-visibility and stage-b-visibility-2, including adjacent policy assertions);
invitation-specific batches 8 PASS (disclosure, hardening, binding, consumption,
states, history); preserved Stage B finding regressions 7 PASS (010..016).
These subgroup definitions are explicit and differ from previous grep-based totals.
All HC-QA-002..016 are green locally. Only known test failure is HC-QA-001 mocked UI.
One sandbox launch failure was an ENVIRONMENT ISSUE, then retried with approval.
New-test evidence filename errors were TEST BUGS, fixed without assertion changes.

Remaining sign-off gaps: non-Circle chat runtime coverage; account-link recheck;
activity invitation email-only token identity binding and status/expiry semantics
(source-review candidates, not exploited/confirmed); concurrent entitlement revocation;
external media and positive payment/refund completion. Operational token-at-rest and
historical cleanup remain separate. No new confirmed backend P0/P1 beyond HC-QA-016.
Do not infer whole Stage B or production readiness from this closure.

Files: production `routes/games.ts` only in this checkpoint; new
`tests/integration/specs/join-visibility.spec.ts`; runner/gate, sanitized reporter and
test-only backend outbound counter; HC-QA-016, visibility policy, matrices/report/README.
Original regression file unchanged. No new npm command.

Decision: HC-QA-016 is locally closed; join cannot manufacture eligibility and waitlist
uses the same canonical policy. Unauthorized paid requests stop before provider work.
No confirmed OPEN backend P0/P1 remains in the tracked local findings; deployment
verification is absent. Stage B remains NOT SIGNED OFF because the follow-up boundaries
above have not been resolved. Do not begin broad Activity/Circle lifecycle or booking-
integrity E2E automatically; review/resolve those gaps and approve the next checkpoint.

## Historical Stage B remediation — visibility policy + Circle boundaries (before HC-QA-016 closure)

HC-QA-010, 011, 012, 013, 014 (Model A, evidence-based), 015: **FIXED LOCALLY — NOT DEPLOYED**.
All six original regressions pass unchanged; 6 new remediation cases pass. New
**HC-QA-016 (P1, OPEN)** found while mapping visibility consumers: an uninvited resident
can join an invite-only activity and thereby gain full visibility — not fixed (outside the
approved scope; touches the join/checkout path). Stage B therefore cannot be signed off yet.

Server changes: `gameVisibility.ts` (canonical `canViewGame`/`loadViewableGame`,
`discoverableGameSql`, `filterViewable`), `routes/games.ts`, `routes/circles.ts`,
`routes/residents.ts`, `routes/sharing.ts`, `routes/clubSessions.ts`, `db/queries.ts`,
`nextSteps.ts`. Tests: `specs/stage-b-visibility{,-2}.spec.ts`, `specs/stage-b-open.spec.ts`,
runner/reporter batches, gate extended. Docs: `QA_ACTIVITY_VISIBILITY_POLICY.md`, HC-QA-010..016.
Server Vitest suite NOT run (its setup targets a shared database, which this checkpoint forbids).

Validation (separate lanes): safety 91 PASS · client 81 PASS · typecheck/build PASS ·
auth/security 20 PASS · security gate 27 PASS (HC-QA-002..015) · authorization 71 PASS then
stop at open HC-QA-016 (runs last) · IDOR 27 PASS · aggregation 11 PASS · invitation 13 PASS +
HC-QA-016 (matched by "invite-only") · Stage B findings 6 PASS / 1 FAIL (016) · mocked smoke
13 PASS / 1 FAIL (HC-QA-001). Residue check: zero synthetic rows.

Open: HC-QA-001 (P1 UI), HC-QA-016 (P1 backend). Follow-ups: waitlist path (same as 016,
source only), non-Circle chat scopes (runtime), account-link re-check, positive refund and
cloud media (external pending), historical attendance inventory (plan only).


## Phase 6B — Stage B completion (2026-09-29, CURRENT)

Scope: only previously BLOCKED / EXTERNAL Stage B groups, in the isolated QA
environment (`hello_circle_e2e_qa_91c6dd08741f075d`, guarded container, verified
pool identity). Development/production untouched. No Stripe, no provider/network
calls, no deployment, no product code changed, HC-QA-001 not touched.

**Outcome: coverage complete (0 BLOCKED), sign-off NOT given.** 6 new findings
preserved as failing regressions (2 × P1, 3 × P2, 1 × P3). No P0, no privilege
escalation, no cross-organisation/tenant bypass. Stop rules evaluated: nested
parent→child failures are isolated (1 new write IDOR + 1 design gap among ~40
relationship-scoped operations verified), so execution continued. Visibility/
aggregation defects ARE a recurring pattern (HC-QA-005 earlier; now 010/011/012/015),
caused by per-router visibility filters — flagged for centralized remediation.

### New findings

| ID | Sev | Summary |
|---|---|---|
| HC-QA-010 | P1 | `/games/:id/participants` and `/updates` return names and host text for invite-only/draft activities (canonical 404) |
| HC-QA-011 | P1 | Circle `upcoming`/`nextPlan` aggregate invite-only, draft and scheduled activities of any host by activity label (anonymous enumeration; feeds 010) |
| HC-QA-012 | P2 | Host profile lists draft + scheduled activities; `GET /games` lists scheduled (shared SQL constant ignores `publish_at`) |
| HC-QA-013 | P2 | Poll vote under own Circle accepts another Circle's poll (nested write IDOR; vote recorded) |
| HC-QA-014 | P2 | Any resident can attach an activity to any Circle; shown as the Circle's own plan (code says intentional → product decision) |
| HC-QA-015 | P3 | Public club schedule readable for pending/paused/deleted clubs |

Non-security note (no ID): malformed JSON returns generic 500 instead of 400; no leakage.

### Remaining uncertainty

- Positive refund completion (programme/booking/registration/experience/game) — EXTERNAL PENDING.
- Real R2/Cloudinary delivery/deletion and private cover delivery — EXTERNAL PENDING.
- Other `DISCOVERABLE_LIFECYCLES_SQL` consumers (`db/queries.ts:1240/1248`,
  `nextSteps.ts:92`) and Circle `recent-activity`/`activity` — same pattern as
  012/011 by source; not separately runtime-tested.
- Aggregate counts (momentum, liquidity, `plansThisMonth`) include private/draft
  activities as counts/labels only — not assessed as disclosure.
- Chat executed for Circle scope only; game/experience/program/club chat scopes are source-reviewed.
- Manage `link/confirm` does not re-check an existing link; two vendors could both be
  linked if the inbox owner confirms both — source-only.
- Admin covered by 15 representative operations × 6 roles; not every admin route.
- Historical malformed attendance: not inventoried; plan in QA_ATTENDANCE_HISTORICAL_CLEANUP_PLAN.md.
- Stripe webhook, mobile app, multi-instance limiter, production data — out of scope.

### Tests (separate lanes; overlapping counts are not summed)

Safety 91 PASS · Client 81 PASS · Typecheck/build PASS · Auth/security 20 PASS ·
Security gate 21 PASS (HC-QA-002..009) · Authorization/remediation 59 PASS then
stop at preserved findings (each of HC-QA-010..015 fails independently) · IDOR subset
26 PASS · Aggregation subset 5 PASS (+ 3 open aggregation findings) · Invitation
subset 12 PASS · Mocked smoke 13 PASS / 1 FAIL (HC-QA-001).

### Files

New: `tests/integration/stage-b-fixture.ts`; `specs/stage-b-{vendor,refund,org,host,
circles,aggregation,admin,booking,personal,errors,media,findings}.spec.ts`;
`QA_BUGS/HC-QA-010..015.md`; `QA_ATTENDANCE_HISTORICAL_CLEANUP_PLAN.md`.
Changed: `tests/integration/run.ts` (Stage B batches + `security-gate` mode),
`tests/integration/reporter.ts` (batch allowlist), `package.json` (`qa:security-gate`),
QA matrices, this report, `tests/README.md`. Test correction during the run: the
foreign org-invite revoke is an org-scoped 200 no-op (like programme session delete);
expectation changed from 404 to 200 with the unchanged DB snapshot as the assertion.


## HC-QA-008 parent/child remediation — 2026-09-29 (current)

Scope remains paused Stage B: only the original attendance read, immediate
attendance/enrollment descendants and existing regression reruns. Isolated guarded
QA only; no development/production, deployment, Stripe, paid data or external email.

HC-QA-008 P1: FIXED LOCALLY — NOT DEPLOYED. Original regression unchanged: FAIL
before, PASS after. The GET handler authorized the parent but read attendance by a
global session prefix. It now resolves session.id AND program_id and joins attendance
through programme-scoped enrollments with an exact composite ref. Foreign/missing
parent 403; foreign/missing child of an owned parent identical 404. Owner path 200.
Both substitution directions, nonexistent IDs, guest denial, wildcard input and
historical malformed descendant association pass. Complete programme/session/
enrollment/attendance snapshots plus auth-session/audit snapshots unchanged on reads.

New HC-QA-009 P2: attendance POST accepted a foreign programme's enrollment ID and
created an invalid association under the caller's OWN session (200). No victim
enrollment or real victim-session attendance was overwritten; no broad cross-tenant
compromise demonstrated. Narrow guard now requires enrollment.program_id equal to
the authorized session.program_id; canonical DB IDs form the ref. Original new
failing write assertion now PASS: foreign/nonexistent enrollment 404 with no changes,
foreign session 403, legitimate owner create/update 200. FIXED LOCALLY — NOT DEPLOYED.

### Narrow sibling source review

| Endpoint/helper | Classification | Reason | Tested |
|---|---|---|---|
| requireVendor / attachVendorIds / programOwnership | SAFE within tested model | Approved vendor + same-org vendor IDs + programme owner predicate | Real paired-org read/write controls |
| GET /vendor/programs/:id/sessions/:sessionId/attendance | SAME PATTERN, FIXED | Missing child-parent check; now scoped session and descendant joins | Original + focused matrix PASS |
| POST /vendor/program-sessions/:sessionId/attendance/:enrollmentId | SAME PATTERN, FIXED HC-QA-009 | Missing enrollment relationship; now requires same programme | Denied mutations + valid owner write PASS |
| GET /vendor/programs/:id/enrollments | SAFE (source); bounded denial verified | Ownership then program_id and paid-status predicate | Foreign programme 403; paid positive path not executed |
| DELETE /vendor/programs/:programId/sessions/:sessionId | SAFE within tested substitution | UPDATE includes both IDs | Foreign child 200 no-op; full DB invariant PASS |
| POST /vendor/programs/:programId/enrollments/:enrollmentId/cancel | SAFE within tested substitution | Lookup includes both IDs | Foreign child 404; full DB invariant PASS |
| POST /vendor/programs/:programId/enrollments/:enrollmentId/refund | SAFE source relationship; runtime excluded | Lookup includes both IDs, finance gate | NOT EXECUTED — payments prohibited |
| POST /vendor/programs/:id/sessions (roomId) | NEEDS TEST | Source binds room to programme centre | No new room assignment test in this checkpoint |
| Bulk/delete/reset attendance APIs | NOT APPLICABLE | No such endpoints in programme router | Not invented |

### Results / remaining uncertainty

Focused attendance: 4 PASS (original unchanged + read/write/sibling scenarios).
Safety 91 PASS; client 81 PASS; test typechecking/build PASS; known Mapbox bundle
warning unchanged. Mocked smoke 13 PASS / 1 unchanged HC-QA-001 failure.
Full real authentication/security: 20 PASS (8 authentication, 12 security).
Full authorization/remediation: 41 PASS, without exclusions; the four focused
attendance scenarios are included in those 41, not additional coverage.
HC-QA-002 through HC-QA-008 all PASS; adjacent HC-QA-009 also PASS. All remain
FIXED LOCALLY — NOT DEPLOYED. Connected isolation guards passed for real suites.
`git diff --check` passed. No new npm commands were added.

Production code changed only server/src/routes/vendorPrograms.ts. Added
programme-fixture.ts and attendance-relations.spec.ts; registered batch in runner/
reporter. Original stage-b-attendance.spec.ts unchanged. Added HC-QA-009 report and
updated HC-QA-008, QA matrices, report and README. No application architecture rewrite.

Remaining: historical malformed attendance is excluded, not migrated; refund/paid
enrollment functionality not executed; no lifecycle/room-assignment expansion;
broader Stage B gaps, raw operational-token storage and exceptional logging remain
separate. No deployment or production-readiness claim. Controlled isolated Stage B
may resume only after review; this checkpoint stops without starting it.

## Historical Phase 6 — significant cross-organisation disclosure; STOP (2026-09-29, before remediation)

Stage B is NOT complete. HC-QA-008 (P1, CONFIRMED OPEN) triggered the explicit
stop rule. No remediation or production-code change was made. Only the existing
baseline regressions are rerun after the stop; no further new authorization probes.
QA Docker/MySQL identity and grants verified by the established connected guard.
Development/production untouched; no Stripe, checkout, real transaction or external
storage/email operation. Synthetic unpaid enrollment was used only for authorization.

### Evidence / new finding

Vendor B and vendor A have distinct verified organisations. Owner A reads its session
attendance (200). B using A's programme ID is denied (403). B using its own programme
ID with A's session ID receives A's enrollment ID and attendance status (200).
Full programme/session/enrollment/attendance snapshots are unchanged. Exact fixture
cleanup ran; sanitized evidence preserved. Root cause: programme ownership is checked
but session-to-programme association is not, before querying session-prefixed
attendance. No private contact fields, write bypass or escalation was demonstrated.
See QA_BUGS/HC-QA-008.md. Failing regression remains unskipped and runs first by default.

### Matrix accounting

The new ledger enumerates remaining WORK GROUPS, not a full platform endpoint count:
TOTAL 17, TESTED 1, PASS 0, FAIL 1, BLOCKED 14 (mandatory stop), NOT APPLICABLE 1,
EXTERNAL INTEGRATION PENDING 1. Prior proven test scenarios are separate and retained.
Critical/high gaps: remaining admin/staff mutations, vendor club/experience writes,
programme children, host lifecycle/capacity, Circle roles/content/chat, host/Circle/
scheduled aggregation, unpaid booking variants, exceptional-path logging, account
linking/workspace switching. Personal-operation variants remain medium-risk gaps.

### RBAC / ownership / leakage

- Guest/user/host: previous scoped denials and self-data boundaries retained; not
  exhaustive role sign-off. No new escalation demonstrated.
- Vendor: cross-organisation attendance READ FAIL; existing centre/room/programme
  mutation tests do not protect this separate read endpoint.
- Read-only staff/manager: existing management/invitation boundaries retained;
  expanded operational/admin variants blocked by stop.
- Admin: prior positive read and representative non-admin denial only; broader
  mutation matrix incomplete.
- Profiles/households/notifications: previously tested self/child isolation retained;
  remaining variants blocked. No new disclosure demonstrated in these resources.
- Hosts/activities/Circles: prior private/ownership tests retained; additional
  transitions, membership/child and aggregation tests blocked.
- Sessions/child resources: HC-QA-008 FAIL; no further write probes after discovery.
- Bookings: earlier synthetic-unpaid authorization retained; new programme attendance
  leak is participation/operational data, not payment compromise.
- Media: existing permission checks retained; real cloud delivery/deletion EXTERNAL
  INTEGRATION PENDING, never simulated as a pass.
- Favourites/host-follow feed: prior focused visibility tests retained. Host-profile,
  Circle summaries/upcoming and scheduled discovery remain source candidates, not PASS.
- Error/exception, secrets: no new probe after stop; earlier raw exceptional logging
  review remains open. No secret-bearing response/body is included in this report.

### Validation / failure classification

Safety 91 PASS, client 81 PASS, test typechecking/build PASS. Build has the existing
large Mapbox chunk warning. Authentication/security 20 PASS (8 auth, 12 prior
security). Mocked smoke 13 PASS / 1 unchanged HC-QA-001 application failure.
New targeted authorization/IDOR regression: 1 SECURITY FAILURE, HC-QA-008.
Pre-existing authorization/remediation baseline: 37 PASS, using explicit grep-invert
exclusion solely for regression validation. That diagnostic run is NOT an all-green
full authorization suite. HC-QA-002/003/004/005/006/007 all PASS unchanged.

Separate coverage subsets (not additive suite totals): RBAC 4 prior cases PASS;
ownership/IDOR 8 prior cases PASS plus 1 new HC-QA-008 FAIL; aggregation 3 prior
favourites/club-session/host-feed scenarios PASS, new host-profile/Circle/scheduled
visibility probes BLOCKED. Invitation security 8 PASS; recovery/logging 14 PASS.
Authentication/security's 20 PASS comprises 8 auth and 12 prior focused security.
No new error-leakage/manual/external-service coverage is claimed. `git diff --check`
PASS. Known failures: HC-QA-008 (API/DB security) and HC-QA-001 (mocked mobile UI).

An initial anchored Playwright grep selected zero tests; no coverage was credited.
Corrected unanchored filter reproduced the defect with real API/DB evidence.
No failing assertion was weakened, no expected-fail/skip added.

### Files and decision

Created stage-b-attendance.spec.ts and QA_BUGS/HC-QA-008.md. Updated integration
run.ts/reporter.ts to register the first failing batch, and QA_AUTHORIZATION_MATRIX.md,
QA_TEST_MATRIX.md, QA_REPORT.md, tests/README.md. No production implementation edited.

Stage B sufficiently complete? NO. New P0/broad escalation confirmed? NO, but a
significant cross-organisation P1 is OPEN. Activity/Circle lifecycle, booking-integrity
and Stripe test-mode progression: NOT RECOMMENDED until scoped remediation/retest
and remaining high-risk matrix completion. No production-release recommendation.
STOP for review; do not automatically remediate or continue probing.

## Invitation security closure — 2026-09-29 (current)

Only isolated QA was used. No development/production access, deployment, payment,
external mail, broad IDOR expansion or HC-QA-001 UI change. This supersedes earlier
statements that recipient binding/atomicity were deferred.

Previous product contract: public acceptance supported both signed-out new-recipient
onboarding and signed-in requests; it ignored authenticated identity. New contract
preserves onboarding but compares ALL attached vendor/resident/guest normalized
emails with the invite recipient and rejects conflicts with generic 403 before
mutation. Mixed identity cookies fail closed. Existing vendor email remains a 409,
never an upgrade/link. HC-QA-007 (P1, code-confirmed identity-binding defect) is FIXED
LOCALLY — NOT DEPLOYED. No pre-fix privilege escalation was attempted or claimed.

Acceptance now validates under SELECT FOR UPDATE inside the account-creation and
consumption transaction. Invalid status/expiry/organisation, recipient mismatch or
existing account produces no mutation. Unique-email races return a safe 409 after
rollback. Only committed success creates a session. Real concurrency regression:
exactly one 201 and one 400, one account with intended org/read-only role, one
session, loser anonymous, replay rejected. Duplicate successful acceptance was not
demonstrated before remediation; the architecture was hardened defensively.

Four synthetic historical records were classified active/expired/accepted/revoked.
QA-only guarded cleanup revoked the active credential before audit redaction,
preserved four history rows and their actor/type/event/timestamp, removed token
material and passed idempotent replay. No real historical records were inspected.
Production plan: QA_INVITATION_AUDIT_MIGRATION_PLAN.md; no production migration command.
Operational recovery/verification/invitation/session tokens remain raw in DB tables.

Completed checks: safety 91 PASS; client 81 PASS; typechecking/build PASS;
authorization/remediation 37 PASS, including 8 invitation scenarios (5 newly added).
Mocked smoke 13 PASS / 1 unchanged HC-QA-001 failure. Full auth/security rerun:
20 PASS (8 authentication + 12 prior security). HC-QA-002/003/004/005/006 PASS,
original regressions preserved; new binding/concurrency/history checks PASS.
`git diff --check` PASS. Build retains the known large Mapbox bundle warning.

Remaining: historical deployment/audit retention; broader error-log redaction and
operational token-at-rest hardening; untested broader aggregation/authorization
backlog. Known local invitation acceptance gaps are closed by the tested boundaries,
not proof of universal security. Controlled isolated Stage B may resume after review;
not production release or booking/payment sign-off. STOP, no automatic continuation.

Files: auth.ts scoped acceptance change; new invitation fixture/history helper and
binding/consumption/states/history specs; runner/reporter batch registration;
HC-QA-007 report and historical migration plan; required QA docs updated. HC-QA-006
GET projection and audit fixes, HC-QA-001–005 implementation/regressions unchanged.

## Defensive hardening — 2026-09-28 (current; supersedes statuses below)

Scope: HC-QA-003 -> 004 -> 005 revalidation, then invitation audit hardening and
acceptance/storage code review. Broad Stage B remains paused. No production/dev DB,
Stripe, external email, other recipient redemption or privilege-escalation probe.

HC-QA-003/004/005 were already fixed in the working tree. Original regressions were
rerun in the requested order and passed, with no weakened assertions or repeated
refactor. All are FIXED LOCALLY — NOT DEPLOYED. Recovery: one 200/one 400, winner-only
password and one resident session, no loser/replay session; vendor reset creates
no session as designed. Email: constant-only fallback/error diagnostics, all ten
mode/transport checks pass. Favourites: shared canonical visibility, public-to-draft
revocation verified, saved relation retained. Club-session adjacent test uncovered
an incorrect SQL alias; failed before, passed after the one-token correction.

Invitation audit creation now records the non-redeemable ID plus org/actor/recipient/
role metadata; revocation audits only matched safe IDs. Raw-token audit regression
failed before and passed after. Historical records/backups untouched and require
operator review before deployment. HC-QA-006 response disclosure fix and regression
remain unchanged. No authenticated-recipient binding or acceptance concurrency
redesign implemented. An existing synthetic caller's OWN invitation returns 409,
with identity, invite and session snapshots unchanged; no invitation was accepted.

See QA_INVITATION_SECURITY_REVIEW.md for recipient-binding design, unique-email
backstop versus atomic consumption, secret inventory, and narrow aggregation review.
Bearer tokens remain stored raw in their operational DB tables; passwords remain
bcrypt. No application-layer encryption or token-hash migration added. Provider/DB
exception logging and related aggregation query gaps are source-review candidates,
not newly demonstrated compromise. Do not equate green scoped tests with global
authorization coverage.

Validation already complete: safety 91 PASS; client 81 PASS; test typechecking and
server/client build PASS; real authentication/security 20 PASS (HC-QA-002 included).
Final full authorization/remediation: 32 PASS, zero failures. Mocked smoke: 13 PASS,
1 known HC-QA-001 FAILURE, unchanged, with existing screenshot/video/trace capture.
HC-QA-002/003/004/005/006 all PASS. Existing large Mapbox bundle warning remains.

| Finding | Severity | Current status | Deployment |
|---|---|---|---|
| HC-QA-001 | P1 | OPEN, unchanged UI regression | No fix/deployment |
| HC-QA-002 | Historical P0 | FIXED LOCALLY; regression PASS | NOT DEPLOYED |
| HC-QA-003 | P1 | FIXED LOCALLY; concurrency regression PASS | NOT DEPLOYED |
| HC-QA-004 | P1 conditional | FIXED LOCALLY; canary regression PASS | NOT DEPLOYED |
| HC-QA-005 | P1 | FIXED LOCALLY; visibility regressions PASS | NOT DEPLOYED |
| HC-QA-006 | P1 disclosure | FIXED LOCALLY; response and new audit records protected | NOT DEPLOYED; historical records not scrubbed |

Unresolved review items, not demonstrated escalation: invitation recipient binding,
atomic consumption, historical credential retention; narrow aggregation and raw
provider/DB exception logging candidates. No severity inflation or production claim.

Changed production in THIS checkpoint: server/src/routes/org.ts (audit payloads
only; disclosure response untouched), server/src/routes/favourites.ts (SQL alias).
Added invitation-hardening.spec.ts, expanded visibility-adjacent.spec.ts, integrated
new test batch into run.ts/reporter.ts. Existing security regression files preserved.
Created QA_INVITATION_SECURITY_REVIEW.md; updated reports/matrices/README/bug notes.

Decision: known named defects are locally remediated except HC-QA-001. Invitation
binding/concurrency and historical audit exposure remain unresolved high-risk review
items; no demonstrated escalation. Obtain review of those items before resuming
broad Stage B. No production-readiness recommendation. STOP for review.

## HC-QA-006 — defensive invitation disclosure fix (2026-09-28, latest)

Exploitation probe and broad Stage B stopped at user direction. No invitation
redemption or privilege escalation attempted. Guarded isolated QA backend/MySQL
only; development/production untouched, no external mail or payment service used.

Confirmed P1 credential disclosure, NOT demonstrated privilege escalation:
GET /api/vendor/org selected raw pending invitation tokens for every approved
vendor, including read-only analysts and invited managers. Residents/guests denied.
Only owners have invitation-management authority in the actual application.

Fix: staff receive no pending invitations. Owners receive id, email, role, status,
created/expiry dates. Non-redeemable SHA-256 IDs replace tokens for owner-only,
org-scoped revocation; UI/shared contract updated. No schema change. Creation and
acceptance logic unchanged. FIXED LOCALLY — NOT DEPLOYED.

Acceptance review: pending/expiry checks; DB-bound email/org/role, no comparison
with current authenticated identity; existing email rejected. Sequential reuse
rejected, concurrent consumption not atomic by inspection and not reproduced.
Existing creation audit records contain raw tokens: separate residual risk.
See QA_BUGS/HC-QA-006.md. No claim that acceptance is runtime-verified here.

Validation complete: disclosure regression failed before fix and passed afterward;
91 safety and 81 client tests pass; test typechecking and server/client build pass
(existing Mapbox chunk warning); real authentication/security 20 pass (8 auth,
12 existing security). Full authorization/remediation suite: 29 passed, zero
failures (includes HC-QA-006, unchanged HC-QA-003/004/005 and adjacent checks).
Mocked browser smoke: 13 passed / 1 failed, unchanged HC-QA-001 cookie/mobile
navigation interaction; artifacts retained by the existing runner. No new browser
invitation test or SMTP integration test; direct API/DB assertions carry this fix.
`git diff --check` passed. No new npm command; use `qa:authorization` with the
`--grep INVITATION-DISCLOSURE` filter for the focused regression.

Previous Stage A completed: HC-QA-003/004/005 and adjacent regressions passed
(28 authorization/remediation cases). Those fixes and HC-QA-002 are unchanged in
this focused checkpoint. HC-QA-001 remains OPEN. Broad Stage B remains paused.
The Phase 4 results below are historical, not current defect statuses.

Files for this focused checkpoint: created HC-QA-006.md and
invitation-disclosure.spec.ts; changed org.ts, packages/types/src/index.ts,
client VendorOrg.tsx and api/vendor.ts, integration run.ts/reporter.ts,
QA_REPORT.md, QA_AUTHORIZATION_MATRIX.md and tests/README.md.
No HC-QA-001 through HC-QA-005 remediation code or reports changed here.

## Phase 4 — authorization/RBAC/IDOR (2026-09-28, historical)

### Executive summary / environment

Bounded real authorization checkpoint delivered, **not full authorization sign-off**. Twelve new authorization/ownership scenarios passed; three security regressions demonstrate open defects. No new P0 or broad privilege escalation was confirmed. No application source was changed in this phase. Production/shared development, Stripe, live Google, external storage and customer email were not accessed.

Same dedicated disposable Docker MySQL, loopback-only database port, restricted hello_circle_qa user; connected identity/container/grants preflight passed. Seven deterministic personas now include resident/host/vendor A/B pairs plus admin. Paired vendors' distinct organisations were checked before cross-owner tests. Additional scenario-local read-only staff and recovery identities are removed after use. No root test connections or global database cleanup.

### Authorization inventory / RBAC

See `QA_AUTHORIZATION_MATRIX.md`: source-derived route-family inventory and exact executed method/actor table. Reviewed sensitive boundaries include residents, household, notifications, host games, Circles/membership, vendors/organisations, listings/rooms/program sessions, admin, booking capabilities, media, favourites and recovery. Broader discovered route families are explicitly inventory-only or pending.

- Guest: denied protected admin/vendor/host/Circle mutations and private reads tested.
- Resident: self-profile and private data scoped to session; injected identity/credential/role fields ignored; no admin access.
- Host: A's private draft management/edit/publish denied to B; actual host model is resident ownership, not a separate global role.
- Vendor: cross-organisation listing and child manipulation denied; unrelated admin role has no implicit vendor route access.
- Admin: representative admin read positive control; non-admin status mutation denied with full vendor-row invariant. Not every admin action tested.
- Staff: read-only analyst may read same-org listing but cannot edit/delete, change organisation privileges or access admin APIs.

### IDOR / privilege escalation

Profile identity, household children, notifications, export, host draft, Circle organiser/membership, vendor listing/room/program-session ownership and seeded unpaid booking authorization passed the tested operations. Circle open/approval/invite modes used positive member/owner and negative guest/non-member controls. Cross-parent room returns 404; cross-parent program session returns 200 with no mutation—correctly counted by DB invariant, not status alone.

Media authorization was tested before storage access for owned activities, Circles and centres. Private Circle cover endpoints rejected non-members with an existing synthetic reference. Cloud upload, delivery and deletion remain BLOCKED until isolated storage exists; no actual media object was created/deleted.

No tested role/ownership injection granted privilege. Untested staff roles, all role/resource combinations, chat/moderation, wider experience/club mutations, preference/follow/routine surfaces and all lifecycle variants remain pending. This is not proof that every sensitive endpoint is secure.

### New and formalized findings

| ID | Severity | Status / evidence | Regression |
|---|---|---|---|
| HC-QA-003 | P1 | CONFIRMED OPEN: same valid resident recovery token concurrently accepted twice; 200/200, two DB sessions, both callers authenticated. Token possession required, not tokenless takeover. | Failing real API + DB test preserved |
| HC-QA-004 | P1, configuration/log-access prerequisite | CONFIRMED OPEN: actual fallback logs synthetic bearer link without SMTP under test and production mode. Local email-only processes; no deployed logs or real secrets inspected. | Failing email-module diagnostic preserved |
| HC-QA-005 | P1 | CONFIRMED OPEN: another resident saves private draft ID, then favourites hydration reveals title/date/time although detail API returns 404. Victim row unchanged. | Failing real API + DB test preserved |

Full reports: `QA_BUGS/HC-QA-003.md`, `HC-QA-004.md`, `HC-QA-005.md`. Sanitized local evidence: `.qa-data/<run>/evidence/hc-qa-003.json`, `hc-qa-004.json`, `hc-qa-005.json`. No passwords, hashes, session cookies, tokens, raw request bodies or real recovery links in evidence. No automatic remediation.

### Data/error leakage

Private draft metadata disclosure is confirmed (HC-QA-005). Tested self-export excluded password_hash and remained self-scoped; restricted Circle teaser withheld member-only fields. No new provider-token/stack/SQL-response leak was demonstrated. Comprehensive exceptional-path/error testing is **not completed**. The generic final API error handler is source-reviewed; media has its own error handling and needs a separate scoped review. HC-QA-004 is log disclosure, not API response leakage.

### Tests executed — separate layers

| Layer | Result | Meaning |
|---|---|---|
| Connected preflight | PASS | Real read-only database/container/grants identity verification |
| Safety | 91 passed | Offline safeguards, no customer DB mutation |
| Client | 81 passed | Client unit tests; root `npm test` deliberately not used because server tests can load development configuration |
| Test typechecking | PASS | `npm run qa:check` includes tsc |
| Build | PASS | Server/client TypeScript and Vite; existing large Mapbox chunk warning |
| Real authentication | 8 passed | Existing real UI/API auth/session/role cases |
| Existing focused security / HC-QA-002 | 12 passed | Includes original unchanged regression; full `qa:auth` = 20 passed, zero failures |
| Authorization + IDOR default run | 12 passed, 1 SECURITY FAILURE | Stops at HC-QA-005; later diagnostic batches not executed in this default invocation |
| Recovery concurrency, focused invocation | 1 SECURITY FAILURE | HC-QA-003, 200/200 and two sessions |
| Fallback logging, focused invocation | 1 SECURITY FAILURE | HC-QA-004; canary only |
| Mocked browser smoke | 13 passed, 1 APPLICATION FAILURE | HC-QA-001 remains OPEN; original regression unchanged |
| External sandbox | NOT EXECUTED | No Stripe, real mail delivery, Firebase or cloud media |
| Manual / comprehensive security review | PENDING | No production testing; no claim of exhaustive penetration test |

The 12 authorization passes comprise 4 RBAC/browser cases and 8 ownership/IDOR cases. They are not a percentage of product coverage. Primary security evidence is API+DB; selected Chromium desktop real-browser verification passed. Mobile remains mocked coverage with HC-QA-001 open.

### Failure classification and test corrections

- Product/security failures: HC-QA-003/004/005 remain visibly red, not skipped or expected-failed.
- Existing product/UI failure: HC-QA-001 mobile navigation intercepts cookie control clicks; screenshot/video/trace remain under ignored smoke artifacts.
- Test bugs corrected: new helper initially referenced the wrong Playwright exported type; corrected to PlaywrightWorkerArgs. A new unpaid-booking fixture omitted mandatory centre rating/reviews fields; schema inspection confirmed the error, fixture corrected, authorization checks then passed. Neither changed product behavior or weakened assertions.
- Environment restriction: first new runner invocation hit sandbox IPC permission; rerun with approved permission, not a product bug.
- Filtered empty batches retain prior evidence and are not counted as coverage. Unfiltered missing tests fail. Default runner stops on the first failure; separately targeted findings are reported independently, not called one all-green run.

### Files / commands

Created: QA_AUTHORIZATION_MATRIX.md; QA_BUGS/HC-QA-003.md, HC-QA-004.md, HC-QA-005.md; tests/integration/authorization-fixture.ts; authorization-boundaries, ownership, personal, staff, leakage, logging and recovery spec files.

Modified: package.json (`qa:authorization`); tests/integration/seed.ts, run.ts, reporter.ts; QA_ENVIRONMENT.md; QA_TEST_MATRIX.md; tests/README.md; this report. Existing dirty production changes belong to preceding checkpoints and were not altered in Phase 4.

### Recommendation / stop

Do **not** progress to Activity/Circle broad E2E, booking integrity or Stripe sandbox yet. Review and authorize scoped remediation of the three open P1 findings, preserve their regressions, then finish explicitly pending authorization surfaces. HC-QA-002 remains fixed locally/not deployed; deployment verification is still separate. HC-QA-001 remains OPEN. Stopping for review; no next-phase work started.

## HC-QA-002 remediation — previous checkpoint

### HC-QA-002

Status: **FIXED**, verified only in the isolated local QA environment. Historical severity remains **P0**. No deployment was performed.

Root cause: public signup interpreted an existing resident's null password as permission to attach credentials based only on a normalized email string. It returned that existing identity, allowing the API to issue a session before email confirmation.

Minimal remediation: `createResidentWithPassword` now returns the conflict sentinel for **any existing email**. No credential, terms/profile, provider or session mutation occurs on that branch. The API's existing generic 409 handles it, and the UI already displays that error without redirecting. The client API documentation was corrected. No schema, OAuth, reset, UI or hashing behavior was redesigned.

### Attack regression

- **Before fix:** original `SEC-REVIEW-001` re-run failed, matching the confirmed takeover.
- **After fix:** same spec, unchanged, passes; latest probe records signup 409, no password assigned, no original identity access, Google link preserved and protected API 401.
- **Direct API:** Google/passwordless/password-existing collisions, case/whitespace variants and repeated attempts passed. No Set-Cookie, token fields, authenticated redirect or authenticated state from rejected requests.
- **Browser:** actual signup UI → real backend → QA DB rejects the existing Google identity and stays on signup with the existing generic error.
- **Database invariants:** full original resident row compared before/after without printing values/hashes; ID, email, credentials, Google UID, host status, profile ownership and consent remain unchanged. No attacker database session is created.
- **Attacker login:** selected password rejected with 401 after the blocked attack.
- **Original OAuth identity:** real HelloCircle UID resolver returns the original resident before/after attack. Live Google UI/Firebase token verification remains intentionally untested.

### Legitimate authentication

New signup passes with one account, intended initial session, password hash, terms metadata and a 15-minute email-verification token. Verified-token consumption confirms email; serial replay is rejected. This preserves the existing product behavior of allowing an initial session before confirmation, rather than silently changing registration policy.

Existing password login, protected access, refresh persistence and logout pass, including all four established persona UI logins. Original provider linkage/resolution remains intact. Synthetic tokens were obtained from guarded QA MySQL to simulate inbox possession; no real email was sent.

### Security checks

| Check | Result / boundary |
|---|---|
| Email normalization | Case variants conflict. Existing API rejects surrounding whitespace with 400; direct normalized service invocation also conflicts. No provider-specific canonicalization added |
| Duplicate account | Generic 409 for password and passwordless accounts; no password/provider/profile update |
| Password reset | Passwordless request creates no reset token/session. Invented and expired tokens rejected. Valid token bound to original email, even with a different submitted email; serial replay rejected |
| Race/uniqueness | Real concurrent new signup: one 201, one 409, one DB row/session, winning password preserved. Existing unique email index and duplicate-key handling retained |
| Provider information | Duplicate response is identical across supported account models, without identifying Google or another sign-in method |
| Logging | No new auth/PII/token logging. Existing non-SMTP mail fallback logs token-bearing links; QA suppression retained. Separate source finding, deployment exposure not assessed |
| Rate limiting | Existing 10-attempt/15-minute password limiter and 5-attempt magic-link limiter unchanged. Four fresh-backend test batches keep attempts bounded; no limiter bypass or excessive retries |
| Existing add-password path | `/api/residents/me/password` is separately resident-session gated; existing-password changes require current password. Not redesigned |

**Remaining source-audit finding:** resident reset consumption uses nontransactional lookup/update/delete, leaving a potential concurrent token replay race. Serial replay was tested; concurrent reset replay was not reproduced or remediated. A secret reset token is still required; no equivalent email-string-only reset takeover was found. Track this and non-SMTP token logging separately, without presenting all authentication hardening as complete.

### Tests

| Layer | Final result |
|---|---|
| Safety | **91 passed**, 3 files |
| Client | **81 passed**, 11 files |
| Typechecking | **PASS** (`qa:check`) |
| Build | **PASS** (existing Mapbox chunk-size warning) |
| Mocked smoke | **13 passed / 1 failed** — unchanged HC-QA-001 |
| Existing real authentication cases | **8 passed** |
| Security regression cases | **12 passed** — original regression plus 11 focused cases |
| Full `qa:auth` | **20 passed / 0 failed**, zero retries; core 9, collisions 5, flows 4, recovery 2 |

An intermediate new helper incorrectly required a physically empty cookie jar after legitimate logout. Inspection showed an empty, non-authenticating cookie caused by existing Express clearCookie/maxAge behavior; the corrected logout assertion verifies no credential-bearing cookie and denied API access. **Rejected signup still strictly requires zero cookies**. The original HC-QA-002 regression was never weakened or edited.

An intermediate concurrent mocked/real run produced 12 passes/2 failures: HC-QA-001 plus a Vite `504 Outdated Optimize Dep` load failure. Both configurations used the same optimizer cache; the real-auth config now uses its own ignored cache directory. Final real and mocked runs passed their expected cases without changing smoke assertions. Failed-run artifacts remain under `test-results/hc-qa-002-mock`; final known mobile defect artifacts are under `test-results/hc-qa-002-mock-final`.

Sanitized real results: `.qa-data/qa_91c6dd08741f075d/evidence/auth-results-{core,collisions,flows,recovery}.json` and latest `passwordless-signup.json`. No credential-bearing recordings or storage states. See [HC-QA-002](QA_BUGS/HC-QA-002.md) for the preserved historical reproduction and detailed remediation note.

### Existing bugs / files / recommendation

- HC-QA-001: **OPEN**, unchanged. HC-QA-002: **FIXED in local QA; production deployment not performed**.
- New files: `tests/integration/security-fixture.ts`; `specs/signup-collisions.spec.ts`, `specs/signup-flows.spec.ts`, `specs/signup-recovery.spec.ts` under `tests/integration`.
- Modified this checkpoint: `server/src/residents.ts`; `client/src/api/resident.ts` (comment only); integration `run.ts`, `reporter.ts`, `vite.config.ts`; `QA_BUGS/HC-QA-002.md`, `QA_REPORT.md`, `QA_TEST_MATRIX.md`, `QA_ENVIRONMENT.md`, `tests/README.md`.
- No packages, migrations, new commands, UI fixes, provider changes, payments, bookings or IDOR mutations added. Pre-existing uncommitted changes were preserved. Protected development/production databases were not touched.

**Recommendation:** the repaired signup boundary is sufficiently verified to propose the next isolated authorization/IDOR checkpoint, after review/approval. This is not approval to release the whole platform or a claim that provider/recovery hardening is complete. Review and deploy the security patch before calling production remediated. **Stop here; IDOR work has not begun.**

## Phase 3 — isolated real authentication (historical)

### Executive summary

**Browser → real frontend → real backend → isolated MySQL is established.** Four persona UI logins and the initial session/authorization tests pass. **HC-QA-002 is a confirmed P0 passwordless-account takeover defect.** Implementation stopped at confirmation; its secure regression remains failing. HC-QA-001 remains P1/open and unchanged.

See [HC-QA-002](QA_BUGS/HC-QA-002.md) for sanitized reproduction, impact, evidence and proposed narrow remediation. Authentication remediation was not implemented.

### Environment / database

- Dedicated Docker MySQL 8.0, image ID pinned per run, tmpfs data, labelled dedicated bridge, host publication only `127.0.0.1:13306`.
- Current database: `hello_circle_e2e_qa_91c6dd08741f075d`; runtime/migration/test DB user: `hello_circle_qa` with exact-schema privileges.
- Root used by tests/backend/seeding: **NO**. Root used only inside the newly created container to provision its schema/account/marker: **YES**.
- Shared development `hello_circle_dev` touched: **NO**. Production touched: **NO**. Staging: still unverified.
- Frontend `127.0.0.1:4178`, backend `127.0.0.1:4311`. Full real auth middleware, no mocked HelloCircle API in this suite.
- No Stripe/Firebase/SMTP/cloud credentials; external backend connections blocked and external browser requests aborted. Real email delivery and provider integrations were not tested.

### Tests executed / passed / failed

| Layer | Result | What it proves / does not prove |
|---|---|---|
| Safety unit tests | **91 passed**, 3 files | Existing 74 plus 17 connected-identity policy cases; synthetic inputs, no DB mutation |
| Test typechecking | **PASS** | `npm run qa:check` includes integration harness/specs |
| Client tests | **81 passed**, 11 files | Existing client suites unchanged |
| Application build | **PASS** | Server TypeScript and client Vite build; large Mapbox chunk warning remains |
| Mocked smoke | **13 passed / 1 failed** | Unchanged desktop/mobile cases; HC-QA-001 still obstructs the cookie button |
| Real auth / API integration | **8 passed** | Four actual UI logins, resident refresh/logout, negative/suspended login, guest/role API denial, invalid/expired sessions and browser form validation |
| Security regression | **1 failed — APPLICATION SECURITY DEFECT** | Signup assigns a password and authenticates as the existing passwordless Google-linked resident without identity proof |
| Final `qa:auth` command | **8 passed / 1 failed**, exit 1, no retries | Does not hide or expect-fail the P0 defect |
| Offline preflight | Bare command exit 1; `--current` exit 2 | Missing config rejected; generated configuration accepted offline but never authorizes mutations by itself |
| Connected preflight | **PASS**, read-only | Actual DB/account/server UUID/grants/run marker plus Docker mounts/port/image/network checks |
| Seed/reset | **PASS** | Seed repeated without persona replacement; guarded disposable-container reset/recreate exercised before final reproduction |
| External sandbox / manual | **NOT EXECUTED** | No Stripe, live Google, email, storage integration or native/manual-device claim |

The real-auth suite is desktop Chromium 1440×900 only. Mobile remains covered by the separate **mocked** 390×844 suite, not real mobile authentication. No coverage percentage is claimed.

### Personas / authentication / authorization

QA_USER, QA_HOST, QA_VENDOR and QA_ADMIN each have unique verified DB identities and passed their real UI login. Host is a verified resident, not an invented global role. The seed includes one suspended vendor negative-control account; the passwordless security fixture is separate and removed after evidence capture.

Resident login, session persistence after refresh, UI-confirmed logout and protected profile/API denial passed. Host `/manage`, vendor `/vendor` + listings API, and admin `/admin` + stats API passed. Guest/resident/host/vendor negative boundaries use actual cookies and backend middleware. Vendor/host rejection from admin UI and APIs was exercised; no destructive admin action was performed. Expired-session fixture was deleted by exact token/email.

Second-owner personas, private Circle contents and full mutation-based IDOR remain **planned**, not tested. Ordinary residents are allowed to host, so a blanket “all users denied host pages” assertion would be incorrect. Google-linked row reproduction does not validate Firebase or Google's UI.

### Bugs / P0 findings

**HC-QA-002 — CONFIRMED SECURITY DEFECT, P0/open.** `POST /api/guest/signup` returned 201 for an existing passwordless synthetic Google-linked account, assigned the submitted password to the original row, returned that owner's identity/profile, preserved the Google link, and gave 200 on protected receipts. No identity proof was provided. The probe's exact fixture records were cleaned up using a freshly verified connection. Sanitized evidence remains; no real account or provider was involved.

Proposed smallest fix: existing-email signup conflict regardless of password state; credential establishment only through proven ownership, with concurrency and legitimate new-signup regression checks. See the dedicated bug report. **Stop for review before changing authentication.**

### P1 / UX findings

- **HC-QA-001 remains OPEN.** Unchanged mobile landing regression still fails because primary bottom navigation intercepts cookie-button clicks. Phase 3 evidence: `test-results/phase3-mock/smoke-application-QA-SMK-0-a3886-and-partner-navigation-mock-chromium-mobile-mock/` (screenshot/video/trace).
- Source/DOM observation: the sign-out `alertdialog` lacks an accessible name tied to its heading. Recorded for a later accessibility checkpoint; no full WCAG assessment or UI fix was performed.

### Failure classification / evidence handling

- Initial Docker internal-network bootstrap did not publish the loopback port: **ENVIRONMENT ISSUE**, caught before application schema/personas. Only the failed QA container/network was removed.
- Initial Playwright ESM loading and sign-out selector failures: **TEST HARNESS / TEST BUGS**, corrected using actual module/DOM contracts. No product assertion was relaxed.
- Existing cookie obstruction: **APPLICATION BUG**, remains red.
- Passwordless-account signup takeover: **APPLICATION SECURITY DEFECT**, remains red.
- Express clearCookie deprecation warnings are not functional test failures. Build's oversized Mapbox chunk is a performance observation, not new measured runtime latency.

Real-auth traces/videos/screenshots, DOM copy prompts and persisted storageState are disabled. The real suite uses a sanitized reporter; it does not dump form values, cookies, request headers or raw errors. Evidence is under `.qa-data/qa_91c6dd08741f075d/evidence/`: `auth-results.json` and `passwordless-signup.json`. These generated files are ignored; the durable sanitized bug report is in `QA_BUGS`. Mocked-suite evidence behavior remains unchanged.

### Files and commands this checkpoint

Created: `tests/integration/` (database lifecycle, identity/runtime guard, seed, backend wrapper, real Vite/Playwright configuration, runner, sanitized reporter, fixtures and two spec files); `tests/support/database-identity.test.ts`; `QA_BUGS/HC-QA-002.md`.

Modified: `package.json`, `server/src/index.ts` (test-only demo/default-admin seed suppression), `tests/support/preflight.ts`, `.env.test.example`, `QA_ENVIRONMENT.md`, `QA_REPORT.md`, `QA_TEST_MATRIX.md`, `tests/README.md`. Pre-existing uncommitted foundation/lockfile/ignore changes were preserved, not attributed to this checkpoint. No dependencies, Stripe code, UI fixes or CI workflow changes added.

Commands added: `qa:db:setup`, `qa:db:seed`, `qa:db:reset`, `qa:preflight:connected`, `qa:auth`. Existing commands preserved; offline preflight gained explicit `--current` input selection.

### Blockers / next recommended checkpoint

Review HC-QA-002 and approve its narrow credential-linking remediation. Then run the preserved real regression and existing auth/client/safety suites; only after it is fixed should owner/outsider IDOR fixtures expand. Keep HC-QA-001 UI remediation separate. Staging/CI resource isolation remains unverified. No payment/booking/media-provider work is approved by these results.

## Phase 2 — environment and readiness checkpoint (historical)

**Outcome:** Environment audit and offline guard implementation complete. No verified isolated database/backend exists in the inspected configuration, so real integration mutation work remains blocked. See `QA_ENVIRONMENT.md` for the environment inventory, provisioning/cleanup strategy, personas, and real authentication/authorization/IDOR plans.

Current `server/.env` selects shared `hello_circle_dev` using root and contains live-capable SMTP/R2/Cloudinary/Firebase configuration. The Stripe secret has a test prefix, which does not verify the isolation of the other services. `.env.test` is absent. Production/staging deployment state and database grants were not contacted or verified. No secret values were printed.

### Results by layer

| Layer | Current execution | Evidence/limit |
|---|---|---|
| Unit / safety | **74 passed**, 2 files; test TypeScript passed | `npm run qa:check`; was 15 before this checkpoint |
| Client | **81 passed**, 11 files | `npm run test --workspace client` |
| Mocked smoke | **13 passed / 1 failed**, zero retries | `npm run qa:smoke -- --output=test-results/phase2`; same unmodified HC-QA-001 regression |
| Offline integration preflight | **Expected refusal**, exit 1 | `npm run qa:preflight`; current QA configuration missing; no network/DB calls. Unit tests also verify valid config returns blocked exit 2, never mutation authorization |
| API integration / real DB | **Not executed** | Dedicated DB/target/grants not verified; existing read-only suite retained |
| Real E2E | **Plan only** | Login/session/persona and ownership tests documented, not implemented |
| External sandbox | **Not executed** | Payments/media/provider credentials intentionally excluded from initial auth profile |
| Manual | **Not executed this checkpoint** | Previous mobile screenshot evidence remains; no new manual provider/device testing |
| Application build | **Prior pass retained; not rerun** | No application source or dependency changes in this checkpoint |

The `tsx` CLI initially hit a sandbox IPC permission error; approved local execution then produced the intended preflight refusal. This was an environment issue, not an application failure. Smoke discovery still lists all 14 baseline cases. Phase 2 screenshot/video/trace are under `test-results/phase2/smoke-application-QA-SMK-0-a3886-and-partner-navigation-mock-chromium-mobile-mock/`. Original artifacts remain in their original `test-results` directories; the HTML report now represents the Phase 2 full run.

### Readiness, coverage and blockers

- **Environment status:** Mocked QA usable; local development unsuitable for destructive QA; staging unknown; production forbidden.
- **Database isolation status:** Not provisioned/verified. Proposed separate MySQL instance, per-run DB and restricted account; no connection, schema creation, seed or cleanup was performed.
- **Authentication readiness:** Real endpoint/session plan and seven persona definitions complete. Full real login/logout/persistence remains pending. Passwordless-account takeover candidate below must be investigated in isolation.
- **Security test readiness:** Concrete guest/role/host/vendor/Circle/profile/booking/media IDOR plan complete; no new real security requests executed. Ownership assertions use real cookies and middleware in the planned suite.
- **Critical journeys automated:** Same limited mocked landing/auth-error/guest-redirect scenarios as baseline. QA-001 through QA-005 real journeys remain pending.
- **Roles/APIs:** Synthetic anonymous UI only in browser execution. No new real persona, API permission or DB coverage is claimed.
- **Browsers/mobile:** Chromium desktop 1440×900 and mobile emulation 390×844; no native-device/cross-browser claim.
- **External integrations:** None exercised. A test Stripe prefix in development is configuration evidence, not Stripe test coverage.
- **HC-QA-001:** Still P1/open; unchanged regression failed again. No UI fix, skipped test or relaxed assertion.
- **CI:** No workflow changes. PR mocked/client tests, isolated API/E2E and later sandbox jobs remain the documented staged approach.

### SEC-REVIEW-001 — passwordless resident signup ownership (P0 candidate)

- **Classification:** Static application security finding requiring isolated reproduction; **not a confirmed runtime exploit**.
- **Area:** Resident authentication/account ownership.
- **Environment:** Source review only; no account created or accessed.
- **Severity/Priority:** P0 candidate, pending reproduction/triage.
- **Preconditions for future isolated reproduction:** Synthetic existing resident with no `password_hash`; independent signed-out browser.
- **Proposed reproduction:** POST `/api/guest/signup` using that fixture's email, a new test-supplied password and terms acceptance; then inspect the returned session and password state. Only perform in the dedicated QA DB.
- **Expected:** Adding a password to an existing account requires proof of ownership before that account can be authenticated.
- **Observed code path:** `server/src/residents.ts` `createResidentWithPassword` (around line 278) calls `setResidentPassword` when an existing email has no password; `server/src/routes/guestAuth.ts` `/signup` (around line 190) then calls `createGuestSession` and sets the cookie before sending the verification email. No prior ownership check is evident on that path.
- **Evidence:** Source only; no screenshot, runtime console or network evidence.
- **Recommended investigation:** Reproduce with two synthetic identities before accepting real-auth readiness; determine intended account completion/linking proof and add a narrowly scoped fix only after diagnosis. Do not encode this behavior as a successful signup expectation.
- **Regression required:** YES if confirmed; include magic-link-only and Google-only pre-existing residents and verify no hash/session mutation without ownership proof.

### Files and next checkpoint

Created: `QA_ENVIRONMENT.md`, `tests/support/integration-safety.ts`, `tests/support/integration-safety.test.ts`, `tests/support/preflight.ts`.

Modified this checkpoint: `tests/support/environment.ts`, `tests/support/environment.test.ts`, `.env.test.example`, `.gitignore`, `package.json`, `tests/README.md`, `QA_REPORT.md`, `QA_TEST_MATRIX.md`. No dependency/lockfile changes were made in Phase 2; existing Phase 1 changes remain in the worktree.

Command added: `npm run qa:preflight` (offline only; invalid configuration exit 1, runtime isolation unverified exit 2). Existing commands and Playwright foundation retained.

**Next recommended checkpoint:** Review the contract, provision an isolated local MySQL instance and sanitized QA launcher, verify database identity/grants/egress/storage, then implement the minimal seed/personas and real password authentication/authorization tests. Keep HC-QA-001's scoped product fix as a separate change. Stop here for review under the user's Phase 2 stop condition.

---

The sections below preserve the Phase 1 execution record; counts and “latest report” references there are historical.

## Executive Summary

The approved Playwright foundation is implemented. The initial browser run completed **13 passed / 1 failed** across desktop and mobile with mocked APIs. The failure is an application UX defect: mobile bottom navigation obstructs the cookie controls. The test remains failing, with screenshot, video, trace and console/network diagnostics retained.

This is an initial frontend regression baseline. Real authentication, onboarding persistence, booking, payment, host publication and database authorization are not validated by these mocks.

## Environment

- Local macOS arm64; Node v25.2.1; npm 11.6.2; Playwright 1.63.0 / Chromium.
- Isolated Vite frontend: `http://127.0.0.1:4177`; public launch mode; no API proxy; no application `.env` loaded by this server.
- Desktop 1440×900 and mobile emulation 390×844.
- Explicit synthetic guest API fixtures; third-party images/styles stubbed. No MySQL, Stripe, Firebase, SMTP, R2, Cloudinary or Mapbox service calls made by the browser suite.
- Existing app build was compiled separately; application services were not started.
- Package/browser downloads and local browser execution required sandbox permission. Initial registry DNS and local port permission errors were environment issues, resolved by the approved commands.

## Tests Executed

| Check | Result | Scope |
|---|---|---|
| `npm run qa:check` | Pass: 15 safety tests plus TypeScript | Invalid modes/origins, production refusal, exact staging origin, method/path/redirect policy |
| `npm run test --workspace client` | Pass: 81 tests in 11 files | Existing client helper regressions |
| `npm run build` | Pass | Server TypeScript and client TypeScript/Vite |
| `npm run qa:smoke` | 13 passed, 1 failed | 7 browser scenarios × 2 viewports; no retries |
| Mobile HC-QA-001 targeted reproduction | Failed again, same interception | Separate fresh browser context; no retries |
| Live API read-only suite | Not executed | No approved running local/staging API target selected |
| Server Vitest | Not executed | Requires real DB and writes test records |

## Passed

- Desktop landing, local favicon response and partner-login navigation.
- Resident sign-in and create-account navigation at both sizes.
- Guest vendor/admin page redirects with synthetic unauthenticated session responses.
- Sign-in horizontal overflow and email-to-password keyboard focus at both sizes.
- Injected 401 and 500 sign-in messages, retained email, re-enabled submit and unchanged sign-in location at both sizes.
- Environment/request guards, existing client tests, and application/test typechecking/build.

## Failed

- Mobile landing cookie rejection is blocked by the bottom navigation (**HC-QA-001**). This is classified as **APPLICATION BUG**, not selector/test-data or provider failure.
- The suite intentionally has no skip, expected-failure annotation, forced click, style override, increased retries or weakened assertion for this defect.

## Blocked

- Real valid-login/logout/session persistence and onboarding need isolated personas and a dedicated test database.
- Live API authorization needs an explicitly selected running local/staging service.
- Booking/payment/webhook automation needs Stripe test credentials, a dedicated DB and deterministic transaction data.
- Host/vendor publication needs seeded owners, content and a verified entity lifecycle.
- Full web/staging CI is deferred until the product regression and environment prerequisites are resolved.

## Bugs

### HC-QA-001 — Mobile bottom navigation covers cookie preference buttons

- **Area:** Mobile navigation / cookie preferences.
- **Environment:** Local isolated frontend, Chromium mobile emulation 390×844, `/`, public mode, fresh browser context, no stored consent.
- **Severity:** P1 — major functionality.
- **Priority:** P1.
- **Preconditions:** Bottom navigation and cookie notice both present; fresh visitor has not chosen a cookie preference.
- **Steps to reproduce:** (1) Open `/` at 390×844. (2) Wait for the landing heading and cookie notice. (3) Try to click “Necessary only”.
- **Expected:** Cookie choice is visible and pointer-accessible; clicking rejects optional analytics and dismisses the notice.
- **Actual:** Bottom navigation overlaps the button and intercepts pointer events. Playwright times out while its trace identifies a button under `nav.mobile-tab-bar` as the interceptor. Screenshot shows both cookie buttons largely covered.
- **Console errors:** None observed in the diagnostic attachment.
- **Network errors:** None unexpected observed; this layout failure is independent of synthetic API response data.
- **Likely source:** `client/src/components/CookieNotice.tsx:75` uses `zIndex: 50`, while `client/src/index.css:687` assigns `.mobile-tab-bar` `z-index: 250`; the banner sits 16px above the viewport bottom without accounting for tab-bar height.
- **Recommended investigation:** Coordinate banner offset/stacking with mobile bottom chrome and safe-area inset. Verify both cookie choices remain operable on all tab-bar pages and after rotation. A narrow layout fix should preserve tab navigation and cookie-consent semantics.
- **Regression test required:** YES — already present, remains failing in `tests/smoke/application.spec.ts` (`QA-SMK-002`, mobile project).
- **Application change:** None; UX finding is reported for review before modifying the UI.

Evidence from the full run (generated and gitignored):

- `test-results/smoke-application-QA-SMK-0-a3886-and-partner-navigation-mock-chromium-mobile-mock/test-failed-1.png`
- Same directory: `video.webm`, `trace.zip`, `error-context.md`.
- HTML report: `playwright-report/index.html`; diagnostic JSON is attached to tests.

The targeted reproduction was run with `--project=chromium-mobile-mock --grep QA-SMK-002 --output=test-results/reproduction`. It failed in the same way. Its artifacts are in `test-results/reproduction/`; the HTML report now shows this latest targeted run, while the original screenshot/video/trace remain at the paths above.

## P0 Findings

- Production and ambiguous environments are refused by the new runner; mock mode cannot reach the API through its frontend server.
- Mutation suites remain disabled. Database, Stripe and media isolation are prerequisites before enabling them.
- Real authorization/payment integrity remains unverified by this execution; existing route tests are not replaced by UI mocks.

## P1 Findings

- HC-QA-001 obstructs mobile consent controls.
- No web application CI gate yet; existing mobile workflow remains unchanged.
- npm install reported 22 repository dependency advisories (15 moderate, 7 high). These were not triaged in this checkpoint and are not attributed to the new dependency without a baseline comparison. No broad dependency remediation was attempted.

## UX Findings

- Mobile consent controls are covered on the landing page; sign-in pages pass because their tab bar is hidden.
- Focus traversal and overflow checks passed only for the tested sign-in form. This does not establish site-wide accessibility or mobile usability.

## Security/Permission Findings

- Mocked guest redirects passed but are not evidence of backend RBAC enforcement.
- The live API test checks health, empty session responses and exact unauthenticated vendor/admin errors with redirects disabled; it is implemented but unexecuted.
- `.env.test`, saved Playwright auth state and generated reports/results are ignored; `.env.test.example` is explicitly trackable.
- Initial audit's P0 inference about a Google config filename was withdrawn as unsupported; no secret exposure was established.

## Performance Findings

- Build warns about chunks above 500 kB; Mapbox chunk is approximately 1.88 MB minified / 528 kB gzip. It is split separately. This is an observation, not proof of initial-route cost or a measured performance regression.
- No runtime performance budget or provider request cost was measured; external image/font delivery was stubbed.

## Automation Coverage

- New: environment guard tests, desktop/mobile smoke, auth error UI, guest redirects, limited keyboard/overflow check, browser diagnostics and failure artifacts.
- Implemented but not executed: live read-only API smoke.
- Not implemented: authenticated browser fixtures, database factories/reset, bookings/payments, host/vendor publication, full permissions, maps/media provider integration, SEO/a11y suite or CI.

## Manual Coverage Required

Google provider UI, real-device keyboard/safe-area behavior, assistive technologies, Stripe provider delivery, and exploratory end-to-end journeys after isolated environment provisioning.

## Recommended Next Actions

1. Review and narrowly fix HC-QA-001; rerun its existing test unchanged.
2. Establish the dedicated local/staging DB, deterministic personas/content, mail sink and Stripe/media test isolation.
3. Run the live read-only API smoke against that target, then implement real authentication and onboarding.
4. Add web CI once local browser regressions are resolved; expand through QA-003, QA-004 and QA-005 incrementally.

## Files Changed

Root `package.json`/lockfile, `.gitignore`, `.env.test.example`, `playwright.config.ts`, `tests/` foundation/specs/documentation, and QA audit/matrix/report documents. No production application source or existing test configuration was modified.
