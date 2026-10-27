# Experience 3.0 — 06 Technical architecture

No new framework, dependency or database. New server modules:
- `circleFeatures.ts` — one switch catalogue for `circles.*` and `experience.*` (app_settings, default off), `requireFeature()`.
- `discoveryMatch.ts` — pure: dates for when-choices, part of day, `matchListings` (day/time/budget/solo/length), `pickSurprise`, `buildCollections`.
- `dayPlanner.ts` — pure: rough travel estimate (straight line × 1.3 at 20 km/h + 15 min), DP over timed stops.
- `spotAlerts.ts` — router + `sweepSpotAlerts()` (5-minute timer, plus right after a customer cancels).
- `routes/experienceHub.ts` — Passport, programme journey, Plan My Day, saved plans (`/api/experience`).
- Collaboration routes appended to `routes/circleExperience.ts`; conversion inside `games.ts`'s `createGameRow` transaction (same pattern as plan ideas).

Shared change: `ScheduledActivity.durationKnown` (queries.ts) — games and experiences now carry their real stated
length; club sessions are marked unknown. Ranking (`scoreActivities`) is reused everywhere; no new recommendation
engine. Signed-out visitors get host-set attributes via `loadAttributes()` (now exported) for solo/collections.
