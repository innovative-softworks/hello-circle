# Document 03 — Users, Actors, Roles & Permissions

Four identity systems, populated independently, that never share a table — verified against `auth.ts`, `residents.ts`, `guestAuth.ts`, and every `requirePlatformRole` call site in `server/src/routes`.

## Identity systems (not roles — separate mechanisms)

| Mechanism | Actor | Notes |
|---|---|---|
| `req.user` | Vendor / Admin | Password + bcrypt, cookie session. `users.role` ∈ {vendor, admin}. Populated by `attachUser`, which never rejects — only guard middleware (`requireVendor`/`requireAdmin`) actually blocks. |
| `req.resident` | Resident (member) | Magic-link email verify → find-or-create in `residents`. No `role` column at all — a pure identity. Optional password can be added later without changing the identity. |
| `req.guestEmail` | Verified email only | Set before the resident lookup runs; some routes read this directly when they only need "is this email verified," not a full profile. |
| `X-Client-Id` header | Anonymous | Client-generated, `localStorage`-persisted, zero auth. Still the *primary* ownership key for a guest booking/registration — "My bookings" works purely off this for someone who never signs in. |

A person who registers a child as a pure guest and later signs in via magic link with the same email does **not** get that booking automatically linked — confirmed by design, not a bug (`routes/auth.ts`'s `/signup` and the guest flow never cross-reference each other).

## Actors found (verified, not assumed)

| Actor | Backed by | Distinguishing mechanic |
|---|---|---|
| Visitor | No identity, or `X-Client-Id` only | Can browse, book, and register as a guest without ever creating an account |
| Resident | `residents` row, magic-link or password | The identity behind favourites, follows, Circles, Games, Passes, household, receipts |
| Circle organiser | `circle_members.role='organiser'` | Not a global role — one fixed organiser per circle, set at creation, never transferable via any route found |
| Game host | `games.host_resident_id` | Same pattern — a foreign-key relationship, not a persisted role |
| Host (badge) | `residents.host_status` ∈ {none, pending, verified, rejected} | Cosmetic trust badge only — explicitly never used as an authorization gate anywhere found |
| Vendor — org owner | `users.role='vendor'`, `invited_staff=0` | Unrestricted within their org — every `requirePlatformRole` check passes automatically for an owner |
| Vendor — invited staff | `users.role='vendor'`, `invited_staff=1`, `platform_role` set | Narrowed to one of 5 `platform_role` values for *write* actions only (see gap below) |
| Admin | `users.role='admin'` | Single flat role — no sub-tiers; every admin can do everything in `admin.ts` |

## Role-capability matrix

| Capability | Visitor | Resident | Circle organiser | Vendor (owner) | Vendor (invited staff) | Admin |
|---|---|---|---|---|---|---|
| Browse / search | ✔ | ✔ (+personalized) | ✔ | ✔ | ✔ | ✔ |
| Book a room / register for a club | ✔ (as guest) | ✔ | ✔ | — | — | — |
| Create a Circle / Game | — | ✔ | ✔ | ✔ (as a resident too) | ✔ (as a resident too) | — |
| Manage own Circle's members/polls | — | — | ✔ | — | — | — |
| Create/edit centre or club listing | — | — | — | ✔ | only if `centre_manager`/`facility_manager` | ✔ (override) |
| View org-wide bookings/registrations (read) | — | — | — | ✔ | ✔ — **any** role, unscoped (gap) | ✔ |
| Cancel a booking on the vendor side | — | — | — | ✔ | only `centre_manager` | ✔ |
| View financial reports / payouts CSV | — | — | — | ✔ | only `finance` (read-only: `read_only_analyst`) | ✔ |
| Invite staff to org | — | — | — | ✔ (owner only) | — | — |
| Approve a pending vendor | — | — | — | — | — | ✔ |
| Assign platform_role / provider_tier | — | — | — | — | — | ✔ |
| Hide a review / suspend a vendor | — | — | — | — | — | ✔ |
| Reassign a listing's organisation | — | — | — | — | — | ✔ |

> **Real permission gap, not a guess:** writes are role-scoped per `platform_role`, but **reads are not** — an invited `read_only_analyst` or `communications` staffer can `GET` the full org-wide booking, registration, and notification lists, identical to an owner. Whether that's intended ("read_only_analyst should see everything, read-only") or a gap depends on product intent the code doesn't state — flagged as **Business rule not defined** in [Document 10](10-business-rules.md) and [Document 20](20-gap-analysis.md).

## Role transitions — actual mechanics

1. **Resident → Vendor**: NOT a transition of an existing account. `POST /signup` creates a brand-new `users` row, its own organisation, and a draft centre/club — all in one DB transaction, status `pending`. A resident with the same email gets no automatic link.
2. **Pending vendor → Approved**: Admin-only: `PUT /vendors/:id/status` in `admin.ts`. No self-serve or automatic approval path exists.
3. **Vendor owner → invites staff**: `POST /staff/invite` (owner-only) creates an `org_invites` row, 7-day token, emailed. *Alt: invitee follows `/accept-invite?token=` → new `users` row created directly `status:'approved'`, `invited_staff:true` — **skips admin review entirely**, the owner's invite is treated as the vetting step.*
4. **Resident → Host (Circle/Game creator)**: No approval, no vendor account — `circlesRouter.post("/")` and `gamesRouter.post("/")` only require `requireResident`. Materially lower friction than becoming a Vendor, and not a subset of it.

## Client-only vs. server-enforced — spot check

Every write path inspected (org, vendor listings/programs/experiences, admin) re-validates ownership/role server-side independent of client state. Two historical gaps were found already **fixed**, evidenced by inline comments in `vendorOperations.ts`'s check-in routes describing the prior missing ownership/role check. No currently-live "UI hides the button, server has no check" case was found in the areas this audit covered.

---
[← Scope & Capability Map](02-scope-capability-map.md) · [Next: Module & Feature Catalogue →](04-module-feature-catalogue.md)
