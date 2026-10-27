# HelloCircle — Category system + design refinements: final report (2026-10-22)

Local only. Nothing committed, pushed or deployed. The prod-designated `hello_circle` database was never written (one early read-only count query; none after). QA ran on the isolated QA database, Stripe in TEST mode, no real email.

## 1. Completed

**Category system (phases 1–6 + completion pass)**
- 3 additive tables, 21 active + 4 inactive categories, 118 subcategories, aliases, once-per-database backfill, public reads, server validation, filters on activities / Circles / programmes / experiences, unified search (programmes + Circles + category aliases + Explore category filter).
- Admin → Categories: directory, record page, full-page create/edit, merge (old slug redirects), archive/restore, delete only when unused, aliases, change history; Uncategorised review (responsive rows, confidence filter; low confidence has no one-click accept, medium needs a confirmation); Support can report a wrong category.
- Admin → Settings → System status: "Categories on the site" switch (Super, two-step code, confirmation dialog, audit log). Value unchanged (on).
- Host forms (activity, Start Circle, Circle settings) and partner creation forms (venue, club, experience wizards; programme create) + editors: searchable category picker, subcategory, tags. A failed category save keeps the draft and retries without a duplicate listing (bug found by QA and fixed).
- Public: category/subcategory chips with URL state on every list page and Explore; breadcrumbs on detail pages; related by subcategory; Home "Popular right now"; category SEO (indexable alone, combinations noindex + canonical, sitemap).
- Uncategorised report: `docs/hellocircle-category-uncategorised-report.md` (21 listings incl. 10 venues: 3 medium, 14 low, 4 none). Gap review: `docs/hellocircle-category-gap-review.md`.

**Design (owner requests)**
- Body font Inter everywhere (headings Bricolage Grotesque).
- Buttons: 4px corners; main action full width + 48px; others content width with a shared minimum; chips stay pill.
- Booking card: date, location (+ Directions) and price as highlighted fact rows on activity, experience and programme pages.
- Closing band (`CtaBand`) redesigned to the "Can't make this one?" reference: two-line headline, shorter band, forest background, campfire group long-shot photo (Kimson Doan, Unsplash License). **Form variant** (cream panel, one "Preferred day or time" field read into structured days/time, "More options" for days/time/budget/distance/notes, "This doesn't book a place") on activity, adventure, experience, volunteer, programme, Circle and county/activity pages. **Discovery variant** (one button + link, no panel) on Home, Explore, About, Activities, list pages and club/venue pages.

## 2. Files changed (main ones)

New: `server/src/taxonomy.ts`, `taxonomy.test.ts`, `routes/categories.ts`, `routes/adminCategories.ts`, `scripts/categoryReport.ts`; `client/src/api/categories.ts`, `components/categories/{CategoryPicker,CategoryChips,ListingCategoryFields}.tsx`, `components/VendorCategoryEditor.tsx`, `components/admin/AdminCategories.tsx`, `components/BookingFacts.tsx`; `tests/integration/specs/hc-categories{,-b}.spec.ts`; docs above.
Changed: server `db/index.ts`, `index.ts`, `adminPermissions.ts`, `ogMeta.ts`, routes `admin, games, circles, programs, experiences, clubs, centres, search, vendorParticipation`; client `CtaBand.tsx`, `ctaBand.css`, `IntentCaptureForm.tsx`, `ui.tsx`, `GuidedFlow.tsx`, `booking/BookingShell.tsx`, `GameJoinCard.tsx`, `BrowseLayout.tsx`, the three creation wizards, `VendorPrograms/ClubEditor/Experiences/CentreEditor`, `admin/{AdminSettings,adminNav,admin.css}`, pages `Home, Explore, Games, Circles, CircleDetail, GameDetail, ExperienceDetail, ProgramDetail, Programs, StartCirclePage, ManageCircle, HostGamePage, LocalActivity, AdminDashboard, About, Browse, ClubDetail, CentreDetail`, `index.css`, `main.tsx`, `formatters.ts`; `packages/types`, `packages/design-tokens` (body font); `tests/integration/run.ts` (2 batches), `hc-d03-reasons.spec.ts` (waits for the async email).

## 3. Screenshots (scratchpad, not in the repo)

`final/` (admin directory/record/uncategorised at 1440/820/390 and confirm dialog, partner wizards, booking cards, main-action buttons), `cta/v5/` (band form + discovery at 2000/1440/1024/820/390), `cta/v3/gated-*` (club/venue pages with the gate opened locally).

## 4. Tests

| Suite (isolated QA DB) | Result on final code |
|---|---|
| Server unit (Docker profile) | 1051 passed, 23 skipped (live-provider only) |
| Client unit | 302 passed; build OK; both workspaces type-check |
| qa:auth 20 · authorization 83 · security-gate 39 · revenue 38 | all passed (run 2) |
| qa:lifecycle 52 · booking 38 · product 80 · browsers 75 | all passed (run 3, final code) |
| qa:validation incl. D03 | 51 passed + D03 passed; CAT-VENDOR failed on a test race, fixed, then all 7 category tests passed |
| qa:stripe (TEST mode) | 51 passed in run 1; run 2: SANDBOX-SPLIT refused by design (passes once per fresh QA database), 48 others passed |

Skipped: 2 booking + 1 product + 1 browsers (existing skips). Not run on final code: auth/authorization/security-gate/revenue/stripe (no UI or payment code they cover changed after run 2).

## 5. Remaining issues by severity

**Blockers to release**
- None in the code. Release still needs the production steps in §7 (live inventory, backfill on the live DB, owner sign-off on the design changes).

**Medium**
- `SANDBOX-SPLIT` needs a fresh QA database (`qa:db:reset` + `qa:db:seed`) to re-confirm on the final code.
- Changing an experience's kind (experience ⇄ volunteer) in the partner editor can leave a category of the other family; the integrity check reports it. Small server follow-up.
- The packages font token change affects the separate mobile repo (it must load Inter).

**Low**
- Room-level facility categories not built (documented: wait for venue launch).
- `ACTIVITY_CATEGORIES` constant now unused (remove next release).
- CTA band photo is loaded from Unsplash's CDN (same as Home); consider moving editorial photos to the media library.
- Circles page shows both the older interest pills and the new category pills.

## 6. Migration and rollback readiness

Additive only (3 new tables, no ALTERs). Seed inserts missing rows only; backfill runs once per database (`app_settings.taxonomy_backfill_v1`) and inserts exact matches only. Rollback: switch "Categories on the site" off (UI hides within seconds), then drop the 3 tables if needed; no existing row was modified. Design changes are CSS/component-level and revert with the files.

## 7. Production rollout checklist

1. Read-only category inventory on the live server (`npx tsx src/scripts/categoryReport.ts --allow-db=<live db>` from a read-only session).
2. Deploy to staging; confirm tables created, backfill marker written, counts unchanged per listing type.
3. Super admin reviews Admin → Categories → Uncategorised.
4. Re-run guarded QA on a fresh QA DB (incl. `qa:stripe`).
5. Owner sign-off on the band, buttons, font and booking card on staging.
6. Production deploy; keep the categories switch ready as the rollback.

## 8. Decisions requiring approval

- Commit / push / deploy of all of the above.
- Whether the Circles page keeps the old interest pills next to category pills.
- Whether the closing band's photo should move into the editorial media library.
- Mobile app: adopt Inter and the new token.
