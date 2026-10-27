# HelloCircle — Category Migration Plan (not started; needs approval)

## Approach: additive, no existing data changed

1. **Inventory production values first.** *(Done 2026-10-22 for the local production-designated database: 2 clubs, 3 venues, no other listings. Repeat on the live server before go-live.)* Distinct `games.activity_label`, `circles.activity_label`, `clubs.sport`, `clubs.category`, `programs.category`, `experiences.kind` and `cause`, plus `market_categories`, from a read-only session.
2. **Create** the three new tables in `initSchema()` (idempotent `CREATE TABLE IF NOT EXISTS`). No `ALTER` on existing tables.
3. **Seed** the approved categories and subcategories, and aliases from section 4 of the taxonomy doc plus `demandNormalize.ts` synonyms.
4. **Backfill** `listing_taxonomy` by exact alias match (normalised label → subcategory). Rows are only ever inserted, never updated, so a re-run is a no-op (`INSERT … ON DUPLICATE KEY` guarded, per the memory note on mysql2's `affectedRows`).
5. **Report** matched / unmatched per type. Unmatched listings go to the admin "Uncategorised" view for manual assignment; nothing is guessed.
6. **Validate:** listing counts per type are unchanged; every public list returns the same rows with no category filter.
7. **Switch the UI** to the pickers and filters. The free-text label stays the title. `ACTIVITY_CATEGORIES` and `MARKET_CATEGORIES` become derived from the table (kept as fallback for one release).

## Rollback

- Hide the UI behind a feature flag.
- Drop `listing_taxonomy`, `taxonomy_aliases` and `taxonomy_categories`.
- No existing column or row was changed, so nothing else needs restoring.

## Risks

| Risk | Mitigation |
|---|---|
| Production labels differ from dev | Step 1 inventory before seeding |
| Wrong automatic match ("Football" → soccer when it was Gaelic) | Only exact alias matches; ambiguous terms (football) are left uncategorised for review |
| Category pages with no inventory | Visible only with live listings |
| Performance of counts | Indexed `listing_taxonomy`; counts cached briefly; same visibility filters reused |
| Venue/club gate leak | Counts and filters reuse the existing gate checks |
