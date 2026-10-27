# Category system — remaining architecture gaps (review, 2026-10-22)

Two items were left out of the first build on purpose. Neither is built; this records value, dependencies and risks so the owner can decide.

## 1. Facility categories for venue rooms

**Today.** A venue (centre) has one primary category (`spaces-community`, `spaces-sport`, `spaces-creative`) in `listing_taxonomy`. Rooms (`rooms` table) are bookable spaces inside a venue with their own name, capacity, rate and active flag, but no category. Venue discovery and booking are behind the venue launch gate (`VENUE_PAGES_PUBLIC`), so no public page currently lists venues or rooms.

| | |
|---|---|
| Value | "Find a sports hall in Cork" would match a community centre that has one sports hall among its rooms; a centre with a hall, a kitchen and meeting rooms could appear under all three. |
| Dependencies | Venue pages must launch first (the gate); a `room` listing type in `listing_taxonomy` (no schema change — the table is polymorphic); room editor UI; counts/filters that roll room categories up to the venue without listing the venue twice; booking flow unchanged (room choice already happens inside `BookingFlow`). |
| Risks | Duplicate venue results if rollups are done per room; vendors classifying the venue and each room inconsistently; more admin review load; rooms can be deactivated but never deleted, so inactive rooms must be excluded from counts. |
| Effort | Small–medium once venues launch (≈ the vendor category editor + one rollup query). |
| **Recommendation** | **Not now.** Revisit when venue pages launch. Until then the venue's own category is enough and there is no public surface to show room categories on. |

## 2. Exposing the `categories_enabled` switch in Super Admin

**Today.** `app_settings.categories_enabled` (default `"1"`) is read by `listPublicCategories()` (public chips, Home "Popular", category SEO meta and sitemap entries return nothing when off) and `/api/categories/options` (host/vendor pickers hide themselves). It has no admin control; changing it means editing the database. List endpoints still honour `?categoryId=` filters when it is off, and existing assignments are kept.

| | |
|---|---|
| Value | A one-click, audited rollback for the public category UI during launch, without a deploy or database access — the migration plan's stated rollback step 1. |
| Dependencies | Admin Settings already has platform switches (`platform.settings`, Super only, step-up MFA). It would be one more row there plus an `audit_log` entry; the settings cache (5 s) means it takes effect within seconds. |
| Risks | Low. Turning it off hides category navigation and pickers but keeps data, so it is safe to flip both ways. It must not be confused with deleting categories; the label should say "Show categories on the site". Turning it off also removes category URLs from the sitemap (correct while off). |
| Effort | Small (one settings row, one test). |
| **Recommendation** | **Expose it before production rollout**, as a Super-only switch in Admin → Settings → Platform switches under the existing `platform.settings` permission (no new permission). Awaiting owner approval. |

## Related follow-ups noted during the build

- **Experience kind changes** (experience ⇄ volunteer) in the partner editor can leave a listing in a category of the other family; the integrity check (`GET /api/admin/categories/integrity`) reports it as `wrong_family`. The creation wizard already clears the choice when the kind changes. A server-side clear on kind change is a small follow-up.
- **`ACTIVITY_CATEGORIES`** (client constant) is no longer used by any form; it stays for one release as planned, then can be removed.
