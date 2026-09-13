# Document 04 — Module & Feature Catalogue

Structural features get the full evidence template. High-volume/simpler features are listed densely in the summary table at the end, to keep this document readable rather than repeating the same 20 fields sixty times.

## FEATURE — Room Booking

- **Module:** Venue / Facility Booking
- **Primary user:** Visitor (guest) or Resident
- **Entry point:** `/book/:centreId`, in-page room selection first step
- **Preconditions:** Centre approved & open, ≥1 active room
- **Main actions:** Pick room → date/time → guests → checkout (Stripe or cash)
- **Business rules:** Whole-hour slot grid; overlap check against existing non-failed/non-cancelled bookings; room/whole-centre blocks; opening-hours window; org `bookingWindowDays` cap
- **Validation:** Row-locked (`SELECT…FOR UPDATE`) on the room during checkout — prevents a double-book race
- **Statuses:** `payment_status`: pending→paid/failed · `status`: (active)→cancelled
- **Data created:** `bookings` row; Stripe Checkout session if paid online
- **Notifications:** Vendor + all admins + guest, in-app (vendor/admin) + email (all three)
- **Error conditions:** 409 slot taken, 409 outside hours/blocked, 503 if Stripe unset
- **Related APIs:** `POST /bookings/checkout`, `GET /bookings/status/:ref`, `POST /bookings/:ref/cancel`, `POST /bookings/:ref/reschedule`
- **Status:** **Implemented** — one of the most fully-built flows in the codebase (real locking, real reschedule, real feature-flagged Open Booking spin-off)

## FEATURE — Circle Join (open / approval / invite)

- **Module:** Community / Circle
- **Primary user:** Resident
- **Entry point:** Circle detail page, "Join" action
- **Preconditions:** Circle `status='active'`; resident not already a member
- **Main actions:** `open`: instant `INSERT IGNORE circle_members`. `approval`: files a `circle_invites` row, notifies organiser, organiser responds. `invite`: self-join refused (403) unless an organiser-sent invite already exists
- **Business rules:** Exactly one organiser per circle, fixed at creation, never transferable
- **Statuses:** Membership has no status column — a row exists or it doesn't. Invite: pending→accepted/declined
- **Notifications:** Organiser notified on join request; requester notified on response
- **Related APIs:** `POST /:id/join`, `DELETE /:id/join`, `POST /:id/join-requests/:id/respond`, `POST /:id/invite`
- **Status:** **Implemented**

## FEATURE — Game Join with capacity + waitlist

- **Module:** Activities / Games
- **Primary user:** Resident
- **Preconditions:** Game `status='open'`, not already joined
- **Main actions:** Row-locked (`FOR UPDATE`) capacity check against joined+pending_payment+reserved-offer count; free/cash joins instantly; priced joins go through Stripe
- **Business rules:** Full → 409, real waitlist with time-limited offers, auto-promotion on a participant leaving or being removed
- **Statuses:** Participant: joined / pending_payment; game: open → pending_participants → open/cancelled
- **Data updated:** `game_participants` row; `waitlist_entries` promotion on churn
- **Known gap:** `visibility` (public/circle/invite) is stored but **not enforced** by this join path — see [Doc 20](20-gap-analysis.md)
- **Related APIs:** `POST /games/:id/join`, `DELETE /games/:id/join`, `POST /:id/waitlist`
- **Status:** **Partially implemented** — core flow solid, visibility gate missing

## FEATURE — Pass purchase & redemption

- **Module:** Payments / Clubs
- **Primary user:** Resident
- **Scope:** Club registrations only — not centres, games, or programs
- **Main actions:** Purchase a credit bundle (Stripe checkout) → later redeem one credit per registration in the same transaction as the registration insert
- **Business rules:** Row-locked validation: ownership + club match + not expired + credits remaining; mutually exclusive with coupon/trial paths
- **Statuses:** `payment_status`: pending→paid only — no expired/exhausted status is ever written back, computed at redemption time instead
- **Known gap:** Cancelling a pass-funded registration does **not** restore the spent credit
- **Related APIs:** `GET /passes/me`, `POST /passes/checkout`, redemption lives inside `registrations.ts`
- **Status:** **Partially implemented** — no tiered pricing, no credit restoration on cancel

## FEATURE — Program Enrollment

- **Module:** Activities / Programs
- **Primary user:** Visitor (guest) or Resident
- **Main actions:** One enrollment covers every session of a multi-week program; program-level capacity checked (row-locked), not per-session
- **Statuses:** Enrollment inserted directly as `status='confirmed'`; `payment_status`: pending→paid
- **Critical gap:** **No cancellation route exists anywhere in `programs.ts`** — a resident cannot self-cancel a paid enrollment through any API found. See [Doc 20](20-gap-analysis.md).
- **Related APIs:** `GET /programs`, `POST /:id/enroll`, `GET /enrollments/mine`
- **Status:** **Partially implemented**

## Remaining features (summary form)

| Feature | Module | Primary user | Entry point | Status |
|---|---|---|---|---|
| Club registration + waitlist | Clubs | Guest/Resident | `/register/:clubId` | Implemented |
| Experience / Adventure booking | Experiences | Guest/Resident | `/experiences/:id`, `/adventures/:id` | Implemented |
| Open Booking → spun-off Game | Bookings | Resident (signed-in only) | Booking flow "open spots" step | Implemented, feature-flagged per org |
| Make-It-Happen (min-participation) | Participation Intent | Resident | `/make-it-happen` | Implemented |
| Reviews (5 listing types) | Reputation | Resident/Guest | Listing detail pages | Implemented |
| Favourites (bookmark, status upgrade) | Social | Resident | Listing cards | Implemented |
| Follows (subscribe to updates) | Social | Resident | Provider/host profile | Implemented |
| Household members | Profile | Resident | `/profile` | Implemented |
| Chat (scoped, polling) | Communication | Resident | Game/Circle detail | Implemented |
| Push notifications | Notifications | Resident (native) | Background | Implemented (mobile only) |
| Place suggestion | Discovery | Resident | `/suggest-place` | Implemented |
| Ask HelloCircle | Discovery | Visitor | `/ask` | Unconfirmed backend — calls a real API, but what powers `/ask`'s responses wasn't traced in this pass |
| Local-SEO landing pages | Discovery / Growth | Visitor | `/:county/:activity` | Implemented |
| Vendor org + staff RBAC | Vendor workspace | Vendor owner | `/vendor` → Org tab | Implemented |
| Vendor insights / CSV export | Vendor workspace | Vendor (finance/analyst) | `/vendor` → Insights tab | Implemented |
| Coupons | Payments | Admin | Admin console | Implemented |
| Audit log | Admin | Admin | Admin console | Implemented |
| Feature flags (notification templates, org flags) | Platform | Admin | Admin console | Implemented |

---
[← Users, Roles & Permissions](03-users-roles-permissions.md) · [Next: IA & Screen Inventory →](05-ia-screen-inventory.md)
