# HelloCircle Categories — Decision Report (for approval)

2026-10-22. Nothing is built. The database is unchanged until this report is approved.

**Already decided:**
- Category edits: Super Admin only.
- Support: read-only, can report classification problems.
- The 9 ambiguous listings stay unassigned until reviewed.
- Book club, coasteering, athletics and gymnastics are added.
- No venue/club exposure.
- Listing types and booking flows unchanged.

## 1. Categories and subcategories (21)

Applies to: A = activity, X = adventure / experience, V = volunteer, P = programme, C = Circle, K = club, N = venue (and its rooms).

| # | ID (= slug) | Category | A | X | V | P | C | K | N | Subcategories (ID = slug) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `soccer` | Soccer | ✓ | | | ✓ | ✓ | ✓ | | 5-a-side, 7-a-side, 11-a-side, futsal, casual-kickabout |
| 2 | `gaelic-games` | Gaelic games | ✓ | | | ✓ | ✓ | ✓ | | gaelic-football, hurling, camogie, handball, rounders |
| 3 | `racket-sports` | Racket sports | ✓ | | | ✓ | ✓ | ✓ | | badminton, tennis, padel, squash, table-tennis, pickleball |
| 4 | `team-sports` | Team sports | ✓ | | | ✓ | ✓ | ✓ | | basketball, volleyball, cricket, rugby, hockey, netball |
| 5 | `fitness-wellness` | Fitness & wellness | ✓ | ✓ | | ✓ | ✓ | ✓ | | yoga, pilates, hiit, running, bootcamp, gym, **athletics**, **gymnastics** |
| 6 | `outdoors` | Outdoors & adventure | ✓ | ✓ | | | ✓ | ✓ | | hiking, walking, cycling, camping, climbing, orienteering |
| 7 | `water` | Water sports | ✓ | ✓ | | ✓ | ✓ | ✓ | | swimming, kayaking, paddleboarding, surfing, sailing, rowing, **coasteering** |
| 8 | `dance` | Dance | ✓ | | | ✓ | ✓ | ✓ | | irish-dance, salsa, ballet, hip-hop, contemporary |
| 9 | `martial-arts` | Martial arts & boxing | ✓ | | | ✓ | | ✓ | | boxing, karate, judo, taekwondo, bjj |
| 10 | `games-social` | Games & social | ✓ | | | | ✓ | | | board-games, chess, quiz, card-games, darts-pool |
| 11 | `meetups` | Meetups & community | ✓ | | | | ✓ | | | coffee, language-exchange, newcomers, networking, community-gathering, **book-club** |
| 12 | `arts-crafts` | Arts & crafts | ✓ | ✓ | | ✓ | ✓ | | | pottery, painting, photography, crafts, creative-writing, woodwork |
| 13 | `music` | Music | | ✓ | | ✓ | ✓ | | | guitar, piano, singing, trad-music, live-music |
| 14 | `food-drink` | Food & drink | | ✓ | | ✓ | ✓ | | | cooking, baking, food-tours, tastings |
| 15 | `culture-heritage` | Culture & heritage | | ✓ | | | | | | heritage-tours, city-walks, museums, theatre |
| 16 | `learning` | Learning & skills | | | | ✓ | | | | languages, coding, tutoring, first-aid, professional-skills |
| 17 | `kids-family` | Kids & family | | ✓ | | ✓ | | | | after-school, camps, early-learning, family-days |
| 18 | `volunteering` | Volunteering & causes | | | ✓ | | ✓ | | | environment, community, charity, animals |
| 19 | `spaces-community` | Community halls & rooms | | | | | | | ✓ | community-hall, meeting-room, function-room, classroom |
| 20 | `spaces-sport` | Sports facilities | | | | | | | ✓ | sports-hall, pitch, court, pool, studio |
| 21 | `spaces-creative` | Creative & specialist spaces | | | | | | | ✓ | art-studio, rehearsal-room, kitchen, makerspace |

**Rules:**
- IDs and slugs are lowercase-hyphenated, unique across all rows, and never change after creation (renaming changes only `name`).
- "Football" is never a category; it's an alias that needs review (soccer or Gaelic).
- Volunteer listings are experiences of kind `volunteer` and only use `volunteering`.

