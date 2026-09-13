# Document 09 — User Stories & Acceptance Criteria

Generated from existing functionality, grouped by module.

## Circles

**US-001** As a resident, I want to join an open Circle instantly, so that I don't wait on approval for a low-stakes group.
> Given a circle with `join_mode='open'`, when I tap Join, then I become a member immediately with no organiser action required.

**US-002** As a circle organiser, I want to approve who joins, so that I control group composition.
> Given `join_mode='approval'`, when a resident requests to join, then I receive a notification and can accept or decline before membership is created.

## Games

**US-003** As a resident, I want to host a game without a business account, so that organizing a casual match has zero setup cost.
> Given I am a verified resident, when I create a game, then it publishes without any admin or vendor approval step.

**US-004** As a resident, I want to join a waitlist when a game is full, so that I get a spot if someone drops out.
> Given a game at capacity, when I request the waitlist, then I'm queued and auto-promoted (with a time-limited offer) if a participant leaves.

## Bookings

**US-005** As a guest, I want to book a room without creating an account, so that a one-off hire doesn't require signup.
> Given no session, when I complete checkout, then the booking is owned by my anonymous client id and I can look it up later by email.

**US-006** As a guest, I want to cancel my booking before a cutoff, so that plans that change don't cost me the full fee.
> Given my booking is outside the org's cancellation-hours window, when I cancel, then status flips to cancelled; **refund itself is not automated and happens off-platform**.

## Programs & Passes

**US-007** As a resident, I want to enroll a child in a multi-week program in one step, so that I don't sign up separately per session.
> Given the program has capacity, when I enroll, then one `program_enrollments` row covers every session.

**US-008** As a resident with a club pass, I want registration to draw from my remaining credits, so that I don't pay again each week.
> Given I hold an unexpired pass with credits remaining for this club, when I register, then one credit is consumed and the registration is free.

## Vendor workspace

**US-009** As a vendor owner, I want to invite staff with scoped roles, so that my finance person can't edit listings.
> Given I invite someone as `finance`, when they accept, then they can view payments/reports but cannot create or edit centres/clubs.

**US-010** As a centre manager, I want a guaranteed bookable room at all times, so that the centre never accidentally goes unbookable.
> Given a centre has exactly one active room, when I try to deactivate it, then the request is rejected with 409.

## Admin

**US-011** As an admin, I want a single queue of pending vendors and listings, so that moderation doesn't require checking multiple screens.
> Given a new vendor signs up, when I open the admin console, then their account and draft listing appear together in the pending queue.

---
[← Use Case Library](08-use-case-library.md) · [Next: Business Rules →](10-business-rules.md)
