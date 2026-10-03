# Canonical activity (game) visibility policy — Stage B remediation (2026-09-29)

Status: implemented locally in `server/src/gameVisibility.ts` — **FIXED LOCALLY — NOT DEPLOYED.**
Derived from the actual schema and code; no new states were invented.

## Actual fields

| Field | Values | Meaning |
|---|---|---|
| `games.visibility` | `public`, `circle`, `invite` | Privacy. `circle` = Circle members; `invite` = invitees (share UI labels it "private"). There is no separate `private` value. |
| `games.lifecycle` (stored) | `draft`, `coming_soon`, `active`, `paused`, `archived` | Creator's publishing state (`lifecycle.ts`). |
| `games.publish_at` | NULL or UTC DATETIME | Scheduled publish; while in the future the effective lifecycle is **draft** (`getEffectiveLifecycle`). |
| `games.status` | `open`, `pending_participants`, `cancelled` | Operational; `cancelled` → effective lifecycle `cancelled`. |
| `games.date` | date | Past date → effective lifecycle `completed`. |
| `games.host_resident_id` | resident | Owner/host. |
| `games.circle_id` | Circle or NULL | Authoritative Circle association (organiser-only since HC-QA-014). |
| relationships | `game_participants` (joined), `circle_members`, `invitations` (invitee) | Grant non-public visibility. |

Admin (`users.role='admin'`) has no resident session and no game-read override: an admin
caller is treated exactly like a public visitor on these resident surfaces.

## Two canonical rules (single module)

1. **Detail rule — `canViewGame(row, viewer)`**: effective draft (incl. future `publish_at`)
   → host only; otherwise `public` → everyone; `circle`/`invite` → host, joined
   participant, member of `circle_id`, or resident-bound invitee with an unexpired
   pending/accepted/maybe invitation (HC-QA-017). Declined, expired or removed
   invitations grant no relationship. `loadViewableGame()` returns null
   (callers 404) when denied. Archived/cancelled/completed remain reachable by URL
   under this rule (documented product decision, `routes/games.ts` GET /:id comment).
2. **Discovery rule — `discoverableGameSql(alias)`**: `visibility='public' AND lifecycle IN
   ('coming_soon','active','paused') AND (publish_at IS NULL OR publish_at <= UTC_TIMESTAMP())`,
   plus each caller's own status/date window. The SQL twin of `canDiscover(getEffectiveLifecycle())`.

Invariant: a secondary endpoint never exceeds rule 1; anything shown to callers without a
relationship (lists, profiles, recommendations, public counts) uses rule 2. Relationship
views (a Circle's own plans) filter rows per viewer with rule 1 (`filterViewable`).

## Matrix (✓ = shown, ✗ = hidden/404, H = host only)

Actors: V public visitor · U authenticated, no relationship · P participant / invitee /
Circle member (per visibility) · O owner/host · M Circle organiser (management) · A admin (= V).

| Surface \ state | public published | public future `publish_at` | draft | circle-only | invite-only | archived / cancelled / completed |
|---|---|---|---|---|---|---|
| Detail `GET /games/:id`, `.ics` | ✓ all | O | O | O, P | O, P | ✓ by URL (not discoverable) |
| Participants `/participants` | ✓ all | O | O | O, P | O, P | follows detail |
| Updates `/updates` | ✓ all | O | O | O, P | O, P | follows detail |
| Host roster `/participants/manage` | O | O | O | O | O | O |
| Search/discovery (`GET /games`, `/discover`, `/search`, free-time) | ✓ (status/date window) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Host profile `upcomingGames` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Next steps (`nextGame` recommendation) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Circle own plans (`circle_id`: upcoming, nextPlan, plansThisMonth, recent-activity) | per rule 1 for the viewer | O | O (organiser who is host sees own) | O, P (members) | O, P | past only in recent-activity |
| Circle organiser `/plans` | per rule 1 for organiser | as detail | as detail | ✓ (member) | as detail | as detail |
| Circle "nearby" (label match) suggestions and counts | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Public counts (momentum, Circle `/activity`, `plansThisMonth` nearby) | counted | not counted | not counted | not counted | not counted | not counted |
| Share card / OG | ✓ | ✗ (null → 404) | ✗ | teaser "Circle-only activity" unless P | teaser "Invite-only activity" unless P | as before |
| Saved (favourites) / host-follow feed | rule 1 per viewer (pre-existing) | | | | | |

Explicit product projections (documented, unchanged): the share-card teaser for
circle/invite activities exposes only the entity id and a generic title, never details.

## Consumers migrated

`routes/games.ts` (GET `/`, `/:id/participants`, `/:id/updates`, `/:id/ics`),
`routes/residents.ts` (host profile), `routes/circles.ts` (`nextPlanFor`, `plansThisMonthFor`,
`/:id/upcoming`, `/:id/plans`, `/:id/recent-activity`, `/:id/activity`), `db/queries.ts`
(`listScheduledActivities` ×2, `getLocalMomentum`), `nextSteps.ts` (`nextGame`),
`routes/sharing.ts` (`getShareData` future `publish_at`). Already on rule 1:
`favourites.ts`, `follows.ts` feed, GET `/:id`.

Not migrated (authorized admin-only aggregates): `getSupplyOverview`, `getLiquidityScores`,
participation stats (`/api/admin/*`). Host's own dashboards (`/games/mine`, host insights) are
owner-scoped.

## Join / waitlist closure (HC-QA-016)

Join and waitlist now require the canonical detail/relationship rule before mutation,
followed by their existing lifecycle/capacity rules. Join checks before coupons/offers
and again against the row-locked activity; waitlist checks inside a row-locked transaction.
This is not the public-discovery predicate: legitimate invitees and Circle members
remain eligible. Hidden/nonexistent activity returns generic 404. HC-QA-016 fixed
locally, not deployed; original regression and focused positive/negative matrix pass.
That checkpoint did not change invitation status/expiry semantics. The subsequent
final-closure checkpoint (HC-QA-017..021) now enforces the active invitation predicate
above. Email-only invitation responses require normalized authenticated recipient
email; resident-bound responses require the matching resident. Game invitation
creation requires loadViewableGame before insertion. Response consumption is a
single conditional pending/unexpired ID/token UPDATE. Independent joined participant
or Circle entitlements are not revoked merely by expiring an invitation. See
QA_STAGE_B_FINAL_CLOSURE.md for runtime cases and the final-validation blocker.
