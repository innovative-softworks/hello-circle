# HC-QA-010 — Game child reads ignore canonical activity visibility

## Remediation — FIXED LOCALLY — NOT DEPLOYED (2026-09-29)

Root cause: both child routes predated the lifecycle-audit fix and loaded children by
`game_id` without consulting the parent's visibility. Fix: each now calls
`loadViewableGame()` (`gameVisibility.ts`, canonical detail rule `canViewGame`) and returns
the same 404 as a missing id — the protected activity itself is no longer confirmed, not
just the names redacted. `.ics` moved onto the same helper. Original regression unchanged:
FAIL before, PASS after. New VIS-010-TRANSITION: public → all four actors 200; after
public→invite-only, guest and unrelated user 404 on participants/updates/detail and the
update marker is absent; invitee and host keep 200.


Severity: **P1** (private personal data + private host content disclosed to anonymous
viewers; chains with HC-QA-011, which hands out the protected activity IDs).
Status: **FIXED LOCALLY — NOT DEPLOYED** (was OPEN at discovery)
Classification: API authorization/visibility defect. Not a test/environment failure.

## Endpoints

- `GET /api/games/:id/participants` — public, "Who's going" names + total.
- `GET /api/games/:id/updates` — public, host announcement text.

Canonical reference `GET /api/games/:id` applies `canViewGame()` (private visibility
→ host/joined/Circle member/invitee only; draft → host only) and returns 404.
`/ics` applies the same gate. The two child routes above apply no gate.

## Reproduction (isolated QA, synthetic data)

HOST_A creates (a) an invite-only active activity and (b) a public draft, then posts
one update containing a random marker. As GUEST and as USER_B (no relationship):

| Read | (a) invite-only | (b) draft |
|---|---|---|
| `GET /games/:id` | 404 | 404 |
| `GET /games/:id/participants` | 200, participant name list | 200, participant name list |
| `GET /games/:id/updates` | 200, update text incl. marker | 200, update text incl. marker |

Evidence: `.qa-data/<run>/evidence/hc-qa-010-game-children.json` (booleans/statuses only).
Regression: `tests/integration/specs/stage-b-findings.spec.ts` → `HC-QA-010:`.
Host positive control (host reads own updates) passes. Game rows unchanged.

## Impact

Anyone with an activity ID learns who is attending a private/invite-only or
unannounced activity and reads host messages (often meeting details/changes).
IDs are UUIDs, but HC-QA-011 exposes IDs of invite-only/draft/scheduled activities
to anonymous callers, so the chain is practical.

## Expected / suggested direction (not implemented)

Both routes should load the game row and apply the same `canViewGame()` +
draft gate as `GET /:id` (404 when denied). No schema change needed.
