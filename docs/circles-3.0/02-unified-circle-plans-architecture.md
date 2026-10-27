# Circles 3.0 — 02 Unified Circle Plans architecture

## Decision: extend `circle_plans`, don't add a second plan model

`circle_plans` already is a Circle Plan: proposer, title, note, proposed date/time, meeting place, lifecycle
(`idea → confirmed → activity_created`, plus `cancelled`; `completed` derived), interest ("I'm in",
`circle_plan_interest`), target size, expiry, organiser confirm/decline with a reason, audit, notifications, admin
removal. Circles 3.0 adds one thing: **a validated reference to the listing the plan is about.**

```
circle_plans
  + listing_type        VARCHAR(20)  NULL   game | experience | program | centre | club
  + listing_id          VARCHAR(191) NULL
  + listing_session_id  VARCHAR(191) NULL   experience departure or programme session
  + INDEX idx_circle_plans_listing (circle_id, listing_type, listing_id)
```

Added through `ensureColumn`/`ensureIndex` in `initSchema()` (additive, idempotent, no data rewritten, no
foreign keys — the project convention). Rollback: the columns are nullable and ignored by older code; dropping
them loses only the references.

## What each listing type maps to

| Brief type | `listing_type` | Session | Booking stays with |
|---|---|---|---|
| Activities and games | `game` | — | the activity page (join / waitlist / paid checkout) |
| Adventures | `experience` (kind `adventure`) | optional departure | the adventure page |
| Experiences | `experience` (kind `experience`) | optional departure | the experience page |
| Volunteering | `experience` (kind `volunteer`) | optional slot | the volunteering page |
| Programmes / sessions | `program` | optional session | programme-level enrolment (the note says so) |
| Places | `centre` / `club` | — | nothing is booked; venue link only once venue pages are public |
| Events | *(no type)* | — | Events are dated activities/experiences (`/explore?when=weekend`); no event model exists — decision E1 |
| Circle-created gathering | `NULL` (free text) | — | becomes the Circle's own activity through the existing conversion |

## Rules (server, `circlePlanListings.ts` + `routes/circles.ts`)

- **Resolved live, per viewer.** `resolvePlanListing()` reads the listing through the same filters its public page
  uses: `approved`/`published`, `orgActiveSql` (suspended organisations), `canViewGame` (private activities,
  drafts). A listing the viewer can't see reads `unavailable` with no title/details.
- **Suggesting:** member of an active Circle; the proposer must be able to see the listing; finished or cancelled
  listings refused; a private activity only in its own Circle; one open plan per (Circle, listing, session) — checked
  under a row lock on the Circle so two simultaneous suggestions make one plan; the duplicate returns `409` with the
  existing `planId`.
- **Plan ≠ booking.** Interest is "I'm in"; *booked* is read from the booking tables (`game_participants` seats,
  `experience_bookings`/`program_enrollments` paid, `waitlist_entries`). Nothing reserves capacity.
- **No second listing.** A plan about an activity/experience/programme can't be converted into a new activity
  (`409`); a free-text or venue plan still can, through the unchanged `createGameRow` transaction.
- **Live state** on every read: `available | full | past | cancelled | unavailable`, places left (informational —
  the listing page is the authority), the viewer's own `booked | waitlisted`.

## Participation states shown

Interested (I'm in) · Booked (from the booking tables) · Waitlisted (activities) · Full · Cancelled by the provider ·
No longer available. "Invited", "Attended" stay where they already live (invitations, attendance).

## Not built (later phases)

Multi-Circle shared plans for listings (Circle-to-Circle exists for activities only), recurring plans, plan
reminders, My Life "plans I'm in" list (see 03).
