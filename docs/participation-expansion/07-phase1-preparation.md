# 07 · Phase 1 preparation: working tree inventory, branch strategy, file plan, migrations, tests, gates

**Status:** preparation only (2026-10-28). No code, schema, data or git changes have been made. Nothing has been
staged, stashed, committed, discarded, pushed or deployed. **Waiting for approval** of §2 (base), §3 (plan) and §6
(questions).

**Approved inputs:**
- **PD-1:** a community event is `experiences.kind = 'event'`.
- **PD-2:** only eligible partner organisations can sell paid events, through the existing payment gates.
- **PD-10:** inventory the tree and isolate before writing any code.

**Phase 1 scope:**
1. The event kind, its routes and taxonomy.
2. Options and order lines.
3. Multi-line server pricing.
4. Capacity by heads with per-option caps.
5. Partner create and edit.
6. Resident booking with options.
7. My Life and receipts showing lines.
8. Compatibility and regression tests.

**Out of scope:** donations, external payments and cash due, special-category questions, checkout groups, volunteer
operations.

---

## 1. Git state (read-only inspection)

| Item | Value |
|---|---|
| Current branch | `feature/circles-and-experience-3` at `473dbfa`, tracking `origin/feature/circles-and-experience-3` (in sync) |
| `origin/staging` | `ba913af` (2026-10-27, merge of PR #15 = this branch). This branch is **0 ahead / 3 behind** `origin/staging` (only the merge commits), so its committed content is already in staging |
| `origin/main` | `745b982` (2026-10-08). Production is untouched |
| Local `staging` | `544e663`, **56 behind** `origin/staging`. Stale; don't branch from it |
| Uncommitted | **128 status entries** (92 modified, 36 untracked dirs/files) = **212 paths** when untracked folders are expanded; `git diff --stat`: 92 files, +2,586 / −1,060 |
| Modification dates | 210 paths modified on 2026-10-28, 1 on 10-24, 1 on 10-17 |
| Stashes | none |
| Other worktrees | 6, all under `/private/tmp/claude-501/…/scratchpad/` and marked **prunable** (5 detached, 1 `hotfix/paid-checkout-gate` whose remote is gone). Left alone |
| Branches with a gone remote | `docs/prod-backups`, `feature/firebase-keyless-google-sign-in`, `feature/staging-login-*`, `hotfix/paid-checkout-gate`. Left alone |
| `gh` CLI | not installed, so open PRs couldn't be listed. Please confirm there's no open PR touching experiences |

### 1.1 Who owns the uncommitted changes (inferred)

All changes are under the same git identity and were made today, probably by several parallel sessions. I've grouped
them by content and by project memory. **I don't own any of them except the docs in stream H**, so none should be
moved, committed or discarded without your word.

| Stream | What | Paths (main ones) | Size |
|---|---|---|---|
| **A. Trust & Retention** (batches 1, 2, 4; memory "Trust & Retention batch 1") | Attendance-based reviews, review invitations, business checks, attendance corrections, follows, next-plan journey, `qa:trust` | server: `reviewEligibility.ts`, `reviewClaimKey.ts`, `reviewAttendanceFlags.ts`, `verification.ts`, `myLifePlans.ts`, `myLifePlanRules*.ts`, `newcomerWelcome*.ts`, `routes/verificationChecks.ts`, `routes/attendanceCorrections.ts`, `routes/reviews.ts` (+367), `routes/reports.ts`, `routes/follows.ts`, `routes/residents.ts`, `moderationDecisions.ts`, `reportModeration.ts`, `notifications.ts`, `db/index.ts` (+168: reviews columns, review invitations), `index.ts` (2 routers + sweep), `trustRetention*.test.ts`; client: `components/trust/*`, `api/trust.ts`, `Reviews.tsx` (+731), `HostProfile.tsx`, `AdminReviews.tsx`, `AdminVerification.tsx`, `mylife/NextPlan.tsx`, `ReportContentButton.tsx`; `tests/integration/specs/trust-*.spec.ts`, `run.ts`, `reporter.ts`, `package.json` (`qa:trust`), `QA_ENVIRONMENT.md`, `docs/trust-retention/*` | largest |
| **B. Card style system** (memory "Card style system 2026-10-27") | Category word on cards, card labels | `cardWord.ts`, `server/src/categoryLabels.ts` (`withCardLabels`), `ListingCard.tsx`, `listingCard.css`, `FeatureCard.tsx`, `ExperienceSearchCard.tsx`, `DiscoverRow.tsx`, `CategoryChips.tsx`, `docs/editorial-cards/*` | medium |
| **C. Explore redesign option B** | Filters | `exploreFilters.ts`, `Explore.tsx` (+447), `FilterDropdown.tsx`, `BrowseLayout.tsx`, `docs/explore-redesign/*` | medium |
| **D. Booking box / Pass** (memory "Booking box states") | Boarding pass, booking detail | `pass/BoardingPass.tsx`, `boardingPass.css`, `Pass.tsx`, `BookingDetailPage.tsx` (+181), `bookingDetail.css`, `BookingPrep.tsx` | medium |
| **E. Google sign-in dotenv fix** (memory, 2026-10-28) | `import "dotenv/config"` moved first | `server/src/index.ts` (first lines) | tiny |
| **F. Detail pages and games** | Mixed (trust panels, host card, game form) | `ExperienceDetail.tsx`, `CentreDetail.tsx`, `ClubDetail.tsx`, `ProgramDetail.tsx`, `GameDetail.tsx`, `HostGamePage.tsx` (+90), `routes/games.ts`, `routes/experiences.ts` (`businessCheckedSql`, `withCardLabels`, `newcomerWelcome`), `vendorExperiences.ts` | medium |
| **G. Circles leftovers** | Small copy and layout | `Circle*.tsx`, `circle/*` | small |
| **H. This audit (mine)** | Docs only | `docs/participation-expansion/*` | docs |
| **Noise** | Finder metadata | `.DS_Store`, `docs/.DS_Store` | — |

### 1.2 Overlap with Phase 1 files
Phase 1 must edit files that are **already modified, uncommitted**:
- `server/src/db/index.ts`;
- `server/src/routes/experiences.ts`, `server/src/routes/vendorExperiences.ts`, `server/src/routes/search.ts`,
  `server/src/routes/discover.ts`, `server/src/db/queries.ts`;
- `packages/types/src/index.ts`;
- `client/src/api/public.ts`, `client/src/api/vendor.ts`;
- `client/src/pages/ExperienceDetail.tsx`, `BookingDetailPage.tsx`, `MyBookings.tsx`, `Explore.tsx`;
- `client/src/components/ExperienceKindBrowse.tsx`, `ExperienceSearchCard.tsx`, `ListingCard.tsx`.

Building Phase 1 on `origin/staging` without that work would produce real merge conflicts in at least those 17 files.

## 2. Branch and worktree strategy (proposal; nothing done)

### Option A (recommended): land the in-flight work first, then branch Phase 1 from it
1. **You** decide what happens to streams A–G: commit them on their own branches (one PR per stream to `staging`, as
   before), or park them.
2. Once they're on `origin/staging`, I create an isolated worktree:
   `git worktree add ../hello-circle-participation-p1 -b feature/participation-phase1 origin/staging`.
   - It's a sibling folder, **not** under `/tmp` (the six `/tmp` worktrees above are already prunable).
3. Your main checkout stays exactly as it is.
4. **Pros:** no conflicts; Phase 1 builds on the trust and card code it will meet anyway.
   **Cons:** waits for those commits.

### Option B (if you want to start before streams A–G land): worktree from the current commit, rebase later
1. `git worktree add ../hello-circle-participation-p1 -b feature/participation-phase1 origin/staging`, now.
2. Phase 1 is built against `ba913af`. When A–G land, rebase onto `origin/staging` and resolve the 17 overlapping files
   by hand. `db/index.ts` and `ExperienceDetail.tsx` are the riskiest.
3. **Pros:** start now. **Cons:** conflict work later; Phase 1 tests can't exercise the trust and card changes until
   then.

### Option C (rejected): work in the current checkout, or copy the uncommitted tree into the worktree
This would mix Phase 1 with seven other streams. It breaks "never commit work you don't own" and makes a clean PR
impossible.

### Environment isolation (either option)
- **Database:**
  - The worktree gets its own `server/.env`, copied by hand from the main one, with
    `DB_NAME=hello_circle_participation_dev`.
  - Created once with `CREATE DATABASE`, then seeded with `npm run reset-demo --workspace server`.
  - **Never `hello_circle`**, and not the shared `hello_circle_dev` other sessions use, because `initSchema()` would
    add Phase 1 tables there.
- **Ports:** API `:3011`, client `:5183`, so they don't collide with the main checkout's `:3001`/`:5173`. Memory notes
  `:3001` was once on the prod DB.
- **Tests:**
  - Server suite in its isolated Docker profile (`server/TESTING.md`, `hello_circle_test_<runid>`).
  - `qa:*` only through the guarded harness, Stripe TEST mode.
- **Cleanup:** the worktree and branch are removed only on your word, and never with `--force` if they contain
  uncommitted work.

## 3. File-by-file implementation plan

Every behaviour is behind switches that are **off by default**:
- `participation.events`: event kind visible and creatable;
- `participation.options`: options editor plus line checkout;
- `participation.partial_cancel`: seat or line removal. It stays off until the §5 G4 gate passes.

All three are added to `FEATURE_SWITCHES` in a new `participation` group. **Read paths are never switch-gated**:
existing orders with lines stay viewable, cancellable and refundable when the switches are off.

### 3.1 Server: schema (`server/src/db/index.ts`, appended at the end of `initSchema()`)
| Change | Detail |
|---|---|
| `CREATE TABLE IF NOT EXISTS offering_options` | Columns per `03-architecture.md` §3.1, minus `eligibility`/`requires_proof` (out of scope). `listing_type` limited to `experience` in Phase 1. Index `(listing_type, listing_id, active, sort_order)`. **No TEXT DEFAULT** (MySQL trap); `bundle_slots` is JSON NULL |
| `CREATE TABLE IF NOT EXISTS order_lines` | Per §3.2. UNIQUE `(source_type, source_ref, line_no)`; index `(option_id)`. Snapshot columns: `label_snapshot`, `description_snapshot`, `price_basis_snapshot`, `age_band_snapshot`, `unit_minor`, `quantity`, `heads`, `vat_bps_snapshot`, `vat_mode_snapshot`, `fee_bps_snapshot`, `pricing_source` (`legacy | engine:<rule_hash>`), `refunded_quantity`, `refunded_minor` |
| `ensureColumn("experience_bookings", "pricing_mode", …)` | `VARCHAR(10) NOT NULL DEFAULT 'single'` (`single | lines`), so reads know whether lines exist without a join |
| `ensureColumn("commerce_quotes", "lines_json", "lines_json TEXT NULL")` | The requested lines `[{optionId, quantity}]`, compared on consume |
| Kind | `experiences.kind` is `VARCHAR(20)`: `'event'` fits; **no DDL needed** |
| Category | Add catalogue entry `culture` "Culture, faith & celebrations" (families `X, C`) to `taxonomy.ts`. This needs your approval (Q3) |

### 3.2 Server: new modules
| File | Responsibility |
|---|---|
| `server/src/participation/options.ts` | Load active options for a listing; validate a partner's option set (labels, price ≥ 0 integer, basis, heads ≥ 0, bundle slots, caps, sale window, `max_per_order`); replace a set with `row_version` (sold options are deactivated, never deleted) |
| `server/src/participation/lines.ts` | **The single pricing input:** `resolveLines(listing, requested[], now)` returns priced lines from **server** prices or a typed error (sold out per option, outside window, over max). Gives `{ lines, listMinor, heads }`. No client price or total is read anywhere |
| `server/src/participation/orderLines.ts` | `writeOrderLines(tx, sourceType, ref, lines, pricingSnapshot)`; `readOrderLines(sourceType, ref)` (synthesises one implicit line for `pricing_mode='single'` orders, so every reader works for old and new orders); the Phase 1 switch helper |
| `server/src/participation/*.test.ts` | Unit tests (§5) |

### 3.3 Server: changes to existing files
| File | Change | Already modified (stream) |
|---|---|---|
| `routes/experiences.ts` | `kind` union + list filter accept `event` (only when `participation.events` is on for **public** listing; detail by id/slug always works for an approved event so links never break); detail JSON + `options[]`; `quoteExperience`/`engineQuoteExperience` take `lines` → `listMinor = Σ`, `partySize = Σ heads`; checkout accepts `lines` (when `participation.options` on and the listing has options), else exactly today's path; under the session lock, per-option `SUM(heads)` check (lock order session → options by id) **plus** the existing session `SUM(party_size)` check; `party_size` stored = Σ heads; `writeOrderLines()` in the same tx; Stripe description lists lines; `/bookings/mine` and `/bookings/status/:ref` add `lines` | **yes (F)** |
| `routes/vendorExperiences.ts` | `EXPERIENCE_KINDS` + `'event'`; create/update accept `kind: 'event'` only when `participation.events` on (Q1); adventure-only fields ignored/cleared for events (`distanceKm`, `elevationGainM`, `terrainType`, `difficulty`); new `GET/PUT /experiences/:id/options` (roles `EXPERIENCE_ROLES`, `ownsExperience`, `row_version`); booking list returns lines | **yes (F)** |
| `commerce/engine.ts` | `QuoteInput.lines?`; `createQuote` stores `lines_json`; `consumeQuote` compares lines; `OrderInput.line` → `lines[]` (one `commerce_order_lines` row per line, tax allocated with `allocate()` largest-remainder so rows sum to the snapshot); `priceWithRules` unchanged (gets `listMinor = Σ`) | no |
| `pricing.ts` | **No change** (legacy prices `Σ lines` as one subtotal; VAT and fee values untouched) | no |
| `checkoutService.ts` | **No change** to `createCheckoutSession`/metadata; callers pass more line items whose sum is the total (the agreement records the sum, as now). Add `assertLineItemsTotal()` for the legacy path (engine path already throws) | no |
| `payments/orderState.ts` | `orderFits('experience')` also re-proves per-option caps for orders with lines (a late webhook or review recheck can't oversell an option) | no |
| `routes/stripeWebhook.ts` | **No change** (type `experience`, ref unchanged) | no |
| `receipts.ts` | Experience receipt includes `readOrderLines()` | no |
| `myLife.ts` / `activitySummary.ts` | Experience entries carry `lines` summary ("Pooja (family) · Darshan × 2") and kind `event` label | **yes (A)** |
| `taxonomy.ts` | `familyOf()`: `event` → `experience` family; `publicJoinFor`/`publicCounts`/`listPublicCategories` take `experienceKind` incl. `'event'`; **every `e.kind != 'volunteer'` filter becomes `e.kind NOT IN ('volunteer','event')`** where it means "adventures/experiences" (and events get their own kind filter) | no |
| `db/queries.ts` (`:487`, `:507`, `:1152`) | `kind` unions + href `/events/:slug` for events | **yes** |
| `routes/search.ts`, `routes/discover.ts`, `discoveryMatch.ts`, `personalization.ts`, `routes/experienceHub.ts`, `ogMeta.ts`, `routes/sharing.ts`, `routes/invitations.ts`, `circlePlanListings.ts`, `routes/circles.ts`, `myLifePlans.ts` | Each kind switch handles `event` (label "Event", href `/events/…`, Passport kind `event`); unknown kinds fall back to experience behaviour, never crash | search, discover, myLifePlans **yes** |
| `routes/admin.ts` (listing record) | Read-only options list for moderation | **yes (A)** |
| `scripts/testDbSeed.ts` | Event + options fixtures for QA | no |
| `server/src/types.ts` | Mirror `ExperienceKind` + option/line types | **yes** |

### 3.4 Shared types: `packages/types/src/index.ts` (modified, streams A/B)
`ExperienceKind` + `'event'`; `OfferingOption`, `OrderLine`, `ExperienceQuoteRequest.lines`, `Experience.options?`,
`ExperienceBooking.lines?`, receipt line type. `client/src/types.ts` re-exports it (no change). The mobile app
(separate repo) gets new **optional** fields only, so nothing breaks.

### 3.5 Client
| File | Change | Already modified |
|---|---|---|
| `api/public.ts` | `quoteExperienceSession(..., { lines })`, `bookExperience({ lines })`, types | **yes** |
| `api/vendor.ts` | `getExperienceOptions`, `saveExperienceOptions` | **yes** |
| `components/ExperienceCreationWizard.tsx` | Kind picker adds **Community event** (when switch on); hides adventure fields for events | no |
| `pages/VendorExperienceEditPage.tsx` / `components/VendorExperiences.tsx` | "Registration" section: segmented *One price · Several options* (Full registration later phases); new `components/experience/OptionsEditor.tsx` (table of options: label, what's included, price, per person/booking, heads, age band, cap, sale window; reorder; deactivate; `row_version` 409 message); `form.tsx` conventions; no drawer | VendorExperiences no |
| `pages/ExperienceDetail.tsx` | Booking box options step (radio for single-choice, steppers for quantities), per-line summary from the **server quote** (never computed client-side), seat names count = Σ heads; event-specific facts (no difficulty) | **yes (F)** |
| `components/experience/OptionPicker.tsx` (new) | The options step, reused by the booking box and the checkout page | — |
| `pages/Events.tsx` (new) + `App.tsx` | `/events` list (via `ExperienceKindBrowse` with kind `event`), `/events/:id` → `ExperienceDetail` | App no |
| `components/ExperienceKindBrowse.tsx`, `ExperienceCard.tsx`, `ExperienceSearchCard.tsx`, `ListingCard.tsx`, `FeaturedPicks.tsx`, `FeatureCard.tsx`, `Home.tsx`, `Explore.tsx`, `pass/Pass.tsx`, `shareMessages.ts`, `ShareSheet.tsx`, `symbols.tsx`, `circle/*Listing*.tsx`, `MyLifeEngage.tsx`, `mylife/NextPlan.tsx`, `trust/WhatToExpect.tsx`, `api/categories.ts`, `api/sharing.ts`, `api/invitations.ts`, `api/experience.ts` | Handle `event` (label, href, icon); fallback for unknown kinds | most **yes** |
| `pages/BookingDetailPage.tsx` + `bookingDetailModel.ts` | "What you booked" list of lines; Remove-a-seat action only when `participation.partial_cancel` (off) | **yes (D)** |
| `pages/ReceiptPage.tsx` | Lines with label snapshot, qty, unit, line total; totals unchanged | no |
| `pages/MyBookings.tsx` | Line summary on the card | **yes** |
| `navigation/navConfig.ts` | **No change** (Explore menu is frozen by you; Q4) | — |

### 3.6 Tests and fixtures
New unit tests (`server/src/participation/*.test.ts`, `client/src/**/options*.test.ts`); server integration tests
(`server/src/routes/eventOptions.test.ts`, isolated profile); a `qa:stripe` scenario addition for events; a Playwright
spec `tests/integration/specs/event-options.spec.ts`. See §5.

## 4. Database migrations and compatibility risks

| # | Migration / change | Risk | Mitigation |
|---|---|---|---|
| M1 | New tables `offering_options`, `order_lines` | Low (additive) | `CREATE TABLE IF NOT EXISTS`; no FK; no TEXT DEFAULT |
| M2 | `experience_bookings.pricing_mode` (default `'single'`) | Low | Constant default, so every existing row is `single`, so readers synthesise one line |
| M3 | `commerce_quotes.lines_json` | Low | NULL for existing quotes; consume compares only when present |
| M4 | `kind = 'event'` values | **Medium**: ~57 files switch on kind; `e.kind != 'volunteer'` filters would silently show events under Adventures/Experiences | One grep-driven pass (§3.3/3.5 list); a test asserting discovery counts per kind; no event rows exist until the switch is on |
| M5 | Capacity: per-option check added under the session lock | **Medium**: deadlock or oversell | Fixed lock order (session, then options by id); concurrency test (§5 S5); session `SUM(party_size)` check kept as is |
| M6 | `party_size = Σ heads` | Medium: add-ons (heads 0) must not reduce party below 1 | Validation: Σ heads ≥ 1 for a booking; add-ons need ≥ 1 head line |
| M7 | Engine `createOrder` writes several lines | Medium: tax allocation rounding | `allocate()` largest remainder; assert Σ line tax = snapshot VAT |
| M8 | Stripe line items sum = agreement | **High if wrong** (paid orders parked in review) | Legacy guard `assertLineItemsTotal()`; engine guard exists; webhook test with a 3-line order |
| M9 | Mobile app reads experiences | Low | New fields optional; `kind: 'event'` hidden from public lists while the switch is off; mobile falls back to experience rendering |
| M10 | Rollback | — | Switches off, so no new events or lines are accepted; existing rows stay readable, cancellable and refundable (full refund path unchanged); tables stay (no down-migrations) |
| M11 | Partial cancellation (seat removal) | **High** (money) | Stays off (`participation.partial_cancel`) until gate G4 proves idempotency and reconciliation |

**Freezing at purchase.** These are frozen when the order is placed and never re-read later:
- `order_lines` snapshots (label, description, basis, age band, unit price, VAT bps/mode, fee bps, pricing source);
- the existing `order_acknowledgements` (terms version, safety text fingerprint);
- the existing `pricing_snapshots` (engine).

Option edits afterwards change only future orders.

## 5. Phase 1 test matrix and release gates

### 5.1 Unit (Vitest)
| ID | Test |
|---|---|
| U1 | `resolveLines`: server price used, client price ignored; per-person × qty; per-booking bundle; heads Σ; add-on capped by heads |
| U2 | Sale window boundaries in Europe/Dublin (DST change weekend) |
| U3 | Validation: negative/fractional prices, zero heads total, duplicate option ids, unknown or inactive option, over `max_per_order` |
| U4 | `readOrderLines` synthesises one line for a `single` order equal to its stored total |
| U5 | Engine: Σ lines `listMinor` gives the same breakdown as the single-price path for one line (parity) |
| U6 | `allocate` tax across lines sums exactly to the snapshot VAT |
| U7 | Kind helpers: `familyOf('event')`, href and label maps, unknown kind fallback |

### 5.2 Server integration (isolated MySQL container)
| ID | Test |
|---|---|
| S1 | Switches off: experience quote/checkout byte-for-byte unchanged (amount, line items, stored columns) against fixtures |
| S2 | Switches on, listing without options: unchanged path |
| S3 | KNOTS fixture: Pooja (per booking, 5 heads) + Darshan ×2 (per person) gives stored total = server sum = checkout agreement; `order_lines` snapshots written |
| S4 | Tampered body (client `unitMinor`, `totalCents`, `priceCents`) is ignored; a different total is impossible |
| S5 | Concurrency: 2 checkouts racing for the last 3 heads of an option cap: exactly one succeeds; the session cap and the option cap both hold |
| S6 | Webhook: 3-line order confirms; a forced amount mismatch goes to `payment_reviews` (D-10 unchanged); `orderFits` re-checks the option cap after a lapsed hold |
| S7 | Quote consume: lines changed between quote and checkout gives 409 `quote_mismatch` |
| S8 | Option edited after purchase: receipt and My Life still show the purchased label and price |
| S9 | Switch turned off after orders exist: My Life, receipt, booking detail, cancel and full refund all work for those orders |
| S10 | Event listing: hidden from public lists while `participation.events` is off; direct link works; adventure/experience lists never include events; D-01 suspended org gets 409 |
| S11 | Permissions: options `PUT` refused for `finance`/`communications`/`read_only_analyst`/another org (403); `row_version` stale gives 409 |
| S12 | Existing suites: every server test passes with all `participation.*` off **and** on |

### 5.3 Payment QA (`npm run qa:stripe`, Stripe TEST mode only)
| ID | Test |
|---|---|
| P1 | Event card checkout with 2 options, then paid, receipt lines, ledger balanced (`ledgerIsBalanced()`) |
| P2 | Full provider cancellation refunds the full amount once (existing path) |
| P3 | Engine switch on and off both produce the same customer total for the fixture |

### 5.4 Browser (Playwright, 375px and 1280px)
| ID | Test |
|---|---|
| B1 | Partner creates a community event with 2 options (One price → Several options) |
| B2 | Resident books options, the server quote total is shown, pays in TEST mode, sees lines in My Life and the receipt |
| B3 | Casual game host/join unchanged (same steps, fields) |
| B4 | Adventures and Experiences pages show no events |

### 5.5 Release gates (all must pass, in order)
| Gate | Condition |
|---|---|
| **G0** | Approval of this plan, base option (A/B) and Q1–Q5 |
| **G1** | Isolated worktree + own dev DB + own ports confirmed; main checkout untouched |
| **G2** | U1–U7, S1–S12 green; `npm run build` green; existing client + server suites green with switches off and on |
| **G3** | P1–P3 green in `qa:stripe` (TEST mode); B1–B4 green |
| **G4** | **Partial cancellation proof** before `participation.partial_cancel` can be turned on anywhere (not part of Phase 1 delivery unless you ask): (a) a double-submitted seat removal gives one refund (idempotency key per `(ref, line_no, refunded_quantity)`); (b) provider failure gives no refund row and the seat isn't removed; (c) a `charge.refunded` webhook for that refund doesn't count twice (`recordProviderRefunds`); (d) Σ refunds ≤ paid; (e) ledger balanced after each step; (f) line `refunded_minor` reconciles to `refunds.amount_minor` |
| **G5** | Your review of the diff; commit and PR to `staging` only on your word; prod untouched; `PAID_CHECKOUT` unchanged (production stays closed) |

## 6. Questions before code

| # | Question | Recommendation |
|---|---|---|
| Q1 | Base: Option A (land streams A–G first) or B (start now from `origin/staging`, rebase later)? | A |
| Q2 | Per-option VAT is out of scope: all lines of an order share the order's pricing rule (no mixed VAT rates in Phase 1)? | Yes |
| Q3 | Add a new category "Culture, faith & celebrations" (families: experience, circle), or map events to the existing "Meetups & community"? | Add the new category |
| Q4 | Explore menu is frozen: is `/events` reachable only through Explore filters, search and direct links in Phase 1 (no new nav item)? | Yes, no nav change |
| Q5 | Partial cancellation: build the G4 proof in Phase 1 (switch stays off) or defer it to a later phase? | Build the proof, keep the switch off |
| Q6 | Price-basis wording for KNOTS (per family vs per person) is a content question for KNOTS, not a blocker: confirm | Confirm |
