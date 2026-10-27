# HelloCircle — Category Architecture (Phase 0 proposal)

## 1. Data (MySQL, additive and backward-compatible — requires approval)

Following `CLAUDE.md`: an idempotent `CREATE TABLE IF NOT EXISTS` in `initSchema()`, with no edits to existing tables and no foreign keys (relationships enforced in application code, as everywhere else).

| Table | Columns | Why it's needed |
|---|---|---|
| `taxonomy_categories` | `id` VARCHAR(64) PK (stable slug-like ID), `parent_id` (NULL = category, set = subcategory), `name`, `slug` (unique), `description`, `families` (CSV of listing types), `icon` (Lucide name), `image_url`, `sort_order`, `active`, `discoverable`, `seo_title`, `seo_description`, `created_at`, `updated_at`, `row_version` | One table for categories and subcategories (adjacency list). Today's fixed lists can't do IDs, activation, ordering, SEO or admin editing. |
| `taxonomy_aliases` | `alias_norm` VARCHAR(191) PK, `category_id`, `source` (legacy / synonym / merge) | Maps legacy free text and merged categories to IDs, and keeps old slugs redirecting. |
| `listing_taxonomy` | `listing_type`, `listing_id`, `category_id`, `subcategory_id`, PK (`listing_type`, `listing_id`); index (`category_id`, `listing_type`) and (`subcategory_id`) | Same polymorphic pattern as `listing_attributes`. **No columns are added to the six listing tables**, and rollback is dropping three tables. |

**Tags:** reuse `listing_attributes`, extending the vocabulary in `participationVocab.ts`.

Rejected alternatives:
- `category_id` columns on six tables: six `ALTER`s, harder rollback.
- A table per family: duplicates concepts.

## 2. API (existing conventions: `server/src/routes/*`, `db.prepare`)

**Public reads** (cached, visible categories only):
- `GET /api/categories?family=activity` → categories with their subcategories and live counts (counts from `listing_taxonomy` joined to the family's own public filter: approval, lifecycle, org active, venue gate).
- `GET /api/categories/:slug` → detail plus SEO fields.

**Filters added to existing list endpoints** (no new search engine):
- `/api/games?categoryId=&subcategoryId=`
- the same parameters on experiences, programmes, Circles, centres and clubs;
- `search.ts` resolves a typed keyword through aliases to a category, so "football" matches every soccer listing.

**Writes:**
- Host and vendor create/edit accept `categoryId` / `subcategoryId`. The server checks that the category is active, applies to the listing type, and that the subcategory belongs to it; otherwise it returns 400. Existing ownership checks are unchanged.
- Admin (new permission `taxonomy.manage`, Super by default — **decision**): create, update with `rowVersion`, activate/deactivate, discoverable, reorder, merge (re-points `listing_taxonomy` and adds an alias; the old slug redirects), usage. Every write goes through `writeAudit()`. Delete is refused while a category is referenced.

## 3. Frontend components (reuse names and patterns in the codebase)

| Component | Based on | Used in |
|---|---|---|
| `CategoryPicker` (category + dependent subcategory, searchable) | `form.tsx` FieldLabel / FieldError, existing select styling | Host activity form, Start Circle, vendor programme/club/experience/venue editors, admin |
| `TagPicker` | Participation attribute checkboxes | Same forms |
| `CategoryChips` | `chips-scroll-mobile` chips in Explore / Games / BrowseLayout | Lists and Explore |
| `CategoryBreadcrumb` | Detail-page eyebrow (type label) | Detail pages ("Activity › Racket sports › Badminton") |
| `CategoryEmptyState` | `EmptyState` | Lists |
| Admin category directory and record page | `components/workspace/RecordView`, `adminUi.tsx` tables, `useUrlParam` | `/admin?tab=categories` |

## 4. Permissions and security

- Public: visible categories only.
- Hosts and vendors: select only; they never create global categories. The server validates every ID.
- Admin: `taxonomy.manage` (deny-by-default table). Merge and archive require the permission and a confirm dialog, and are audited.
- Disabled categories can't be chosen for new listings; existing listings keep them until re-categorised.

## 5. SEO

- **Keep:** `/games`, `/programs`, `/circles`, `/experiences`, `/adventures`, `/:county/:activity`.
- **Category filter URLs:** `/games?category=racket-sports&sub=badminton` and `/explore?type=activity&category=…`.
- **Indexing:**
  - indexed only for categories with live inventory;
  - canonical points to the type list + category;
  - filter combinations get `noindex`;
  - sitemap lists only categories with inventory;
  - a merged slug redirects (301) through `taxonomy_aliases`.
- **Not doing:** no new path-based category pages in the first release (decision).

## 6. Analytics

Add `categoryId` / `subcategoryId` to existing `logEvent` metadata (search, view, join), so reports group by ID instead of free text.

## 7. Schema review (2026-10-22)

| Check | Result / change |
|---|---|
| `taxonomy_categories.concept` | **Dropped from the first release.** A subcategory belongs to one category, and cross-family reach comes from the category's `families`, so a separate concept key isn't needed yet (YAGNI). |
| Uniqueness | `UNIQUE KEY (slug)` across categories and subcategories; `id` is the primary key and never changes; aliases unique by `alias_norm` |
| Depth | Two levels only: `parent_id` must point at a row whose own `parent_id` is NULL (checked in the API; no FKs, per `CLAUDE.md`) |
| `families` | CSV of listing types (about 21 rows, so a full scan is cheap); validated against the fixed type list |
| `listing_taxonomy` | PK (`listing_type`, `listing_id`), so one primary category per listing (extra facets are tags); `KEY (category_id, listing_type)`, `KEY (subcategory_id)`; subcategory must belong to the category (checked in the API) |
| Counts | Join `listing_taxonomy` to each family's existing public filter (approval, lifecycle, org active, venue gate); never count from `listing_taxonomy` alone |
| Concurrency | `row_version` on categories; edits use the existing `rowVersion` 409 pattern |
| Merge | One transaction: update `listing_taxonomy` → insert an alias for the old slug → mark the old row archived. Audited. |
| Idempotency | Seeding and backfill use `INSERT … ON DUPLICATE KEY UPDATE id = id`. Matched rows are counted from a SELECT, not `affectedRows` (mysql2 quirk noted in project memory). |
| Rollback | Feature flag off → drop three tables. No existing table altered. |
| Charset | `utf8mb4_unicode_ci` like the other tables; `VARCHAR(191)` keys for index length |
