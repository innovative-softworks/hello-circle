# 01 · Existing role inventory (from source)

**Date:** 2026-10-30. **Branch:** `feature/participation-phase2` @ `2f279ad` plus the uncommitted pilot-remediation tree, plus this audit's one fix (`vendorListings.ts` claims gate).
**Method:** every identifier is copied from code. The 16 functional responsibilities in the product discussions are mapped onto what actually exists. No new role was created.

Status key: **Real role** = a persisted value that changes what the server allows. **Ownership** = a relationship on a record, not a role. **Mapped** = no own identifier; served by an existing role. **Conceptual** = not in the code.

## 1. The four identities (no shared table)
| Identity | Set by | Persisted as | Notes |
|---|---|---|---|
| Visitor / guest device | `clientIdFrom()` (`server/src/util.ts`) | `client_id` on each order row | owns guest bookings, can report content |
| Resident | `attachResident` (`server/src/residents.ts`), magic link or Google | `residents` row; `req.resident` | every resident can host free activities and create Circles |
| Partner or admin account | `attachUser` (`server/src/auth.ts`) | `users.role` = `vendor` \| `admin` | password session `hello_circle_session` |
| Verified e-mail | `attachGuestEmail` | `guest_sessions` | used where only "is this e-mail verified" matters |

**The bridge:** `users.resident_id` + `/api/manage/*` (`routes/manage.ts`) let one person hold a partner and a resident session at once. Linking is confirmed by e-mail. The switch mints the other cookie and is audit-logged.

## 2. Responsibility → code mapping
| Responsibility (discussions) | Code identifier | Kind | Workspace | Status |
|---|---|---|---|---|
| Visitor / Guest | none (`X-Client-Id`) | identity | public site | Real |
| Resident / Participant | `req.resident` | identity | Explore, My Life, Circles | Real |
| Resident Host | `games.host_resident_id` = resident | **ownership** | Host workspace `/manage` | Real (ownership, not a role) |
| Verified Host | `residents.host_status = 'verified'` | badge + gate | Host workspace | Real; only gates **paid** activities (`mayHostPaid`) and host opportunities |
| Circle Member | `circle_members.role = 'member'` | Circle role | Circle page | Real |
| Circle Organiser | `circle_members.role = 'organiser'` (several allowed: promote) | Circle role | Circle page, Host → Circles | Real |
| Circle Moderator | none. Organisers can mute members (`muted_until`) | — | — | **Conceptual** (mapped to organiser) |
| Organisation Owner | `users.role='vendor'` and `invited_staff = 0` | real | Partner workspace `/vendor` | Real: unrestricted inside the organisation (`hasPlatformRole`) |
| Organisation / Listing Manager | `centre_manager`, `facility_manager` | real (`users.platform_role`) | Partner | Real, **organisation-wide per listing type** (see 05 §2) |
| Club Manager | `facility_manager` | mapped | Partner | Real (label "Facility manager") |
| Venue / Centre Manager | `centre_manager` | mapped | Partner | Real |
| Event / Activity Coordinator | `EXPERIENCE_ROLES` = centre_manager, facility_manager | mapped | Partner | **Mapped**, no own role |
| Check-in Staff | `checkin_staff` + `listing_staff_assignments` | real + assignment | `/vendor/door` only | Real |
| Finance Staff | `finance` | real | Partner (Bookings, Customers, Earnings, Offers, Reports) | Real |
| Read-only Staff | `read_only_analyst` | real | Partner (Overview, Calendar, Org, Demand, Reports) | Real |
| Communications (exists, not in discussions) | `communications` | real | Partner (Customers, Messages, Reviews) | Real |
| "Operations" / "Admin staff" (org) | none | — | — | **Conceptual**; covered by the manager roles |
| Platform Admin | `users.role='admin'` | real | Admin `/admin` | Real |
| Platform Super Admin | `users.admin_role='super'` | real | Admin | Real |
| Platform Support Admin | `users.admin_role='support'` | real | Admin | Real |
| Finance Admin, Legal Admin (exist, not in discussions) | `admin_role` = `finance` \| `legal` | real | Admin | Real |

**Role lists in code:**
- `PLATFORM_ROLES` (`packages/types/src/index.ts:2722`, `routes/org.ts:15`) = `centre_manager, facility_manager, finance, communications, read_only_analyst, checkin_staff`.
- `ADMIN_ROLES` = `super, finance, support, legal` (`auth.ts`); permissions in `ADMIN_PERMISSIONS` (`adminPermissions.ts`, deny-by-default).
- Circle roles = `organiser | member` (`routes/circleHelpers.ts`).

## 3. Enforcement points
| Guard | File | Rule |
|---|---|---|
| `requireResident` | `residents.ts:314` | 401 without a resident session |
| `requireVendor` | `auth.ts:305` | vendor + approved; removed staff 403; suspended organisation 403; **`checkin_staff` limited to `/api/vendor/door*`** |
| `hasPlatformRole` / `requirePlatformRole` / `assertPlatformRole` | `auth.ts:383-410` | admin and owner pass; invited staff only for the listed roles |
| `attachVendorIds` → `req.vendorIds` | `auth.ts` | "own listing" = `vendor_id` ∈ organisation's user ids |
| `assertCapability(req,res,key)` | `capabilities.ts:200` | organisation capability on (admin-controlled; opt-out flags), platform switch on, dependencies on |
| `assertOrgMayAssign` | `categoryPolicy.ts:101` | organisation category eligibility (Phase E), the only vendor category write path is `PUT /api/vendor/classification/:type/:id` |
| `doorScope` | `participation/checkin.ts` | check-in only on assigned listing or date; roster roles organisation-wide |
| `requireAdmin` + `requireAdminPermission` | `auth.ts`, `adminPermissions.ts` | MFA, then one declared permission per route (test walks every admin route) |
| Host checks | `routes/games.ts` (23 handlers) | `games.host_resident_id === req.resident.id`, no co-host, no Circle-organiser override |
| Circle checks | `isOrganiser` / `isMember` (`circleHelpers.ts`) | per Circle id |
| `canViewGame` / `loadViewableGame` | `routes/games.ts` | visibility (public / circle / invite, draft) for every read, join, quote, ics, updates |

## 4. Classification of each capability
See [02](02-role-permission-matrix.md) for the per-action matrix. Summary:

| Classification | Count | Examples |
|---|---|---|
| Implemented and verified (unit and/or browser) | most | host activity CRUD, joins, approvals, waitlist, check-in; partner listings, forms, records, messages, reports; admin capabilities, categories, field policy, governance |
| Implemented, not browser-tested | 3 | programme progress, team notes (server tests only); Circle organiser mute |
| Partially implemented | 2 | listing-level staff scoping (check-in only); the activity-category taxonomy (gaps, see 07) |
| Missing | 3 | co-host, Circle moderator role, activity archive state |
| Disabled by configuration | 6 | `participation.host_questions`, `participation.reminders` (off); `partial_cancel`, `special_category_questions` (locked); Make It Happen paused; donations and external payments (`status: unavailable`) |
| Intentionally deferred | 3 | multi-organisation membership (D-A2), partner forms on games (owner decision, Phase H), mobile device testing |
| Not applicable | 1 | partner "join activities" as an organisation (people join as residents) |