## 2. Tables (MySQL, additive, in `initSchema()`)

```sql
CREATE TABLE IF NOT EXISTS taxonomy_categories (
  id              VARCHAR(64)  NOT NULL,             -- stable; = slug at creation
  parent_id       VARCHAR(64)  NULL,                 -- NULL = category; else its category
  name            VARCHAR(120) NOT NULL,
  slug            VARCHAR(80)  NOT NULL,
  description     VARCHAR(500) NULL,
  families        VARCHAR(200) NOT NULL,             -- CSV of listing types (section 1)
  icon            VARCHAR(40)  NULL,                 -- Lucide icon name
  sort_order      INT          NOT NULL DEFAULT 0,
  active          TINYINT(1)   NOT NULL DEFAULT 1,   -- selectable for new listings
  discoverable    TINYINT(1)   NOT NULL DEFAULT 0,   -- shown in public chips/filters
  archived_at     DATETIME     NULL,                 -- set by merge/archive, never deleted
  seo_title       VARCHAR(120) NULL,
  seo_description VARCHAR(300) NULL,
  row_version     INT          NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_taxonomy_slug (slug),
  KEY idx_taxonomy_parent (parent_id, sort_order)
);

CREATE TABLE IF NOT EXISTS taxonomy_aliases (
  alias_norm  VARCHAR(191) NOT NULL,   -- lower-cased, trimmed, collapsed spaces
  category_id VARCHAR(64)  NOT NULL,   -- a category OR subcategory id
  source      VARCHAR(20)  NOT NULL,   -- 'legacy' | 'synonym' | 'merge' | 'slug'
  needs_review TINYINT(1)  NOT NULL DEFAULT 0, -- e.g. 'football' → never auto-applied
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (alias_norm),
  KEY idx_alias_category (category_id)
);

CREATE TABLE IF NOT EXISTS listing_taxonomy (
  listing_type   VARCHAR(20)  NOT NULL,  -- game | experience | program | circle | club | centre
  listing_id     VARCHAR(191) NOT NULL,
  category_id    VARCHAR(64)  NOT NULL,
  subcategory_id VARCHAR(64)  NULL,
  assigned_by    VARCHAR(20)  NOT NULL,  -- 'backfill' | 'host' | 'vendor' | 'admin'
  assigned_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (listing_type, listing_id),
  KEY idx_lt_category (category_id, listing_type),
  KEY idx_lt_subcategory (subcategory_id)
);
```

- **Foreign keys:** none declared, following the project rule (`CLAUDE.md`: every relationship is enforced in application code). Integrity is enforced three ways:
  1. **On write:** every API that sets a category checks that it exists, is active (for new assignments), applies to the listing type, that the subcategory's `parent_id` equals the category, and that two-level depth holds.
  2. **Delete refused** while any `listing_taxonomy` row or alias references the row; archive instead.
  3. **Integrity check** (admin page plus a test): orphans (a listing row whose listing no longer exists, or an unknown category), wrong-family assignments, subcategory/category mismatches.
- **Scalability:** about 120 rows. Indexes cover "listings in category X of type Y" and "category of listing Z". Adding a category, subcategory or family is a row edit, not a deploy.

## 3. How listings link

- One row in `listing_taxonomy` per listing: its **primary** category and optional subcategory.
- Extra descriptors use the existing tags (`listing_attributes`).
- The listing tables (`games`, `experiences`, `programs`, `circles`, `clubs`, `centres`) are **not altered**. Free-text `activity_label` and `sport` stay as titles.
- Programmes with no clear title use the parent club's sport as a **suggestion** that an admin confirms.

## 4. Uncategorised listings

- **No row means uncategorised.** Such listings still appear normally in lists, search and detail pages, just not under a category filter.
- **Admin:** an "Uncategorised" view per type (the 9 ambiguous dev listings start here).
- **Hosts and vendors:** a prompt to pick a category when they next edit (optional at first, not blocking).

## 5. Admin UX (`/admin?tab=categories`)

