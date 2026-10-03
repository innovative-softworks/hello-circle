# HC-QA-011 — Circle summaries/upcoming aggregate private, draft and scheduled activities

## Remediation — FIXED LOCALLY — NOT DEPLOYED (2026-09-29)

Root cause: two relationships were conflated. A Circle's own plans are authoritative via
`games.circle_id`; the label match is only a public "nearby / you might also like"
recommendation (client labels it source `nearby`). Neither path applied visibility.
Fix: own plans are fetched by `circle_id` and filtered per viewer with `canViewGame`
(`filterViewable`); label matches (upcoming, nextPlan, plansThisMonth, recent-activity,
`/activity` counts) use `discoverableGameSql` only, so a label can never surface anything
beyond what `GET /games` already shows publicly. Organiser `/plans` also filters per viewer.
Original regression unchanged: PASS after fix. VIS-011-CIRCLE: legitimate public nearby
visible; members see circle-only own plan; organiser sees own draft in `/plans`; no
protected id (circle-only, draft, unrelated invite-only/draft/scheduled) appears in guest
or member upcoming/detail/list bodies; public→invite-only transition removes it.
Source-identified recent-activity/activity surfaces are now covered by the same helper
(counts verified in VIS-COUNTS).


Severity: **P1** (anonymous enumeration of invite-only, draft and not-yet-published
activities platform-wide). Status: **FIXED LOCALLY — NOT DEPLOYED** (was OPEN at discovery)
Classification: aggregation visibility defect (API). Not tenant/organisation isolation.

## Endpoints / code

- `GET /api/circles/:id/upcoming` (`routes/circles.ts`) — "nearby" branch selects
  `games WHERE status IN ('open','pending_participants') AND date >= today AND
  activity_label = <circle label>`; the "circle" branch selects by `circle_id`.
  Neither applies `visibility`, lifecycle draft or `publish_at`.
- `nextPlanFor()` / `plansThisMonthFor()` — same filters; feed `GET /api/circles`
  (list) and `GET /api/circles/:id` (detail) `nextPlan` / `plansThisMonth`.
- Source-identified, same pattern, not separately runtime-tested:
  `GET /api/circles/:id/recent-activity` "nearby" (past activities) and
  `GET /api/circles/:id/activity` counts.

## Reproduction (isolated QA)

USER_A creates an OPEN Circle with activity label L. Unrelated HOST_B creates three
activities with label L: invite-only active, public draft, public active with
`publishAt` 30 days in the future. Canonical `GET /games/:id` as GUEST: 404 for all three.

| GUEST read of USER_A's open Circle | invite-only | draft | scheduled |
|---|---|---|---|
| `/circles/:id/upcoming` includes id, date, time, location, price, capacity | yes | yes | yes |
| `/circles/:id` `nextPlan` | no (earliest chosen) | yes | no |
| `/circles` list `nextPlan` | no | yes | no |

Evidence: `hc-qa-011-circle-aggregation.json`. Regression: `HC-QA-011:`.

## Impact

Any resident can create an open Circle with a target activity label and read every
matching private/unannounced activity's id/date/time/location. Returned IDs feed
HC-QA-010 (participant names and host updates).

## Expected / suggested direction (not implemented)

Apply the canonical discoverability rule (public visibility, discoverable lifecycle,
`publish_at` null or past) to the "nearby" queries, and the draft/scheduled rule to
the Circle's own plans for non-hosts. Prefer one shared SQL predicate over another
per-router copy (see CLAUDE.md note on per-router status filtering).
