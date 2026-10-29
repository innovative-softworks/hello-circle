# 11 · Phase 2 step 1: existing roles and permissions, audited from source

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2`, from Phase 1 (`cc2def1`). Local only.

Every identifier below is copied from code. Nothing here is a new role name made up for this brief.

## 1. Identity systems (unchanged; none share a table)
| Identity | Where it's set | Exact identifiers | Used for |
|---|---|---|---|
| Partner / admin account | `auth.ts` `attachUser` (cookie `hello_circle_session`) | `users.role` = `vendor` \| `admin`; `users.status` = `pending` \| `approved` \| … | partner workspace, admin |
| Admin sub-role | `users.admin_role` | `ADMIN_ROLES = ["super","finance","support","legal"]` (`auth.ts:58`) | `ADMIN_PERMISSIONS` table (`adminPermissions.ts`) |
| Organisation member role | `users.platform_role`, `users.invited_staff`, `users.org_id` | `centre_manager`, `facility_manager`, `finance`, `communications`, `read_only_analyst` (`routes/org.ts:14`, `routes/admin.ts:1183`, `packages/types` `PLATFORM_ROLES`) | `hasPlatformRole` / `requirePlatformRole` / `assertPlatformRole` (`auth.ts:369-393`) |
| Resident | `residents.ts` `attachResident` (magic link / Google) | `req.resident.id`; `residents.host_status` = `verified` for hosts | My Life, games, Circles |
| Guest device | `X-Client-Id` → `clientIdFrom()` (`util.ts`) | `client_id` on each order row | a guest's own bookings |
| Circle roles | `circle_members.role` | `organiser` \| `member` (`circleHelpers.ts` `isOrganiser`, `isMember`) | Circle management |
| Game host | `games.host_resident_id` | compared with `req.resident.id` in `routes/games.ts` | host check-in (`HostCheckInScreen`) |

## 2. Partner enforcement points
| Guard | Source | Rule |
|---|---|---|
| `requireVendor` | `auth.ts:295` | 401 unless `role = vendor`; 403 unless `approved`; 403 `removedFromOrg` for removed staff (`invitedStaff && !orgId`, D-08); 403 `orgSuspended` for every partner API except `GET /api/vendor/obligations` (D-01) |
| `attachVendorIds` → `req.vendorIds` | `auth.ts:345-356` | all user ids in the caller's organisation; "your listing" = `listing.vendor_id ∈ req.vendorIds` |
| `hasPlatformRole(user, …roles)` | `auth.ts:369` | admin → true; owner (`!invitedStaff`) → true; invited staff → only when `platform_role ∈ roles` |
| Ownership of an experience | `vendorExperiences.ts:104` `ownsExperience(vendorIds, id)` | `experiences.vendor_id ∈ req.vendorIds` |
| Sale paths | `orgStatus.ts` `offeringSellable` + `assertSellable(tx, vendorId)` | suspended organisation can't sell |
| Owner-only staff management | `routes/org.ts:146-310` | `invitedStaff` → 403; `rowVersion` 409 |

**Role groups in use** (`routes/vendorHelpers.ts:14-19`, `vendorExperiences.ts:38`):
- `ORDER_ROLES` = centre_manager, facility_manager, finance
- `ROSTER_ROLES` = centre_manager, facility_manager
- `CUSTOMER_ROLES` = ORDER_ROLES + communications
- `EXPERIENCE_ROLES` = centre_manager, facility_manager

## 3. Experience and event routes today (the Phase 2 surface)
| Route | Guard | Notes |
|---|---|---|
| `POST/PUT/DELETE /api/vendor/experiences…`, sessions, move, cancel | `EXPERIENCE_ROLES` + `ownsExperience` | |
| `POST /api/vendor/experiences/:id/bookings/:bookingId/refund` | `finance` | |
| `GET /api/vendor/experiences/:id/bookings` (roster) | `ROSTER_ROLES` | returns email, phone, **total_cents**, seat names, lines |
| `POST /api/vendor/experiences/:id/bookings/:ref/attendance` | `EXPERIENCE_ROLES` | **booking-level** `attendance` row (`kind='experience'`, `ref` UNIQUE); paid + not cancelled + session started |
| `GET/PUT /api/vendor/experiences/:id/options` | GET: any member; PUT: `EXPERIENCE_ROLES` | Phase 1 |
| `POST/GET /api/vendor/checkin/:kind/:ref` | centre_manager (bookings) / facility_manager (registrations) | halls and clubs only |
| `GET /api/experiences/bookings/mine`, `/status/:ref`, `/:ref/cancel`, `/:ref/ics` | `client_id` OR `resident_id` (status and ics: `client_id` only) | resident ownership |

**Admin** reaches no partner route (`requireVendor` needs `role = vendor`). Admin order actions go through `orders.cancel` / `finance.*` permissions.

## 4. Existing attendance, check-in and audit
- **`attendance`** (`db/index.ts:820`, +`status` and `source` columns): one row **per booking ref**. `status` = `present` \| `no_show` (`HOST_ATTENDANCE_STATUSES`); `source` = `host_manual` \| `qr` \| `correction`. It feeds reviews eligibility, `attendance_confirmed` events, the review flag on a no-show and attendance corrections (`routes/attendanceCorrections.ts`, `ROLE_FOR_KIND`).
- **Seat names:** `experience_booking_participants (booking_ref, seat, name)`.
- **QR:** passes show the booking ref as a QR code (`client/src/components/pass/Pass.tsx`). `ScanPassModal` + `readPassCode` (`EX-…` = experience). Experience scanning lives in the roster panel (`VendorExperiences.tsx` `onScan`), which marks the **whole booking** present, client-side, only for today's departures.
- **Audit:** `writeAudit()` (`audit.ts`) → `audit_log`.

## 5. Gaps against the Phase 2 brief
| # | Gap | Evidence |
|---|---|---|
| G1 | No per-person attendee records: only seat names; no adult/child type and no guardian link | §4 |
| G2 | Attendance is per booking, so a partial group arrival can't be recorded | `attendance.ref` UNIQUE |
| G3 | **No least-privilege door role.** Every role that can check in (`EXPERIENCE_ROLES`) can also edit listings, cancel bookings and see the roster's email, phone and amounts. `read_only_analyst` can't check in at all | §2, §3 |
| G4 | No assignment to a listing or date. Staff access is organisation-wide | no table in schema |
| G5 | Many partner read routes are ungated by role (`vendorTabAccess.ts` header comment), so a new low-privilege role would inherit them | `vendorTabAccess.ts:10-12` |
| G6 | No configurable registration questions | — |
| G7 | Experience QR check-in is checked only in the browser; the server has no lookup that refuses another listing's booking with a reason | `VendorExperiences.tsx` `onScan` |
| G8 | The status route checks `client_id` only, so a signed-in resident on a new device can't open their booking details | `experiences.ts` `/bookings/status/:ref` |

## 6. Smallest extensions (proposed and built in Phase 2)
| # | Extension | Why it's the smallest |
|---|---|---|
| X1 | **One more value in the existing organisation role list: `checkin_staff`** ("Check-in only"). Invited staff only, so not a global role. `hasPlatformRole` already denies every existing gate to it. `requireVendor` gives it an **allow-list**: only `/api/vendor/door/*`. That closes G5 for this role without touching other routes | G3 needs a role with less than any existing role; a scoped grant on top of `centre_manager` would still expose money |
| X2 | **`listing_staff_assignments`**: an organisation member is assigned to one listing, or to one date of it, for check-in. Owners and `EXPERIENCE_ROLES` manage it. Removing a row, removing the member (D-08) or suspending the organisation (D-01) stops access on the next request | G4. Reuses `req.vendorIds`, `requireVendor`, the D-01/D-08 checks and `writeAudit` |
| X3 | **Capability rule for the new APIs, reusing the existing role groups:** attendee list with contacts and answers = `ROSTER_ROLES`; question set edit = `EXPERIENCE_ROLES`; attendance summary counts = `ROSTER_ROLES` + `read_only_analyst`; check-in = owner and `ROSTER_ROLES` for every listing in the organisation, `checkin_staff` only where assigned. Finance and communications get nothing new | no new permission store; each route declares its group like today |
| X4 | **Door payload carries no money or contact data**: names, person type, guardian, door-visible answers and an admit verdict only | brief §7.4 |
| X5 | **Switches** in the existing `participation` group: `participation.attendees` (attendee details and questions in the booking journey), `participation.checkin` (door mode). Both default off. `participation.special_category_questions` is **locked**, like `partial_cancel` | reuses `circleFeatures.ts` |

**Not proposed:** a new admin permission, a new identity, a separate check-in app, or a change to hall/club check-in.
