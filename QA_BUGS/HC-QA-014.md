# HC-QA-014 — Any resident can attach an activity to any Circle (presented as the Circle's own plan)

## Product decision + remediation — FIXED LOCALLY — NOT DEPLOYED (2026-09-29)

Evidence that the product implies **Model A (Circle-controlled planning)**: every client path
that sends `circleId` is organiser-only — CircleDetail "Create first plan" (`isOrganiser`),
"Do it again" (`isOrganiser`), ManageCircle "Create a plan" (organiser workspace),
StartCirclePage (creator = organiser), CirclePlanIdeaCard "Create activity" (`isOrganiser`,
plus server-checked `planId`). Member suggestions already have their own object: plan-ideas
(idea → organiser confirms → organiser creates activity), i.e. Model B exists separately and
never directly becomes a Circle plan. The server comment ("not ownership-checked … whoever's
running this wizard") assumed the organiser-only wizard, not direct API use.
Implemented: `POST /api/games` with `circleId` requires the caller to be that Circle's
organiser (403 otherwise). `PUT` never changes `circle_id`. Original regression: PASS after.
VIS-014-015: member (non-organiser) 403 with no game row; organiser attach 201.
Reviewer may still overturn the model; this is the documented basis.


Severity: **P2 — product decision required** (relationship integrity/spoofing inside a
private Circle; no private data read by the attacker). Status: **FIXED LOCALLY — NOT DEPLOYED** (was OPEN at discovery) Classification: missing parent relationship validation,
documented in code as intentional.

## Endpoint / code

`POST /api/games` with `circleId` (`routes/games.ts`, `CreateGameInput.circleId`):
"Not ownership-checked here … regardless of which circle they're creating it for."
`planId` conversion IS organiser/state-checked. (Correction during remediation: `PUT
/api/games/:id` does not update `circle_id`; the earlier "also accepts" note was wrong.)

## Reproduction (isolated QA)

USER_A organises an invite-only Circle. HOST_B (not a member; `GET
/circles/:id/upcoming` → 403) creates an activity with that `circleId` → 201. The
Circle's members then see it in `/circles/:id/upcoming` with `source: "circle"`
("From this Circle"); it also drives `nextPlan`, `plansThisMonth`, the organiser
`/plans` list and `canViewPrivateGame()` membership grants for that activity.

Evidence: `hc-qa-014-circle-attachment.json`. Regression: `HC-QA-014:`.

## Decision needed

The test encodes the Stage B relationship rule (Circle A + child from outsider must not
be presented as the Circle's own). If product intends open tagging, the regression
should be replaced by an explicit, reviewed acceptance, not deleted silently.
Suggested direction: require membership (or organiser role) of `circleId`.
