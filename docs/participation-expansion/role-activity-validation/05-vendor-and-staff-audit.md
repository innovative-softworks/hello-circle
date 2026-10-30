# 05 · Vendor (partner) and organisation staff audit

## 1. Partner workspace (`/vendor`, `PartnerWorkspace.tsx`)
**Tabs:** Overview, Calendar, Bookings, Check-in, Customers, Messages · Listings, Programmes, Experiences · Earnings, Offers, Reviews, Reports, Demand · Organisation.
**Visibility:** `vendorTabAvailable()` (`client/src/vendorTabAccess.ts`). Tabs depend on the staff role (`VENDOR_TAB_ROLES`) **and** the organisation's capabilities (`VENDOR_TAB_CAPABILITIES`), so a sports club and a community centre see different menus (as discussion 5 asks). The server enforces the same rules (`assertCapability`, role groups).

| Capability | Status | Where |
|---|---|---|
| Organisation profile, policies, staff, trader details | Verified | `routes/org.ts`, `VendorOrg.tsx` (owner-only writes) |
| Verification status | Verified | admin Verification checks; partner sees the state |
| Enabled capabilities | Verified | `useOrgCapabilities`, `GET /api/vendor/org/capabilities` |
| Events, experiences, adventures, volunteering | Verified | `vendorExperiences.ts` (`experiences` + `events` / `volunteering`) |
| Clubs, community centres, halls and rooms | Verified | `vendorListings.ts` (`clubs` / `venues`), rooms, blocks, hours |
| Programmes (sessions, register, progress) | Verified; progress server-only | `vendorPrograms.ts` (`programs`) |
| Calendar | Verified | Calendar tab |
| Booking options and capacity | Verified | registration options (`participation.options`), capacity per session or room |
| Registrations and attendees | Verified | `/vendor/orders/:source/:ref` record, attendees |
| Approved forms (builder, templates, versions, conditions) | Verified | `vendorForms.ts`, field policy (Phase F/G/H) |
| Permitted answers | Verified | listing role only; finance never |
| Check-in and attendance | Verified | `/vendor/door`, `/vendor/checkin`, programme registers |
| Staff-only team notes | Verified (server) | `order_notes`, listing role only |
| Messages | Verified | `/vendor/messages*` (communications or owner) |
| Reports and exports | Verified | `/vendor/reports/*` (counts), answers CSV (field policy) |
| Staff assignment | Verified | check-in assignments (`listing_staff_assignments`); org roles (owner) |
| Finance | Verified | Earnings, refunds (finance or owner) |
| Reviews (replies) | Verified | communications or owner |

**Capability restrictions, tested by direct API:**
- creating a centre, club, programme, experience, event or volunteering listing with the capability off returns 403 `capabilityOff` (config-capabilities batch, **re-run today: passed**; `capabilities.test.ts`);
- a vendor PUT on the admin capabilities route is refused (FINAL-SEC, re-run today: passed);
- organisation templates only pre-fill capabilities and categories. They can't enable an `unavailable` capability (donations, external payments) or a locked switch (`resolveStates`).
- **Gap found and fixed:** `POST /vendor/claims` (claim an unclaimed centre or club) checked **neither role nor capability** → RAV-SEC-01, fixed (§3).

## 2. Staff permission model, as built
| Discussion responsibility | Code | Actual scope |
|---|---|---|
| Owner | `invited_staff = 0` | everything in the organisation, for enabled capabilities |
| Organisation / listing manager | `centre_manager`, `facility_manager` | **every** listing of their type in the organisation: centres → centre_manager; clubs → facility_manager; experiences and programmes → both |
| Club manager | `facility_manager` | clubs, club sessions, registrations, waitlist |
| Venue manager | `centre_manager` | centres, rooms, hall bookings, closures |
| Activity coordinator | — (both managers) | no own role |
| Check-in staff | `checkin_staff` | `/api/vendor/door*` only, assigned listing or date |
| Finance | `finance` | orders and contacts, earnings, refunds, offers, reports |
| Read-only | `read_only_analyst` | overview, calendar, org (read), demand, reports |
| Communications | `communications` | customers, messages, reviews |

**Difference from the discussions:** they state that a manager "cannot automatically access every listing", and that staff see "another activity's participants only if assigned". **The code scopes managers by listing type across the whole organisation.** Per-listing assignment exists only for check-in (`listing_staff_assignments`). This is a deliberate Phase 2 design (doc 11 G4/X2), not a defect. Narrowing managers to assigned listings is an enhancement that needs approval (RAV-D-01).

## 3. Direct API checks (re-run today on isolated QA, or new server tests)
| Restriction | Result | Evidence |
|---|---|---|
| Check-in staff: earnings, reports, record, message preview, notes | 403 | FINAL-SEC, P2-DOOR |
| Check-in staff: any route outside `/door` | 403 `checkinOnly` | `requireVendor` allow-list |
| Finance: answers, answers CSV, team notes | `answersVisible:false` / 403 | CFG-OPERATIONS (re-run: passed), `vendorOrders.test.ts` |
| Read-only: draft, publish, team note, send, answers CSV | 403 | FINAL-SEC |
| Read-only, finance, communications, check-in: **file a listing claim** | was **201**, now **403** | `vendorClaimsRole.test.ts` (fails 3/3 on the old code, passes on the fix) |
| Revoked staff on cached routes | 403 next request | D08-STAFF, FINAL-SEC (suspended account) |
| Cross-organisation record, notes, answers, reports, messages | 403/404 | FINAL-SEC, IDOR-VENDOR, authorization suite (re-run: 83/83) |
| Unauthorised staff assignment | 403 | staff routes owner-only (`org.ts`, `invitedStaff` → 403); check-in assignments: owner + managers (`capabilities.test.ts`) |
| Mutation-route sweep | All 15 partner route files (`routes/vendor*.ts`, `routes/org.ts`) scanned for POST/PUT/DELETE without a role guard: 5 hits. 3 are door routes (guarded by `doorScope` + capability), 1 marks a notification read (own record, harmless), 1 is **claims (fixed)** | sweep script in this audit |

**Fix (RAV-SEC-01):** `server/src/routes/vendorListings.ts` `POST /claims` now applies `assertPlatformRole(centre_manager | facility_manager by type)` and `assertCapability(venues | clubs)`, the same as `POST /centres` and `/clubs`. The partner UI already showed claims only on the Listings tab (managers), so nothing visible changes for allowed users.
