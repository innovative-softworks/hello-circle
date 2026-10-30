# 02 · Role and activity permission matrix (as built)

Built from the route guards, not from the discussions. Legend:
- **✓** allowed within ownership and scope;
- **◐** conditional (the condition is named);
- **—** refused by the server;
- **n/a** the concept doesn't exist for this role.

**Roles:**
- **V** visitor (no session);
- **R** resident;
- **H** resident host (owner of the activity);
- **CO** Circle organiser;
- **Own** organisation owner;
- **Mgr** `centre_manager` / `facility_manager`;
- **Fin** `finance`;
- **Com** `communications`;
- **RO** `read_only_analyst`;
- **Chk** `checkin_staff`;
- **Adm** admin (permission named).

## 1. Role matrix
| Role | Code identifier | Workspace | Resource scope | Permitted | Prohibited (server-enforced) | API enforcement | UI enforcement | Status |
|---|---|---|---|---|---|---|---|---|
| Visitor | `client_id` | public | public, approved, active listings | browse, search, map, details, guest booking where the listing allows it, report content | save, join activities, Circles, My Life | `requireResident` 401; `canViewGame` hides drafts and private items | sign-in prompts | Verified |
| Resident | `req.resident` | Explore, My Life, Circles | own orders (`resident_id` / `client_id` / verified e-mail) | save, join, request, waitlist, register, book, answer, edit permitted answers, cancel within policy, review after attendance, create activities and Circles | other residents' orders and answers (404) | `orderRecords.ts` ownership; `canViewGame` | resident nav | Verified (FINAL-SEC, IDOR-BOOKING) |
| Resident host | `games.host_resident_id` | `/manage` | own activities and series | create, edit, publish, draft, move, cancel, series, approvals, waitlist offers, check-in, no-show (◐ switch), updates, chat, questions (◐ switch), refunds of paid joins, coupons | other hosts' activities (403); partner forms (404 for `game`); organisation data (no `req.user`) | `host_resident_id === req.resident.id` on 23 handlers | Host workspace | Verified (FINAL-SEC, IDOR-HOST, `gameQuestions.test.ts`) |
| Verified host | `residents.host_status='verified'` | `/manage` | as host | **paid** activities, host opportunities | — | `mayHostPaid` | badge, Earnings | Verified |
| Circle member | `circle_members.role='member'` | Circle page | own Circles | view members-only content and activities, join, propose an activity link (`shareToCircleId`, waits for an organiser) | manage the Circle; manage activities they don't host | `isMember` | Circle page | Verified (Circles suites) |
| Circle organiser | `circle_members.role='organiser'` | Circle page, Host → Circles | own Circles | settings, invites, approvals, remove, mute, promote, plans → activity (`circleId`/`planId`), approve links, close | other Circles (403); activities hosted by other members (host-only) | `isOrganiser(circleId, …)` | organiser controls | Verified |
| Organisation owner | `role='vendor'`, `invited_staff=0` | `/vendor` | every listing whose `vendor_id` ∈ organisation | everything in the partner workspace for enabled capabilities, staff invite/role/remove | other organisations (403/404); enabling capabilities; category or field policy | `requireVendor`, `attachVendorIds`, `assertCapability` | `vendorTabAvailable` | Verified |
| Manager | `centre_manager` / `facility_manager` | `/vendor` | **every** organisation listing of the matching type (centres ↔ centre_manager; clubs ↔ facility_manager; experiences and programmes ↔ both) | create, edit, publish, sessions, rosters, answers, team notes, forms, check-in, assign check-in staff, reports | staff management (owner-only); messages (communications); finance actions | `requirePlatformRole` / `assertPlatformRole` | tabs by role | Verified; **not** limited to assigned listings (see 05 §2) |
| Finance | `finance` | `/vendor` | organisation orders | orders and bookings (contact details), customers, earnings, refunds, offers, reports (counts) | answers (`answersVisible:false`, CSV 403), team notes (403), listing edits | role groups `ORDER_ROLES` etc. | tabs by role | Verified (CFG-OPERATIONS, `vendorOrders.test.ts`) |
| Communications | `communications` | `/vendor` | organisation audiences | customers, messages (send, preview, test), reviews (reply) | answers, listings, finance | `CUSTOMER_ROLES`, messages guard | tabs by role | Verified (`vendorMessages.test.ts`) |
| Read-only | `read_only_analyst` | `/vendor` | organisation | overview, calendar, organisation profile (read), demand, reports | every mutation tested (draft, publish, team note, send, answers CSV, **claim** after this audit's fix) | role gates | tabs by role | Verified (FINAL-SEC, `vendorClaimsRole.test.ts`) |
| Check-in staff | `checkin_staff` | `/vendor/door` | assigned listing or date (`listing_staff_assignments`) | door list, lookup, check in, undo | **everything outside `/api/vendor/door*`** | `requireVendor` allow-list + `doorScope` | only the Check-in tab | Verified (P2-DOOR, FINAL-SEC) |
| Admin (any) | `role='admin'` | `/admin` | platform | permissions per `ADMIN_PERMISSIONS` | partner routes (needs `role=vendor`); registration answers and medical notes (no admin route reads them) | `requireAdmin` + `requireAdminPermission` | `useAdminCan()` | Verified (D02-MATRIX) |
| Super | `admin_role='super'` | `/admin` | all | capabilities, categories, field policy, settings, suspensions, admins | — (still can't read answers) | as above | as above | Verified |
| Support | `admin_role='support'` | `/admin` | support | partners and listings approve or moderate, queues, orders cancel, activities moderate, payment state read | settings, capabilities, taxonomy changes, finance operate | as above | as above | Verified |

## 2. Activity permission matrix (resident activities = `games`)
| Action | Allowed | Ownership / scope | Capability or switch | API endpoint | Test coverage |
|---|---|---|---|---|---|
| Browse, search, filter, map | V, R | public + active + visible | — | `GET /api/games`, discover routes | games suites, browser |
| View details | V, R | `canViewGame` (public, circle members, invitees, host) | — | `GET /api/games/:id` | HC-QA-010 |
| Save | R | own | — | `POST /api/favourites` (`game`) | `favourites.test.ts` |
| Report content | V, R | client id | rate limit | `POST /api/reports` | `reports.test.ts` |
| Join | R | visible, open, capacity | paid → Stripe | `POST /api/games/:id/join` | games, booking-* |
| Request approval | R | `join_mode='approval'` | — | join → `game_join_requests` | `gameJoinApproval` |
| Waitlist | R | full activity | — | `POST/DELETE /:id/waitlist` | games |
| Answer questions | R | at join | ◐ `participation.host_questions` (off) | join body `answers` | `gameQuestions.test.ts` |
| Cancel participation | R | own | refund policy | `DELETE /:id/join` | games |
| View booking | R | own | — | `GET /status/:ref`, My Life | orderRecords |
| View attendance | R | own | — | My Life | myLife |
| Review | R | attended, after end | — | reviews routes | trust suites |
| Create, save draft, publish | R (any resident) | becomes host | paid → verified host | `POST /api/games` (`lifecycle` draft/coming_soon/active) | games |
| Edit | H | own | — | `PUT /:id` | IDOR-HOST |
| Duplicate | H | own (client prefill) | — | client `HostActivitiesTab` "Duplicate" | client |
| Recurring | H | own | — | `POST /series`, cancel remaining | OG-26 |
| Cancel | H | own | refunds | `POST /:id/cancel` | games |
| Archive | n/a | no archive state; completed or cancelled drop off | — | — | — |
| Set category, location, capacity, skill, equipment, min age, visibility, joining rule | H | own | category: `categoryFromBody("game")` | create / `PUT /:id` / `booking-settings` | games, categories |
| Configure questions | H | own; at most 3, library only | ◐ switch off | `PUT /:id/questions` | `gameQuestions.test.ts` |
| Configure partner form | — | games refused | owner decision (Phase H) | `/api/vendor/forms/game/*` → 404 | `gameQuestions.test.ts` |
| Link to Circle | CO (official, `circleId`/`planId`); member (◐ proposes, organiser approves) | Circle membership | `circles.*` switches | create body; `POST /api/circles/:id/links` | circlePlanListings |
| Co-host | — | not built | — | — | — |
| Assign staff | n/a for hosts | — | — | — | — |
| View participants (full) | H | own | — | `GET /:id/participants/manage` | FINAL-SEC |
| View participants (preview) | V, R | visible activity; names only, at most 8 | — | `GET /:id/participants` | HC-QA-010 |
| Approve joining | H | own | — | `POST /:id/join-requests/:rid/:decision` | gameJoinApproval |
| Manage waitlist | H | own | — | `GET /:id/waitlist`, `/offer` | games |
| Check in | H (per person), R (self) | own / joined | — | `/participants/:rid/check-in`, `/:id/check-in` | stage-b-attendance |
| Mark no-show | H | own; **from the activity day** (fixed in this audit, RAV-DEF-01) | not switch-gated: live since Phase N (only the questions are behind `participation.host_questions`) | `/participants/:rid/no-show` | gameQuestions |
| Send instructions / notify | H | own | — | `POST /:id/updates`, chat, `meeting_instructions` (host and joined only) | games |
| Export | — | hosts have no export | — | — | — |
| Reports | H (own insights) | own | — | `GET /host/insights` | host suites |
| Moderate | Adm `activities.moderate` | platform | — | admin activities | OG-14 |

## 3. Organisation listing matrix
| Action | Own | Mgr | Fin | Com | RO | Chk | Adm | Capability | Endpoint (examples) |
|---|---|---|---|---|---|---|---|---|---|
| Create centre / club | ✓ | ✓ (type) | — | — | — | — | ◐ edit only (`listings.edit`) | `venues` / `clubs` | `POST /vendor/centres`, `/clubs` |
| Claim unclaimed listing | ✓ | ✓ (type) | — | — | — | — | decides (`queues.decide`) | `venues` / `clubs` | `POST /vendor/claims` (**fixed**) |
| Create experience / adventure / event / volunteering | ✓ | ✓ | — | — | — | — | ◐ | `experiences` (+ `events` / `volunteering`) | `POST /vendor/experiences` |
| Create programme | ✓ | ✓ (type) | — | — | — | — | ◐ | `programs` | `POST /vendor/programs` |
| Category | ✓ | ✓ | — | — | — | — | `taxonomy.manage` | org eligibility | `PUT /vendor/classification/:type/:id` |
| Forms (draft, publish) | ✓ | ✓ (listing's role) | — | — | — | — | policy only (Settings → Registration fields) | `registration_questions` | `/vendor/forms/:type/:id/*` |
| View answers / answers CSV | ✓ | ✓ (listing's role) | — | — | — | door-visible only | — | — | `/vendor/orders/...`, forms answers |
| Team notes | ✓ | ✓ | — | — | — | — | — | — | `/vendor/orders/:source/:ref/notes` |
| Check in | ✓ | ✓ | — | — | — | ✓ assigned | — | `checkin` | `/vendor/door/*`, `/vendor/checkin/*` |
| Assign check-in staff | ✓ | ✓ | — | — | — | — | — | `checkin` | `/vendor/attendees/...assignments` |
| Messages | ✓ | — | — | ✓ | — | — | governance (audit) | — | `/vendor/messages*` |
| Reports | ✓ | ✓ | ✓ | — | ✓ | — | — | — | `/vendor/reports/*` (counts) |
| Finance (earnings, refunds) | ✓ | — | ✓ | — | — | — | `finance.operate` | — | `/vendor/earnings`, refunds |
| Staff management | ✓ | — | — | — | — | — | `partners.platform_role` | — | `/vendor/org/staff*` |
| Enable capability | — | — | — | — | — | — | Super (`orgs.manage`) | — | `PUT /admin/organisations/:id/capabilities` |
| Category eligibility | — | — | — | — | — | — | Super | — | admin organisations |
| Field policy | — | — | — | — | — | — | Super (`platform.settings`) | — | admin settings |
| Governance / audit | — | — | — | — | — | — | `audit.view` | — | `/admin/governance`, audit |
