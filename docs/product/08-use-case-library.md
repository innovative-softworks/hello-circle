# Document 08 — Use Case Library

Formal use cases for the platform's core actions.

## UC-001 — Join a Circle
- **Actor:** Resident
- **Goal:** Become a member of a persistent activity group
- **Preconditions:** Signed in; circle `status='active'`; not already a member
- **Trigger:** Taps Join on Circle detail
- **Main flow:** 1. System checks `join_mode`. 2. If open, inserts membership. 3. Circle appears in MyLife.
- **Alt flow:** Approval mode files a join request; invite mode requires a pre-existing organiser invite
- **Failure flow:** Invite-mode self-join with no pending invite → 403
- **Postconditions:** `circle_members` row exists (or a pending `circle_invites` row)
- **Related APIs:** `POST /circles/:id/join`

## UC-002 — Book a Room
- **Actor:** Visitor or Resident
- **Goal:** Reserve a specific room for a date/time
- **Preconditions:** Centre approved, room active, slot within opening hours and booking window
- **Trigger:** Submits the booking wizard's final step
- **Main flow:** 1. Row-lock room. 2. Validate overlap/blocks/hours/window. 3. Compute price server-side. 4. Create pending booking. 5. Stripe Checkout or instant cash confirm. 6. Webhook flips to paid. 7. Notify vendor+admin+guest.
- **Alt flow:** Cash-payment room skips Stripe entirely
- **Failure flow:** Slot conflict/block/hours/window violation → 409 before any charge attempt; Stripe failure → `payment_status='failed'`, no notification to guest confirmed
- **Postconditions:** `bookings` row, ICS available, appears in vendor Operations queue
- **Business rules:** 23% VAT + 5% platform fee computed server-side; never trust a client-supplied total

## UC-003 — Host a Game
- **Actor:** Resident (any — no vendor account needed)
- **Goal:** Create an ad-hoc activity session for others to join
- **Main flow:** 1. Fill activity/location/date/capacity/price. 2. Optionally set `min_participants`. 3. Publish (starts `open`, or `pending_participants` if a threshold is set).
- **Business rules:** Capacity can't shrink below current joined count on edit; price frozen once anyone but host has joined
- **Related APIs:** `POST /games`, `PUT /games/:id`
- **Known gap:** `visibility` field is stored but not enforced on join — see [Doc 20](20-gap-analysis.md)

## UC-004 — Cancel a Booking (guest)
- **Actor:** Visitor (via `X-Client-Id` or matched email) or Resident
- **Preconditions:** `payment_status='paid'`; outside the org's `cancellationHours` cutoff
- **Main flow:** 1. `POST /bookings/:ref/cancel`. 2. `status='cancelled'` set. 3. Vendor+admin+guest notified.
- **Failure flow:** Inside cutoff → 409 "contact venue directly"
- **Postconditions:** Booking flagged cancelled; **refund is explicitly off-platform** — no Stripe refund call exists anywhere in this codebase

## UC-005 — Purchase and redeem a Pass
- **Actor:** Resident
- **Scope:** Club registrations only
- **Main flow:** 1. Buy a credit bundle via Stripe. 2. At a later registration, choose "use pass." 3. Row-locked check: ownership + club match + not expired + credits remain. 4. Credit consumed, zero-cost `paid` registration inserted.
- **Failure flow:** Registration later cancelled → credit is **not** restored (confirmed gap)

## UC-006 — Enroll in a Program
- **Actor:** Visitor or Resident
- **Main flow:** 1. Row-locked program-level capacity check. 2. Checkout or instant free confirm. 3. Enrollment inserted `status='confirmed'`.
- **Failure flow:** Resident wants to cancel later → **no route exists** — must be handled off-platform (support contact), a critical gap; see [Doc 20](20-gap-analysis.md).

## UC-007 — Approve a pending vendor
- **Actor:** Admin
- **Preconditions:** Vendor's `users.status='pending'`
- **Main flow:** 1. Admin reviews pending vendor + draft listing in console. 2. `PUT /vendors/:id/status` → approved. 3. Vendor can now log in and publish.
- **Related APIs:** `server/src/routes/admin.ts`

## UC-008 — Invite & onboard vendor staff
- **Actor:** Vendor org owner
- **Main flow:** 1. Owner invites by email + one of 5 platform roles. 2. Invitee accepts via tokenized link. 3. New staff `users` row auto-approved, scoped to that role for writes.
- **Business rules:** Invite bypasses admin review entirely; owner invite = the vetting step

## UC-009 — Respond to a Circle join request
- **Actor:** Circle organiser
- **Preconditions:** A pending `circle_invites` row exists, `initiated_by='resident'`
- **Main flow:** 1. Organiser accepts/declines via `POST /:id/join-requests/:id/respond`. 2. Requester notified. 3. Accept creates the `circle_members` row.

## UC-010 — Make It Happen (min-participation)
- **Actor:** Resident
- **Goal:** Signal intent for an activity that only happens if enough people commit
- **Main flow:** 1. Resident captures intent (activity + county). 2. `participation_intents` row created (unique per person/activity/county). 3. Matches surface via demand-intent notify. 4. Threshold met → activity confirmed (mechanism shares logic with Games' `min_participants`).

---
[← Detailed User Flows](07-user-flows.md) · [Next: User Stories →](09-user-stories.md)
