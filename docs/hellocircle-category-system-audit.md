# HelloCircle — Category System Audit (Phase 0)

2026-10-22 · Read-only audit of code and the `hello_circle_dev` database. The production database was not read, so production values may differ and must be inventoried before any migration.

**Labels used below:**
- **Verified:** checked in code or data.
- **Recommendation:** proposal only.

## 1. Summary

HelloCircle has **no taxonomy system** today.

- **Free text:** activities and Circles are classified by a free-text `activity_label`; clubs by a free-text `sport`.
- **Unrelated fixed lists:** two hard-coded category lists live in different places for different purposes.
- **Tags:** an 8-value participation vocabulary acts as tags.
- **Discovery:** discovery is organised by listing type (routes), plus label chips on the activities list.
- **Missing:**
  - no category table;
  - no category IDs or slugs (beyond the free-text local SEO route);
  - no admin category management;
  - no category selector in host or vendor forms (except the clubs/programmes fixed list).

## 2. Listing-type × category matrix (Verified)

| Listing type | Existing categories | Storage | UI | Search support | Problems | Recommended change |
|---|---|---|---|---|---|---|
| Activity (`games`) | Free-text `activity_label` (16 distinct in dev, e.g. "Five-a-side Football", "Coffee & Chat Meetup"); `skill_level`, `surface_type`, `indoor_outdoor` | `games.activity_label` VARCHAR(255) | Host form: free text input "e.g. Badminton" (`HostGamePage.tsx:433`); list chips = most frequent labels (`Games.tsx:562`, `CATEGORY_CHIP_LIMIT 6`) | `GET /games?category=` matches the label exactly (`games.ts:304`); keyword search on label | Spelling variants split results ("Football" vs "Five-a-side Football"); no grouping into sports; chips change with inventory | Category + subcategory IDs; keep the label as the title |
| Circle | Free-text `activity_label` | `circles.activity_label` | Start Circle: free text (`StartCirclePage.tsx:115`) | Circles page filters | Same as activities | Same IDs, Circle-relevant categories |
| Adventure / Experience / Volunteer | Only `kind` (adventure · experience · volunteer); `difficulty`, `terrain_type`, `cause` | `experiences.kind` | Browse filters by difficulty (`ExperienceKindBrowse.tsx:35`) | Keyword search on title, blurb, kind (`search.ts`) | Nothing says "kayaking" vs "pottery" except the title | Category + subcategory |
| Programme | `category` from `ACTIVITY_CATEGORIES` (14 values) — **empty for all 9 in dev** | `programs.category` VARCHAR(50) | Vendor programme form select (`VendorPrograms.tsx`) | Programmes list text filter (`Programs.tsx:17,33`) | List exists but unused in data; mixes sports and audiences ("Kids & Family") | Map the 14 values to the new taxonomy |
| Club | `sport` free text (19 distinct) + `category` from `ACTIVITY_CATEGORIES` (empty) | `clubs.sport`, `clubs.category` | Club wizard/editor select (`ClubCreationWizard.tsx`, `VendorClubEditor.tsx`) | Browse clubs (gated) | "Soccer" vs "football"; category unused | Map sport → subcategory |
| Venue (`centres`, `rooms`) | None. Amenities and accessibility lists; `EVENT_TYPES` is a booking purpose, not discovery | `centres.amenities` etc. | Venue page facilities | Browse centres (gated) | No "sports hall" vs "meeting room" classification | Facility categories on the venue, optionally per room |
| Market / demand (admin) | `MARKET_CATEGORIES` (12: Badminton, Football, Swimming, Fitness, Yoga, Walking, Kids activities, Arts, Learning, Community events, Outdoor, Wellbeing) | `market_categories (county, category, enabled)` — empty in dev | Admin market config (`admin.ts:1270` validates against the list) | Interest clustering (`demandNormalize.ts` synonyms + `CATEGORY_OF`) | A third, different vocabulary | Becomes a view over the new categories |
| Tags | `PARTICIPATION_ATTRIBUTES` (8: first_timers_welcome, come_alone, beginner_friendly, no_experience, host_introduces, small_group, family_friendly, accessible) | `listing_attributes (listing_type, listing_id, attr)` — **reusable polymorphic pattern** | Participation block on detail pages | Not filterable in search | Small; no indoor/outdoor, evening etc. | Reuse as the Tags layer |
| Resident interests | `residents.interests` CSV text | — | Profile / onboarding | Personalisation | CSV, not IDs (known gap in `CLAUDE.md`) | Map to category IDs later |

## 3. Other findings

| # | Finding | Evidence | Kind |
|---|---|---|---|
| CAT-01 | Three unrelated vocabularies: `ACTIVITY_CATEGORIES` (client), `MARKET_CATEGORIES` (server), free-text labels | `client/src/constants.ts:25`, `server/src/db/queries.ts:877`, `demandNormalize.ts:4` (a hand-kept mirror) | Verified |
| CAT-02 | The activities list "category" filter is exact free-text label match | `server/src/routes/games.ts:304` | Verified |
| CAT-03 | The clubs/programmes category is defined but no listing in dev uses it | DB: `programs.category` '' ×9, `clubs.category` '' ×22 | Verified (dev only) |
| CAT-04 | Home and Explore organise by listing type only (Sports & games, Experiences & adventures, Circles, Events, Clubs & programmes, Venues & spaces, Volunteering) | `Home.tsx:427-437`, `Explore.tsx:27-37` | Verified |
| CAT-05 | "Events" isn't a listing type: Home links it to `/explore?when=weekend` | `Home.tsx:430` | Verified |
| CAT-06 | Volunteer is an experience `kind`; classes are programme sessions | `experiences.kind`, `program_sessions` | Verified |
| CAT-07 | A local SEO route already exists: `/:county/:activity`, keyed on a free-text activity slug | `App.tsx:454`, `LocalActivity.tsx` | Verified |
| CAT-08 | Synonym logic exists for demand clustering (cycle/bike → cycling, gym → fitness …) | `demandNormalize.ts:30-50` | Verified; reusable for alias mapping |
| CAT-09 | No admin permission covers taxonomy; the closest are `listings.edit` and `platform.settings` | `server/src/adminPermissions.ts` | Verified |
| CAT-10 | Venues and clubs are behind the public launch gate | `VENUE_PAGES_PUBLIC` | Verified |
| CAT-11 | Search covers centres, clubs, activities and experiences; not programmes or Circles | `search.ts:155` returns `{centres, clubs, activities, experiences}` | Verified |

## 4. What can be reused

- `listing_attributes` (polymorphic `listing_type` + `listing_id`, indexed): the pattern for a listing→category link, and as-is for tags.
- `demandNormalize.ts` synonyms: seed for the alias table.
- The `/games` `category` query parameter, `Explore` type chips and `ExperienceKindBrowse` filters: the UI slots for category filters.
- Admin record-page template (70/30 RecordView), `adminPermissions.ts` (deny-by-default) and `writeAudit()`.
- The `LocalActivity` SEO route.
