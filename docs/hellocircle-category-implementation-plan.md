# HelloCircle — Category Implementation Plan

| Phase | Scope | Depends on | Effort | Acceptance |
|---|---|---|---|---|
| 0 | This audit and proposal | — | Done | Owner approves the taxonomy, schema, permission and URL decisions |
| 1 | Tables, seed, aliases, backfill report, public read API, server validation, tests | Approval; production inventory | M | Counts unchanged; matched/unmatched report; invalid IDs refused (400) |
| 2 | Admin Categories directory, record page, create/edit, reorder, activate, discoverable, merge with redirect, usage, audit log, `taxonomy.manage` | 1 | M–L | Permission walk test passes (every admin route declares a permission); merge keeps listings and redirects |
| 3 | `CategoryPicker` + `TagPicker` in host activity, Start Circle, and vendor programme / club / experience / venue forms; edit keeps IDs | 1 | M | Create and edit for each type store IDs; a disabled category can't be chosen |
| 4 | Category and subcategory chips and filters on lists and Explore, URL state, empty states, search alias resolution | 1, 3 (data) | M | Filters combine with location and date; no duplicates; gate respected; first result on the first phone screen |
| 5 | Detail breadcrumbs, related-by-subcategory, Home "Popular right now", SEO (canonical, noindex, sitemap) | 4 | S–M | Only categories with inventory indexed |
| 6 | QA: API and browser tests at 390/768/1024/1440/1920, accessibility, regression (booking, payment and refund suites unchanged) | all | M | All suites green |

## Decisions required before Phase 1

1. Approve the **three new tables** (section 1 of the architecture doc). The alternative, `category_id` columns on six tables, is rejected in the doc.
2. Approve the **first-release taxonomy** (21 categories), with the remaining brief items kept as inactive rows.
3. Irish naming: **"Soccer" + "Gaelic games"** instead of "Football".
4. **Events** as a date-based view with event tags, not a new listing type.
5. New admin permission **`taxonomy.manage`**: Super only, or also Support?
6. **Tag additions** to the participation vocabulary (indoor, outdoor, evening, weekend, tournament, festival, fundraiser, seasonal, women-only, over-50s).
7. **URLs:** query-parameter category filters only in the first release; no new path-based category landing pages yet.
8. Should hosts be **required** to pick a category on new activities, or should it be optional at first?
9. Permission for a **read-only production inventory** of current category values before seeding.


## Final sequence, separated by kind of change (2026-10-22)

| # | Work | Kind | Needs approval? | Status |
|---|---|---|---|---|
| 1 | Explore and Start regrouping, duplicate removal, tablet layout | Frontend only (routes unchanged) | No (freeze lifted) | **Done**, uncommitted |
| 2 | Create the three taxonomy tables; seed 21 categories plus subcategories and aliases | Schema | **Yes**: final list, table definitions, migration plan | Waiting |
| 3 | Backfill `listing_taxonomy` (exact aliases only; ambiguous rows go to admin review) | Data (dev / QA first) | Yes | Waiting |
| 4 | Public read API + filters on existing list endpoints; `/api/search` alias resolution; programmes and Circles in search | Backend API | Yes | Waiting |
| 5 | `taxonomy.manage` admin permission + admin Categories area | Permissions + frontend | Yes: who gets it | Waiting |
| 6 | `CategoryPicker` / `TagPicker` in host and vendor forms (optional at first) | Frontend + server validation | After 2 | Waiting |
| 7 | Category chips on list pages, breadcrumbs on detail pages, Home "Popular" row, SEO | Frontend | After 4 | Waiting |
| 8 | QA (API, browser, regression) | Tests | — | Per phase |

## Route mapping (no route changes)

| Destination | Route | Category filter (after approval) |
|---|---|---|
| Explore everything | `/explore` | `?type=&category=&sub=` |
| Activities | `/games` | `?category=racket-sports&sub=badminton` |
| Adventures / Experiences / Volunteer | `/adventures`, `/experiences`, `/volunteer` | `?category=` |
| Programmes | `/programs` | `?category=` |
| Circles | `/circles` | `?category=` |
| Venues / clubs (gated) | `/browse/centres`, `/browse/clubs` | `?category=` (facility / sport) |
| Local SEO | `/:county/:activity` | kept; `:activity` resolves through aliases |
| Details | `/games/:id`, … | breadcrumb links to the filtered list |

## Build status (2026-10-22, owner approved all decisions)

Built locally on `hello_circle_dev`; nothing committed, pushed or deployed. The prod-designated `hello_circle` was never written (the :3001 watch server on it was stopped first, owner's choice).

| Phase | Done | Where |
|---|---|---|
| 1 | 3 tables, seed (21 active + 4 inactive categories, 118 subcategories including the 4 additions), aliases, once-per-database backfill (`app_settings.taxonomy_backfill_v1`), public reads, server validation, filters on games/circles/programmes/experiences, `taxonomy`/`tags` on every detail response, unified search (programmes + Circles + alias matching) | `server/src/taxonomy.ts`, `routes/categories.ts`, `routes/search.ts` |
| 2 | Admin Categories: directory with filters and reorder, 70/30 record page, full-page create/edit, activate/show/feature, merge (re-points listings, old slug answers with a redirect), archive/restore, delete only when unused, aliases, Uncategorised review with assign, Support "report wrong category" → reports queue, audit history; `taxonomy.view` (all) / `taxonomy.manage` (Super) | `routes/adminCategories.ts`, `client/src/components/admin/AdminCategories.tsx` |
| 3 | `CategoryPicker` (one searchable combobox) + `TagPicker` in host activity create/edit/series, Start a Circle, Circle settings; vendor `VendorCategoryEditor` (own save endpoint `/vendor/classification`) in programme, experience, club and venue editors | `client/src/components/categories/`, `VendorCategoryEditor.tsx` |
| 4 | `useCategoryFilter` + `CategoryChips` (URL `?category=&sub=`, legacy `?category=<label>` still works) on Activities, Circles, Programmes, Adventures, Experiences, Volunteer; counts per page kind; category-aware empty states | `CategoryChips.tsx`, `Games.tsx`, `Circles.tsx`, `BrowseLayout.tsx` |
| 5 | Breadcrumbs + tags on activity, Circle, programme and experience detail; "More like this" adds same-subcategory; Home "Popular right now" (live categories only); SEO: category list page indexable alone, combinations noindex + canonical, sitemap lists live categories (production mode) | `GameRelated.tsx`, `Home.tsx`, `ogMeta.ts` |
| 6 | Server 120 files / 1049 tests green (+20 taxonomy tests); client 302 green; client build OK; screenshots at 1440 and 390 with no overflow or console errors | `server/src/taxonomy.test.ts` |

**Dev backfill:** games 56/0/0, experiences 13/4/0, programmes 4/5/0, Circles 12/0/0, clubs 21/1/1, venues 13/0/10 (matched/ambiguous/unmatched). Ambiguous ones wait in Admin → Categories → Uncategorised.

**Not done / follow-ups:** category step in the vendor *creation* wizards (set after creation in the editor today); per-room facility categories; Explore hub page still shows types only; `categories_enabled` switch has no admin control (DB setting only); live server inventory to repeat before any production run; guarded `qa:*` Playwright suites not run.
