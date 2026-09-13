# Document 16 — Host & Vendor Operating Model

Host and Vendor are genuinely different actor types, not variations of the same underlying account — confirmed by tracing what each requires to act.

> **Host ≠ a lesser Vendor.** Creating a Game or Circle only requires `requireResident` — no vendor account, no organisation, no admin approval. Becoming a Vendor requires a full signup transaction, admin review, and produces a completely separate identity system (`req.user` vs. `req.resident`). A person can be both, simultaneously, as two unrelated accounts.

## Vendor onboarding

1. **Signup** — `POST /signup` — one transaction creates the `users` row, a new organisation, and a draft centre/club together
2. **Verification** — Admin-only manual approval; no automated verification of any kind
3. **Profile setup** — Org profile, logo, policies (booking window days, cancellation hours, feature flags like `open_booking`)
4. **Listings** — Centre/club/program/experience CRUD + publish, each still subject to admin moderation regardless of org approval
5. **Availability** — Rooms (capacity/rate/payment-method/active), hours, blocks; sessions for programs/experiences
6. **Bookings / leads** — Operations tab: bookings, registrations, schedule, today, waitlist queues
7. **Communication** — Vendor-side messages, gated to the `communications` platform role for sending
8. **Calendar** — Schedule/today views inside Operations
9. **Reviews** — Public on the provider profile, no vendor-reply field exists
10. **Analytics / payouts** — Insights tab: demand signals, payments, CSV export — gated to `finance` (full) or `read_only_analyst` (read)
11. **Team access** — Owner invites staff with one of 5 scoped platform roles

## Team / RBAC — full current gate inventory

| Sub-router | Gated actions | Required role(s) |
|---|---|---|
| vendorListings.ts | Centre CRUD/publish/rooms/blocks/hours | `centre_manager` |
| vendorListings.ts | Club CRUD/publish | `facility_manager` |
| vendorOperations.ts | Cancel a booking | `centre_manager` |
| vendorOperations.ts | Send a message | `communications` |
| vendorOperations.ts | Check-in | `centre_manager` (booking) / `facility_manager` (registration) |
| vendorExperiences.ts | Experience CRUD/sessions | `centre_manager` OR `facility_manager` (role-group constant — the one sub-router using a group instead of a single role, a style inconsistency, not a bug) |
| vendorPrograms.ts | Program CRUD/sessions/attendance | Resolved post-lookup by the program's `listing_type` |
| vendorInsights.ts | CSV export, demand | `finance` OR `read_only_analyst` |
| vendorInsights.ts | Payments | `finance` only |
| clubSessions.ts | All writes | `facility_manager` |

Every `GET` in these same sub-routers (stats, listings, bookings, registrations, notifications, schedule, today, waitlist, messages, participants, insights) is reachable by **any** org member once past `requireVendor`+`attachVendorIds` — including a `read_only_analyst` reading full booking/registration/notification lists org-wide. Flagged as a real, undecided business rule in [Doc 20](20-gap-analysis.md).

## Rooms — the independently-bookable unit inside a Centre

A centre can hold any number of named rooms, each with its own capacity/rate/payment-method/active flag. `centres.capacity`/`.from_price` are computed rollups (max/min over active rooms), never directly vendor-editable. A room is never hard-deleted — only deactivated — and a row-locked guard refuses to deactivate a centre's last active room (409), keeping every centre permanently bookable. Per-room opening hours don't exist yet: every room shares the centre's single window (or a `centre_hours` override).

---
[← Circle & Community Model](15-circle-community-model.md) · [Next: Messaging & Notifications →](17-messaging-notifications.md)
