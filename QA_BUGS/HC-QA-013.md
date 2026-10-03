# HC-QA-013 — Circle poll vote accepts a poll from another Circle

## Remediation — FIXED LOCALLY — NOT DEPLOYED (2026-09-29)

Fix: after membership of `:id`, the poll is resolved with `WHERE id = ? AND circle_id = ?`
(404 otherwise) before the option lookup. Siblings checked: close (already circle-scoped),
list (circle-scoped), create-with-planId (plan resolved through the Circle). Original
regression: PASS after. VIS-013-POLL matrix: Circle B + Poll A 404; Circle A + Poll B 404;
Poll A + foreign option 404; nonexistent Circle 403; nonexistent poll 404; votes and polls
unchanged after each; Circle A + Poll A member 200 with exactly one vote row.


Severity: **P2** (nested parent→child write IDOR; integrity of a private Circle's
decision; requires the victim poll UUID, option IDs are sequential integers).
Status: **FIXED LOCALLY — NOT DEPLOYED** (was OPEN at discovery)
Classification: API authorization defect — exactly the HC-QA-008/009 pattern
("authorize(parent) + lookup child globally").

## Endpoint

`POST /api/circles/:id/polls/:pollId/options/:optionId/vote` (`routes/circles.ts`).
Checks: caller is a member of `:id`; option belongs to `:pollId`. **Missing:** poll
belongs to `:id`. Sibling `.../close` IS scoped (`WHERE id = ? AND circle_id = ?`).

## Reproduction (isolated QA)

USER_A organises invite-only Circle A with a poll; USER_B organises Circle B.

| USER_B request | Result |
|---|---|
| `GET /circles/A/polls` | 403 (correct) |
| `POST /circles/A/polls/<A poll>/options/<A option>/vote` | 403 (correct) |
| `POST /circles/B/polls/<A poll>/options/<A option>/vote` | **200; vote row recorded in Circle A's poll** |

Evidence: `hc-qa-013-poll-vote.json` (`foreignVoteRecorded: true`). Regression: `HC-QA-013:`.
Owner vote positive control passes. Other Circle children verified scoped in the same
phase: plan-idea read/edit/confirm/cancel, poll-plan binding, poll close,
join-request respond, invitation respond (STAGE-B-CIRCLE-CHILDREN PASS).

## Expected / suggested direction (not implemented)

Resolve the poll with `WHERE id = ? AND circle_id = ?` before the option lookup; 404
when absent.
