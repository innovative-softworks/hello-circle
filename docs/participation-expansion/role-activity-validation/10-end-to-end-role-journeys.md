# 10 · End-to-end role journeys

**What this table shows:** each scenario is traced through the code path and given the strongest available evidence. "Today" means re-run in this audit on an isolated QA DB or in the test container. Browser specs named here belong to the guarded `qa:*` harness.

| # | Scenario | Path | Evidence | Status |
|---|---|---|---|---|
| 1 | **Resident hosts football:** create → publish → others join → list updates → attendance → My Life | `POST /api/games` (lifecycle active) → `/join` → `/participants/manage` → host check-in or no-show (from the day) → `/api/my-life` | `games.test.ts`, `gameQuestions.test.ts` (today); stage-b-attendance (authorization suite, today); host activity record in final-a11y (today); final-validation journey batches | **PASS** |
| 2 | **Circle walking group:** organiser creates a Circle-linked walk → visibility → members join → attendance → unrelated Circle can't manage | `POST /api/games` with `circleId` (organiser only) → visibility from join mode → `canViewGame` → join → host attendance | `circles.test.ts` (plan → activity), `circlePlanListings.test.ts`, `roleSeparation.test.ts` (new, today); lifecycle-circle-* specs | **PASS** |
| 3 | **Community centre event:** admin enables Events → partner creates event → publishes form → resident registers → staff check in → report reconciles | admin capabilities PUT → `POST /vendor/experiences` (kind event) → forms publish → `/api/experiences/.../book` with answers → `/vendor/door` → `/vendor/reports` | config-capabilities, config-operations, final-security (today); booking-event-attendees and journey E (final validation); DEF-04/11 fixed counts (pilot remediation) | **PASS** |
| 4 | **Sports club:** manager creates a session → residents register → answers stored → attendance | `facility_manager` → club sessions → `/api/registrations/checkout` with answers → record → club check-in | final-a11y registration (today); config-universal-forms (final validation); `vendorPiiRoles.test.ts` (today) | **PASS** |
| 5 | **Venue booking:** centre manager manages room availability → resident books → venue questions → staff see setup notes | rooms, blocks, hours (`centre_manager`) → `/api/bookings` with form answers → `/vendor/orders/booking/:ref` (answers, team notes by listing role) | config-universal-forms (final validation); `vendorOrders.test.ts` (today) | **PASS** |
| 6 | **Finance restrictions:** payment info yes; answers and team notes no | `/vendor/orders/*` as finance | config-operations (today); `vendorOrders.test.ts` | **PASS** |
| 7 | **Admin governance:** capabilities change → partner menu updates → server enforces → existing bookings remain | `PUT /admin/organisations/:id/capabilities` → `useOrgCapabilities` → `assertCapability` | config-capabilities (today); `capabilities.test.ts` (D-A3: off stops new listings only) | **PASS** |
| 8 | **Multi-context user:** resident + host + organisation staff switch without leakage | `/api/manage/link/*`, `/workspaces`, `/switch`; separate cookies; each route checks its own identity | STAGE-B-MANAGE, CLOSURE-LINK, CLOSURE-LINK-RACE (authorization suite, today); `roleSeparation.test.ts` test 18 | **PASS** with a limit: one organisation per account (D-A2, by decision) |

**Multi-context detail (section 12 of the brief):**
- **Two cookies:** the person holds two cookies. A partner route reads only `req.user`; a host or Circle route reads only `req.resident`. Nothing merges them.
- **Hosting from a partner account:** a partner account (even an owner) can't host as the organisation. Hosting is a resident action, and the activity is owned by the resident.
- **Revoked staff:** their partner access stops on the next request (D-08). Their personal (resident) side is unaffected, which is correct.
- **Logout:** clears the session of that side. The other side's cookie stays until it is logged out too (existing, documented behaviour).
- **Out of scope:** multi-organisation membership was not implemented (not approved).
