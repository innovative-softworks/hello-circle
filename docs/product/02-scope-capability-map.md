# Document 02 — Product Scope & Capability Map

Every scope area the original brief asked about, populated only where the implementation actually answers it.

| Scope area | Target users | Existing capabilities | Status |
|---|---|---|---|
| Consumer experience | Visitor, resident | Home feed, Explore (ranked+personalized), Browse (plain sort), onboarding, MyLife hub | **Implemented** |
| Community / Circle experience | Resident | Create/join (open/approval/invite), organiser tools, polls, chat, member removal | **Implemented** |
| Activities & Experiences | Resident, vendor | Experiences/Adventures (one table, `kind` discriminator), session-based checkout | **Implemented** |
| Events | — | No persisted "event" entity exists anywhere in the schema. Closest analogues are Games (ad-hoc) and Program Sessions (scheduled) — "Event" is a UI/marketing word, not a data concept. | **Not a real entity** |
| Venue / facility booking | Visitor, resident, vendor | Per-room booking, row-locked availability, reschedule, Open Booking spin-off into a Game | **Implemented** |
| Vendor marketplace | Vendor, admin | Signup+listing intake, approval workflow, org/staff RBAC, provider tiers | **Implemented** |
| Host / organiser experience | Resident | Game hosting (create/edit/cancel/manage participants/post updates), Circle organising — no vendor account required | **Implemented** |
| MyLife / personal experience | Resident | Aggregates all 5 participation tables + intents + follows + favourites into one hub, sectioned Upcoming/Ongoing/Past | **Implemented** (UI-layer unification only — see [Doc 11](11-data-domain-model.md)) |
| Social / community layer | Resident | Circles, follows (subscribe to a vendor/host/centre's updates), favourites (bookmark + status upgrade) | **Implemented** |
| Communication | Resident | Scoped chat (game/circle only), polling-based, time-windowed for games | **Implemented** (no DM, no vendor↔guest chat) |
| Notifications | All identity types | In-app + email (vendor/admin/guest fan-out) + push (resident, native only) | **Implemented** (opt-out only for 2 of 9 kinds) |
| Search & Discovery | Visitor, resident | Real weighted ranking (recency, fill-rate, personalization, follow-boost), category/date/county filters | **Implemented** |
| Profiles | Resident, vendor, host | Resident account/household/preferences, public host profile, public provider profile | **Implemented** |
| Reviews / reputation | Resident | 5 listing types, participation-gated eligibility enforced server-side, admin hide-only moderation | **Implemented** (no vendor reply, no editing) |
| Payments / transactions | Resident, guest, vendor | Shared Stripe Checkout service, server-computed VAT/fee/coupons, webhook-confirmed state | **Implemented** (no refund automation anywhere — see [Doc 20](20-gap-analysis.md)) |
| Administration | Admin | Single 84KB console: moderation, approvals, RBAC, orgs, coupons, analytics, audit log | **Implemented** |
| Moderation & trust | Admin, resident (reporter) | Reports queue with auto-cascade actions, review hiding, vendor suspension, host-status badges | **Implemented** |
| Platform / system capabilities | — | Single-origin deploy, in-memory rate limiting (resets on restart), no CI, thin test coverage | **Functional, ops gaps** |

---
[← Product Overview](01-product-overview.md) · [Next: Users, Roles & Permissions →](03-users-roles-permissions.md)
