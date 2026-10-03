# HC-QA-016 — Joining an invite-only activity bypasses invite-only visibility

## Closure — 2026-09-29 (current)

**P1 — FIXED LOCALLY — NOT DEPLOYED.** The historical discovery below is retained.
Original stage-b-open regression unchanged: FAIL before / PASS after. Waitlist also
runtime-confirmed: unrelated invite-only resident received 201 before the fix;
same root cause, tracked here rather than under another ID.

Fix in `server/src/routes/games.ts`: join calls `loadViewableGame` before coupon,
offer or transaction work, then `canViewGame` on the locked activity before writes.
Waitlist locks the activity and checks `canViewGame` before lifecycle/duplicate
checks and insertion. Hidden and missing activities return identical generic 404.
Canonical policy itself and HC-QA-014 Model A are unchanged.

Focused real API/MySQL results: original regression + three new scenarios PASS.
Public resident, legitimate invitee and Circle member succeed (join 200, waitlist
201). Unrelated invite/Circle, former member without other relationships, draft
and future-publish non-owner requests return 404. Owner detail remains accessible.
Joined participant/waitlist counts are exactly one for each successful control.
Denied requests preserve activity/capacity, participants/payment fields, waitlists,
invitations, residents/roles, Circle membership, bookings/registrations/enrollments,
sessions, notifications, resource audit and analytics snapshots. No values or tokens
are emitted in evidence.

Paid boundary: unauthorized paid join (also with invalid coupon) returns 404 before
coupon/provider handling, no row changes. Authorized invitee reaches existing 503
`Payments aren't configured yet`; pending participant is cleaned up. No Stripe
client configured; test-only outbound counter remains zero. This proves the local
boundary, not payment completion. Game payment state lives on game_participants;
there is no separate game payment table to assert.

Concurrent legitimate free joins: 200/409, one logical participant, protected by
existing game row lock and UNIQUE(game_id, resident_id). No broad concurrency audit.

New tests: `join-visibility.spec.ts`; existing `stage-b-open.spec.ts` unchanged.
Both are included in `qa:security-gate`. Full rerun results recorded in QA_REPORT.md.
Final: gate 31 PASS (002..016), real auth/security 20 PASS, authorization 75 PASS;
typechecking/build PASS, safety 91, client 81. Mocked smoke 13 PASS / known 001 FAIL.
Initial new-test evidence naming errors were TEST BUGS, corrected before waitlist
reproduction; no product assertion was weakened.

### Narrow mutation consumer review / remaining uncertainty

| Consumer | Classification | Evidence / limits |
|---|---|---|
| POST games/:id/join | CANONICAL VISIBILITY ENFORCED | Real negative/positive matrix, paid local boundary, duplicate test |
| POST games/:id/waitlist | AFFECTED → CANONICAL VISIBILITY ENFORCED | 201 before / 404 after for unrelated invite-only resident; full matrix |
| Game creation host auto-participant | SAFE BY DIFFERENT AUTHORIZATION RULE | Authenticated creator owns newly created game; Circle organiser attachment gate unchanged |
| Game checkout initiation | CANONICAL VISIBILITY ENFORCED | Only reached after join authorization; unconfigured provider boundary tested |
| invitations/:id/respond | SAFE BY DIFFERENT AUTHORIZATION RULE (source) | Intended resident + pending/unexpired; creates invitation response, not participant |
| invitations/token/:token/respond | NEEDS RUNTIME TEST | Bound resident checked; email-only invitation has no explicit normalized email comparison. No token redemption probe or policy change here |
| Existing invitation eligibility in canViewPrivateGame | NEEDS POLICY REVIEW | Existing relationship query does not filter invitation status/expiry. Preserved canonical rule, not redesigned here |
| Stripe webhook confirmation | SAFE BY DIFFERENT AUTHORIZATION RULE (source only) | Signed provider event confirms prior pending participant; not invoked |
| Club registrations / programme enrollments | NOT APPLICABLE to game join | Different entities/authorization; no game participant creation, not expanded here |

Concurrent revocation of invitation/Circle membership while joining was not tested;
the activity row is locked, not every related entitlement row. These are explicit
follow-up uncertainties, not runtime-confirmed new vulnerabilities. Historical
unauthorized joins were not inventoried or cleaned. Stage B not signed off here.

## Closure design (before remediation)

Trace: `requireResident` → optional coupon lookup/evaluation → waitlist offer reads →
game row locked in a DB transaction → status/lifecycle/duplicate/capacity validation →
participant INSERT/reactivation → commit. Free joins then claim waitlist offers,
update threshold/favourites and analytics; priced joins call createCheckoutSession
and remove their pending participant if the provider is unavailable. No visibility
authorization exists anywhere before participant mutation. A participant subsequently
satisfies canViewPrivateGame, explaining the observed 404 → join 200 → detail 200.

Minimum proposed fix: loadViewableGame before coupons/offers/transaction; recheck
canViewGame against the locked game row before any participant mutation. Use the
canonical DETAIL/relationship policy, not public discovery. Missing/hidden is 404
`Session not found`; legitimate visibility still passes existing lifecycle/capacity
checks. Apply the same policy to waitlist before insertion. Do not change HC-QA-014.
Original regression was rerun unchanged and failed before production edits.

Severity: **P1** (access-control bypass: an uninvited resident becomes a participant and then
gets full detail, meeting instructions, roster/updates and game chat). Requires the activity
id (UUID); before HC-QA-011 was fixed, ids were enumerable anonymously.
Historical status: **OPEN — preserved failing regression.** Discovered while mapping visibility
consumers during Stage B remediation; outside the six approved findings, so not fixed here.

## Endpoint / code

`POST /api/games/:id/join` (`routes/games.ts`) checks status, effective lifecycle
(`active`), existing participation and capacity — **not** `visibility`. A joined participant
satisfies `canViewPrivateGame()`, so the join itself grants visibility.
Source-identified, same pattern, not runtime-tested: `POST /api/games/:id/waitlist`.

## Reproduction (isolated QA, free synthetic activity, no payment)

HOST_A creates an invite-only active activity. USER_B (no invitation, no Circle, not a
participant): `GET /games/:id` → 404; `POST /games/:id/join` → **200**; `GET /games/:id`
→ **200**. Evidence `hc-qa-016-join.json`. Regression `tests/integration/specs/stage-b-open.spec.ts`
→ `HC-QA-016:` (runs last in `qa:authorization`).

## Suggested direction (not implemented)

Before the join/waitlist transaction, require `canViewGame(row, resident)` (404 when denied)
so only the host, Circle members (for circle visibility) and invitees can join non-public
activities. Paid-join path must be re-verified afterwards (touches checkout, so defer to the
booking-integrity checkpoint).
