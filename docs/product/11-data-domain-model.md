# Document 11 — Data & Domain Model

36 tables found in `server/src/db/index.ts`. No real foreign keys exist anywhere — every relationship below, including every polymorphic pair, is enforced only in application code.

## The five participant-tracking tables, confirmed genuinely distinct

| Table | Distinguishing columns | Guest-capable? |
|---|---|---|
| `bookings` | `room_id, duration, event_type, guests, open_spots, min_participants, confirmation_deadline` | Yes (`client_id`) |
| `registrations` | `team, child/guardian fields, dob, emergency contact, medical, consent, trial, waiver_version, session_id, pass_id, registrant_type` | Yes (`client_id`) |
| `program_enrollments` | `program_id, participant_name, participant_dob` — no subtotal/discount/vat/fee breakdown, only `total_cents` (no coupon support) | Yes (`client_id`) |
| `game_participants` | `checked_in_at, attended`; composite unique `(game_id, resident_id)` | **No** — resident-only, no `client_id` at all |
| `circle_members` | Just `circle_id, resident_id, role, joined_at` — no status, no payment_status, no ref | No — resident-only, and unpaid |

These are not a duplication to fix — they reflect genuinely different commitment shapes (one-off paid hire vs. season-long paid signup vs. multi-session paid enrollment vs. free ad-hoc RSVP vs. free persistent membership). A real unification would be a large, deliberate migration, not a refactor (per `CLAUDE.md`, confirmed structurally correct by this audit).

## Entity groups

### Listings (centres, clubs, experiences, rooms)
- **centres** — status: pending/approved/rejected/deleted (soft-delete only, never a real `DELETE`). `capacity`/`from_price` are computed rollups over active rooms, never directly vendor-writable. `org_id` exists but is described in the schema as an unused isolation scaffold — not yet load-bearing for any query.
- **rooms** — PK is `(centre_id, id)`, so room ids are only unique per-centre. Soft-deactivate only (`active=0`); a 409 guard blocks deactivating a centre's last active room.
- **clubs** — mirrors centres' status/slug/featured pattern, plus `capacity` (nullable = unlimited) and `audience` (kids/adult).
- **experiences** — one table for both "Experience" and "Adventure," discriminated by a `kind` column. Same 4-state status as centres/clubs.
- **room_blocks** — `room_id IS NULL` blocks the whole centre; a set `room_id` blocks just that room. Hard-deleted (no soft form).
- **centre_hours** — optional per-day override of the centre's default hours.

### Participation (the five tables + sessions)
- **bookings / registrations** — dual-status pattern: `payment_status` (pending→paid/failed) kept independent of `status` (active→cancelled) specifically so cancellation logic can never race the Stripe webhook.
- **games** — status open/pending_participants/cancelled; `visibility` (public/circle/invite, unenforced — see [Doc 20](20-gap-analysis.md)); `booking_ref` links back to an Open Booking that spawned it; `circle_id` links it to a Circle's official plan.
- **game_participants** — status joined/pending_payment; `payment_status` defaults to `'paid'` (free by default, only flips to pending for priced joins).
- **programs** — status evolved via a one-time backfill from a 2-state (`active`/inactive-implicit) to a 4-state model: draft/published/paused/archived.
- **program_sessions** — status default `scheduled`, soft-cancel only. `room_id` is descriptive only — **not** wired into the paid room-booking conflict checks.
- **program_enrollments** — no cancellation status transition exists in the router (see [Doc 20](20-gap-analysis.md)).
- **experience_sessions / experience_bookings** — added later than `program_enrollments`, so it natively carries the full pricing-breakdown columns (subtotal/discount/vat/platform_fee) that the older table lacks.
- **passes** — only `payment_status` (pending→paid); no expiry/exhaustion status is ever written back, both are computed at redemption time from `expires_at` and `credits_used vs credits_total`.

### Community (circles, invites, polls)
- **circles** — status active/closed (soft-close only); `join_mode` open/approval/invite; free-text `what_we_do`/`who_can_join`/`circle_values` (display only, not enforced).
- **circle_invites** — one table serves both directions: `initiated_by` (organiser/resident) distinguishes an organiser's invite from a resident's join request, rather than using two tables.
- **circle_polls / circle_poll_options / circle_poll_votes** — multi-select voting (composite PK `poll_id, option_id, resident_id`, not single-choice); "recommended option" is computed client-side, never stored.

### Identity, org, and RBAC
- **users** (vendor/admin) — role vendor/admin; status pending/approved/suspended; `platform_role` is a free-text column, not a DB enum; `provider_tier` standard/verified/featured; `invited_staff` flag distinguishes owner from staff permanently (no "promote to owner" route found).
- **residents** — no status/role column at all (never moderated as an identity). `host_status` is a cosmetic badge only. `interests`/`availability`/`goals` are comma-joined TEXT, deliberately not JSON.
- **organisations** / **org_invites** — org-level policy/feature-flag storage plus the staff-invite token table (7-day expiry).
- **guest_login_tokens / guest_sessions** — magic-link issuance (15-min single-use token, closed against replay via a locked transaction) and the resulting 30-day session.

### Cross-cutting / polymorphic
- **Polymorphic `listing_type`/`listing_id` pattern** used by: `reviews` (centre/club/game/host/experience), `favourites` (centre/club/game/program_session/club_session/experience), `waitlist_entries`, `notifications`. `reports` uses the same idea under different column names (`target_type`/`target_id`).
- **favourites** — status interested→planning→joined, one-way upgrade only, never auto-downgraded.
- **follows** — resident-only (no guest fallback); `notification_level` default `highlights`.
- **waitlist_entries** — status waiting→offered→(claimed/expired via `offer_expires_at`); guest-capable like bookings/registrations.
- **participation_intents** — app-generated UUID PK (not auto-increment) so a resident can reference/cancel a specific intent directly; unique per `(client_id, activity_label, county)`.
- **reports** — status pending/dismissed/actioned/suspended, with `suspended` triggering a real cascade (closing a circle, hiding a review), not just a label change.

## Hard-delete vs. soft-delete, by evidence

| Category | Tables |
|---|---|
| **Soft only, never hard-deleted** | centres, clubs, experiences (status=deleted) · rooms (active=0) · programs (archived) · sessions (cancelled) · circles (closed) · games (cancelled) · bookings/registrations (status=cancelled) · reviews (hidden=1) |
| **Genuinely hard-deleted** | room_blocks · household_members · favourites · follows · search_alerts · org staff invites (on revoke) · circle_members (on remove) |
| **No delete path at all** | passes · reports · place_suggestions · uploaded files |

## Relationship sketch

```
Resident ──creates──> Circle ──has──> circle_members
Resident ──hosts──> Game ──has──> game_participants ──may reference── Circle (circles.id via games.circle_id)
Vendor(org) ──lists──> Centre ──has──> Rooms ──receive──> Bookings
Vendor(org) ──lists──> Club ──has──> club_sessions ──receive──> Registrations ──may redeem── Pass
Vendor(org) ──lists──> Program ──has──> program_sessions ──enrolled via── program_enrollments
Vendor(org) ──lists──> Experience ──has──> experience_sessions ──booked via── experience_bookings
Resident ──reviews──> {Centre|Club|Game|Host|Experience}   (polymorphic listing_type/listing_id)
Resident ──favourites/follows──> {Centre|Club|Vendor|Host}  (polymorphic)
Admin ──moderates──> {Users|Listings|Reviews|Reports|Organisations}
```

---
[← Business Rules](10-business-rules.md) · [Next: Status & State Model →](12-status-state-model.md)
