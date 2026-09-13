# Document 07 — Detailed User Flows

Trigger → entry → action → response → decision → next → completion, for the flows with real branching logic worth tracing in full.

## Join a Circle

- **Trigger:** Resident taps "Join" on a Circle detail page
- **Decision — authenticated?**
  - NO → routed to magic-link/password sign-in → returns to the Circle page
- **Decision — join_mode:**
  - **open** → `INSERT IGNORE circle_members` → done instantly
  - **approval** → `circle_invites` row created (`initiated_by='resident'`, status `pending`) → organiser notified → organiser responds (accept/decline) → requester notified
  - **invite** → self-join attempt refused (403) unless an organiser-sent invite already exists for this resident, which always succeeds regardless of join_mode when accepted
- **Completion:** Circle appears in MyLife → Circles; member sees plans, polls, chat

## Join a Game (capacity + waitlist branch)

- **Trigger:** Resident taps "Join" on a Game
- **System response:** Opens a row-locked (`SELECT…FOR UPDATE`) transaction on the game row
- **Decision — capacity:**
  - Room available → free/cash game inserts `game_participants(status='joined')` directly; priced game inserts `status='pending_payment'` and starts Stripe Checkout, flips to `joined` on webhook confirmation
  - Full → 409 → offers a waitlist join (`waitlist_entries`) instead
- **Decision — min_participants set?**
  - Game was created `pending_participants` → each paid join re-checks the threshold (`checkMinParticipantsThreshold`) → once met, game flips to `open`
- **Completion:** Game appears in MyLife → Games; host and other participants unaffected unless a waitlist promotion occurs on later churn

## Book a Room

- **Trigger:** Guest/resident submits the booking form
- **System response:** Row-locks the specific room; checks (1) time-slot overlap against non-failed/non-cancelled bookings, (2) room/whole-centre blocks, (3) opening-hours window, (4) org `bookingWindowDays`
- **Decision — any check fails:**
  - → 409 with the specific reason (slot taken / blocked / outside hours / too far ahead)
- **Decision — payment method:**
  - Cash-payment room → `payment_status='paid'` immediately, no Stripe
  - Online → Stripe Checkout session created; webhook confirms on `checkout.session.completed` (sync) or `async_payment_succeeded` (delayed methods)
- **Notification:** Vendor + all admins + guest — in-app (vendor/admin) + email (all three)
- **Completion:** Booking appears in MyLife/vendor Operations queue; ICS calendar file available

## Vendor signup → approval

- **Trigger:** Prospective vendor submits `/vendor/signup` form
- **System response:** One DB transaction: new `users` row (`status='pending'`) + new organisation + draft centre/club row
- **Decision — auto-login?**
  - NO — deliberately no session cookie set on signup; vendor must log in after approval
- **Admin review:** Appears in Admin console's pending vendors/listings queue
- **Decision — approve/reject:**
  - Approve → `status='approved'`, vendor can now log in and publish
  - Reject → status stays non-approved, no notification-of-rejection path was confirmed in this audit
- **Completion:** Vendor logs in, publishes their draft listing

## Staff invite → accept

- **Trigger:** Org owner submits `POST /staff/invite` with an email + one of 5 platform roles
- **System response:** `org_invites` row created, 7-day token, emailed to the invitee
- **Invitee opens link:** `GET /invites/:token` — public, unauthenticated preview available before accepting
- **Decision — accept:**
  - Accept → new `users` row created directly `status:'approved'`, `invited_staff:true` — **skips admin review entirely**, the owner's invite is the vetting step
- **Completion:** Staff member logs in, scoped to their assigned `platform_role` for writes (reads are unscoped — see [Doc 20](20-gap-analysis.md))

---
[← User Journeys](06-user-journeys.md) · [Next: Use Case Library →](08-use-case-library.md)
