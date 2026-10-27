# Circles 3.1 — 01 Audit (create, link, organise from a Circle)

Date: 2026-10-28 · Builds on Circles 3.0 (`docs/circles-3.0/`, built the day before, uncommitted). Read-only audit of
the current tree before any 3.1 change. "Verified" = exercised by a test or browser run; otherwise code read.

## Per listing type

| Type | Can be created? | Route (client) | API | Creator role | Linked to a Circle today | Approval | Booking |
|---|---|---|---|---|---|---|---|
| Activity / game | Yes | `/games/host` | `POST /api/games` | Any signed-in resident; paid needs a verified host (unless switched off) | `games.circle_id` — **the Circle's own activity**, set only by a Circle organiser (server refuses others, `games.ts`); Circle-to-Circle via `partner_circle_id`; Circle plans (3.0) | None (lifecycle: draft / coming soon / open) | Join, waitlist, paid checkout (`games.ts`) |
| Adventure / Experience / Volunteering | Yes (partner) | `/vendor/experiences/new` (guided flow; `kind` chosen in the form) | `POST /api/vendor/experiences`, publish `POST …/:id/publish` → `pending` | Vendor org member with `centre_manager` or `facility_manager` | `experiences.circle_id` — **official Circle**, only a Circle organised by someone in the vendor's org (`vendorParticipation.ts linkableCircles`), set after creation in the participation editor; Circle plans (3.0) | Admin approves (`pending → approved`) | Experience booking (`bookExperienceSession`, Stripe / cash) |
| Event | **No event type** — "Events this weekend" is `/explore?when=weekend` | — | — | — | Treated as dated activities/experiences (owner decision 3.0-E1) | — | — |
| Programme | Yes (partner) | `/vendor/programs/new` | `POST /api/vendor/programs`; sessions `POST /api/vendor/programs/:id/sessions` | Vendor org with programmes enabled; centre/facility manager | `programs.circle_id` official Circle (same rule); Circle plans (programme or session) | Partner publishes (`status`) | Programme-level enrolment |
| Programme session | Inside its programme | — | as above | as above | Via the programme; plans can name a session | — | Enrolment is programme-level |
| Place / venue | Partner only (`/vendor/centres|clubs`); residents can suggest a missing place (`/suggest-place`, `POST /api/place-suggestions`, admin-reviewed) | — | — | Venue manager / admin | `clubs.circle_id` official; Circle plans (venue, no link while gated) | Admin | Room booking (gated pages) |
| Circle plan | Yes | Circle page "Suggest" / Plans | `POST /api/circles/:id/plan-ideas` | Member | n/a | Organiser confirms | Never a booking (3.0) |
| Poll | Yes | Circle Polls tab | `POST /api/circles/:id/polls` | Member (create), organiser (close) | n/a | — | — |

## What exists for "bring something into a Circle"

- **Plan together** — Circles 3.0 listing plans (`circle_plans.listing_*`), from the Circle and from listing pages.
- **Share with Circle** — `POST /api/circles/:id/share`: notifies members only; **nothing stored, nothing shown on the Circle**
  (optional "also add to plans" since 3.0).
- **Official Circle** — vendor-owned listings name one Circle their org organises (1 Circle per listing).
- **No** persistent "linked to this Circle" record that isn't a plan; **no** approval of member suggestions other than plans;
  **no** single "Create or organise" entry on the Circle page (actions are spread: Quick actions card, Plans, Polls tab,
  Manage).

## Gaps (verified by reading the code)

| ID | Gap | Action |
|---|---|---|
| G1 | No "linked listing" relationship distinct from a plan | **Build** `circle_listing_links` (one table, all types) |
| G2 | Member suggestions of a listing have no organiser approval | **Build** pending → approved on links |
| G3 | No "Create or organise" entry on the Circle page | **Build** one dialog, actions filtered by permission |
| G4 | Creating a partner listing from a Circle doesn't carry the Circle | **Extend** vendor create pages: `?circleId=` → official Circle on first save (existing rule: org-organised Circles only) |
| G5 | A member (not organiser) creating an activity for the Circle | **Extend** `POST /api/games` with `shareToCircleId` → a pending link (organiser keeps the official `circle_id` path) |
| G6 | Linked listings not shown on the Circle, not filterable, no remove | **Build** Linked section with type filter, approve / decline / remove |
| G7 | Admin can't see or remove a Circle's links | **Extend** admin Circle record |
| G8 | Listing pages: Share vs Plan choice | **Extend** "Plan with my Circle" dialog with "Share with the Circle" |

Reused unchanged: membership/roles, plans, polls, invitations, notifications, live listing resolution
(`circlePlanListings.ts`), visibility filters (`canViewGame`, `orgActiveSql`, publish states), booking flows.