| Role | Can |
|---|---|
| Super | Create, edit, activate/deactivate, show/hide, reorder, merge (re-points listings, keeps the old slug as an alias), archive, assign listings |
| Support (and others with `taxonomy.view`) | Read everything; **report a classification issue** on a listing through the existing `reports` flow (reason "Wrong category"), which Super resolves |

**Pages:**
- **Directory:** table with category, families, subcategory count, listing count, active, discoverable, order and updated. Filters for family, status, usage and uncategorised.
- **Record page (70/30):** overview, subcategories (reorder), listings, discovery and SEO, change history (`writeAudit`).
- **Create and edit:** full page.
- **Confirmations:** dialogs for merge (showing the listing count) and archive. Delete only when unused.

**Permissions:** `taxonomy.view` for ALL, `taxonomy.manage` for [Super] in the deny-by-default table. The permission walk test covers every new route.

## 6. Host UX (activity, Start Circle)

- **"What are you organising?":** one searchable field. Typing "badm" shows "Badminton — Racket sports"; picking a subcategory sets its category. Only categories valid for that listing type are listed.
- **Title:** stays free text and is pre-filled from the choice.
- **Tags:** optional checkboxes.
- **Editing:** keeps the saved choice. An inactive category shows "No longer offered — choose another".
- **Required?** Optional in the first release (decision already listed).

## 7. Unified search (Programmes + Circles)

**Contract (additive only).** `GET /api/search` keeps `{parsed, centres, clubs, activities, experiences}` and adds:
- `programmes`: each with id, title, parent name, area, next session date, price;
- `circles`: each with id, slug, name, activity, area, member count.

Old clients ignore the new keys.

**Visibility** (reusing existing rules, no new ones):

| Type | Included when |
|---|---|
| Programmes | `status = 'published'`, organisation active (`orgActiveSql`), has upcoming sessions or is marked ongoing |
| Programmes on a hidden venue/club | Still listed (programme pages are public today); the venue/club link isn't shown while gated |
| Circles | `status = 'active'` and `join_mode IN ('open','approval')` |
| Approval Circles | Teaser fields only (existing `toCircleTeaserJson`: no image, no members list) |
| Invite-only Circles | Never |

**Matching:**
- Keywords on title and description.
- Categories through `taxonomy_aliases`, so "football" finds soccer and Gaelic, and "badminton" finds activities, programmes, clubs and Circles.

**Results:** ranked by the existing order (county, then date). Venues and clubs remain excluded while gated.

## 8. Migration, verification, rollback

**Steps:**
1. Repeat the read-only category inventory on the live server.
2. Create the three tables.
3. Seed the categories, subcategories and aliases.
4. Backfill exact, non-review aliases only; ambiguous ones stay unassigned.
5. Report matched, unmatched and needs-review counts per type.

**Verification:**
- Listing counts per type unchanged.
- Every public list without a category filter returns the same rows before and after.
- The integrity check returns zero issues.
- The booking, payment and refund suites are unchanged and green.

**Rollback:** turn off the `categories` feature flag (the UI falls back to today), then drop the three tables. No existing table or row is modified at any point.

## 9. Risks, dependencies, sequence

| Risk | Mitigation |
|---|---|
| Wrong auto-match | Exact aliases only; `needs_review` aliases never auto-applied |
| Empty categories in public | `discoverable` defaults to 0; shown only with live inventory |
| Gate leaks | Counts, filters and search reuse the existing venue gate and org filters |
| Drift between client lists and the table | `ACTIVITY_CATEGORIES` / `MARKET_CATEGORIES` read from the table after release; kept as fallback for one release |

**Sequence** (each step tested before the next):
1. Tables + seed + backfill report (dev / QA).
2. Read API + server validation.
3. Admin directory, record page and permissions.
4. Host and vendor pickers.
5. Unified search (programmes, Circles, aliases).
6. List chips, breadcrumbs, SEO.

**Dependency:** step 1 needs approval of sections 1 and 2.

## Approve to proceed

- [ ] The 21 categories and subcategories (section 1)
- [ ] Table definitions and integrity approach (section 2)
- [ ] Unified search contract and visibility (section 7)
- [ ] Migration and rollback plan (section 8)
