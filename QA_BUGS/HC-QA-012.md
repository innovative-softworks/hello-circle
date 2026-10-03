# HC-QA-012 — Host profile and public discovery show draft / not-yet-published activities

## Remediation — FIXED LOCALLY — NOT DEPLOYED (2026-09-29)

Root cause: the SQL constant `DISCOVERABLE_LIFECYCLES_SQL` encodes only the stored lifecycle,
while `getEffectiveLifecycle()` also treats a future `publish_at` as draft; host profile had no
lifecycle filter at all. Fix: one shared predicate `discoverableGameSql()` in
`gameVisibility.ts` (public + discoverable lifecycle + `publish_at <= UTC_TIMESTAMP()`),
now used by `GET /games`, host profile, `listScheduledActivities` (Home/Explore/Search/Free
time), `nextSteps.nextGame`, `getLocalMomentum` and Circle label matches; share data also
treats future `publish_at` as draft. `DISCOVERABLE_LIFECYCLES_SQL` has no remaining game
consumer. Original regression: PASS after. VIS-012-SCHEDULED: scheduled and draft absent from
list, host profile, discover, search, share and next-steps; live control present in list,
host profile, search and next-steps; owner detail and `/games/mine` still include both.


Severity: **P2** (premature disclosure of the host's own unpublished activities; the
activities are public-visibility, not private). Status: **FIXED LOCALLY — NOT DEPLOYED** (was OPEN at discovery)
Classification: aggregation/publication visibility defect.

## Endpoints / code

- `GET /api/residents/:id/host-profile` — `upcomingGames` filters `status='open' AND
  visibility='public' AND date>=today`; no lifecycle filter at all → drafts appear.
- `GET /api/games` — filters `lifecycle IN DISCOVERABLE_LIFECYCLES_SQL`, but that
  shared constant (`lifecycle.ts`) is only the stored column. `getEffectiveLifecycle()`
  treats a future `publish_at` as **draft**; the SQL does not → scheduled activities
  are listed before their publish time.
- Same constant, source-identified, not runtime-tested here: `db/queries.ts:1240/1248`
  and `nextSteps.ts:92`.

## Reproduction (isolated QA)

HOST_A creates public: draft; active with `publishAt` +30 days; active (control).

| GUEST | draft | scheduled | live control |
|---|---|---|---|
| `GET /games/:id` | 404 | 404 | 200 |
| host profile `upcomingGames` | **listed** | **listed** | listed |
| `GET /games` | not listed | **listed** | listed |

Evidence: `hc-qa-012-profile-discovery.json`. Regression: `HC-QA-012:`.
Private (invite-only) activities and non-open Circles ARE correctly excluded from the
host profile, including after a public → private transition (STAGE-B-AGG-HOST-PROFILE PASS).

## Expected / suggested direction (not implemented)

Host profile: add the discoverable-lifecycle filter. Shared SQL predicate: include
`(publish_at IS NULL OR publish_at <= UTC_TIMESTAMP())` so SQL and
`getEffectiveLifecycle()` agree.
