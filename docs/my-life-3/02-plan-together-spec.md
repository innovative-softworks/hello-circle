# Plan Together with friends — spec for approval (D3, 2026-10-26)

Status: **not built**. Decision D3 (owner, "implement all as recommended"): show Circle plans now (done, My Life → For You → "Plan something together"); build plans with friends outside a Circle only after this spec is approved.

## What it is
A private plan between a few people who aren't necessarily in a Circle: pick dates, suggest real activities, vote, decide, then each person books through the normal flow.

## Reuse first
- Circle plans (`circle_plans`, polls, "I'm interested", convert to Session) already do this **inside a Circle**. If friends are happy to make a small private Circle, nothing new is needed. Ask: is a private Circle enough?
- Plan My Day (`day_plans`) already saves a day of real listings for one person.
- Invitations: `circle_invites` and `/invite` links exist for Circles; reuse the same email-verification and link model.

## New pieces (only if a private Circle isn't enough)
| Table | Columns |
|---|---|
| `shared_plans` | id, owner_resident_id, title, status (draft, inviting, voting, decided, booked, cancelled), decided_option_id, created_at, expires_at |
| `shared_plan_members` | plan_id, resident_id NULL, invite_email_hash, role (owner, member), status (invited, joined, declined), joined_at |
| `shared_plan_options` | id, plan_id, kind (date, activity), date, time, listing_type, listing_id, added_by |
| `shared_plan_votes` | option_id, resident_id, vote (yes, maybe, no), created_at |

Routes under `/api/my-life/plans` (resident only): create, invite (by email; the invitee must verify that email, same as Circle invites), add option, vote, decide, cancel, leave. Every read checks membership; no plan, option, vote or name is visible to non-members. Votes are shown as totals to members; names only to the owner, and only of people who joined (not of people who were merely invited).

## Rules
- Never books, holds or charges. "Decided" links each person to the normal booking or join page.
- Activity options must be real listings (listing_type + listing_id); prices and places are re-checked at booking.
- Expires 30 days after the last decided date or 60 days after creation; then read-only, deleted after 1 year.
- Behind a new switch `mylife.plan_together`, off by default.
- Audit: invite sent, plan cancelled, member removed (writeAudit pattern).

## Questions for the owner
1. Is a private Circle enough for "friends planning together"? (If yes, nothing new is built.)
2. Can a plan include people without a HelloCircle account yet (email invite), or only existing residents?
3. Should the owner see who voted for what, or totals only?
4. Is chat needed in a plan, or is it fine to send people to an existing Circle chat?

Estimated size if approved: 4 tables, ~8 routes, 1 page (`/my-life/plans/:id`), tests for access control and expiry.
