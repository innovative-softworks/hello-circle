# Server authorization inventory — Phase 4

## Recovery validation and local sign-off (current, 2026-10-01)

Current unfiltered authorization/remediation: **83 PASS**. Current complete security
gate HC-QA-002..021: **39 PASS**. Authentication/security: **20 PASS**. Verified fresh
isolated database, unchanged guards and assertions; no development/production access.
The missing-configuration blocker is cleared; see QA_ENVIRONMENT_RECOVERY.md.

Ledger: TOTAL 25; TESTED 22; PASS 22; FAIL 0; BLOCKED 0; NOT APPLICABLE 1;
EXTERNAL PENDING 2. These are work groups, not an exhaustive endpoint percentage.
B22–B25 and prior groups now have current full-suite execution. **Stage B is
SECURITY-COMPLETE LOCALLY**, with external integrations and deployment still pending.
No lifecycle/booking/Stripe phase was started. QA_REPORT.md records cleanup limits.

## Final review-gap closure (historical blocked checkpoint, 2026-10-01)

| Group | Risk | Status | Runtime evidence |
|---|---|---|---|
| B22 Activity invitations | HIGH | PASS | CLOSURE-INV-STATE/BIND/CREATE/CONSUME; HC017/018/019/021 fixed locally |
| B23 Non-Circle chat | HIGH | PASS | CLOSURE-CHAT: game/experience/programme/club read/write/report isolation and DB invariants |
| B24 Account-link confirmation | HIGH | PASS | CLOSURE-LINK and race/stale replacement; HC020 fixed locally |
| B25 Post-revocation authorization | HIGH | PASS | CLOSURE-REVOKE: invitation/Circle relationship removal, same-session subsequent denials |

Cumulative work-group ledger: TOTAL 25; TESTED 22; PASS 22; FAIL 0; BLOCKED 0;
NOT APPLICABLE 1; EXTERNAL PENDING 2. This combines previously verified groups with
the four new groups; it is NOT a fresh full-suite execution or endpoint percentage.
Final validation itself is BLOCKED: missing private QA configuration prevents the
remaining authentication and complete authorization rerun. Current security gate
39 PASS. Prior full authorization 75 PASS; eight new closure cases PASS separately.
Do not claim 83 current full-suite passes. Stage B sign-off remains withheld.
See QA_REPORT.md and QA_STAGE_B_FINAL_CLOSURE.md for the recovery blocker.

## HC-QA-016 closure (historical, 2026-09-29)

B21 join/waitlist visibility: **PASS — FIXED LOCALLY, NOT DEPLOYED**. Original join
regression unchanged. Waitlist 201 before / 404 after for unrelated invite-only user.
Public/invitee/Circle-member positive controls, unrelated/former-member/draft/scheduled
denials, DB invariants, local paid boundary and duplicate join tested. Canonical
visibility helper unchanged; HC-QA-014 product policy unchanged.

Ledger (same 21 work groups, not endpoint completeness): TOTAL 21; TESTED 18;
PASS 18; FAIL 0; BLOCKED 0; NOT APPLICABLE 1; EXTERNAL PENDING 2.
This does not sign off Stage B: remaining sub-boundaries include non-Circle chat,
account-link recheck and activity invitation email-token/status policy review.
See HC-QA-016 report for narrow mutation-consumer source classifications.

## Historical Stage B remediation — before HC-QA-016 closure

All fixes FIXED LOCALLY — NOT DEPLOYED. Isolated QA only. Canonical policy:
`QA_ACTIVITY_VISIBILITY_POLICY.md` (detail rule `canViewGame`, discovery rule
`discoverableGameSql`, both in `server/src/gameVisibility.ts`).

**Ledger update (supersedes Phase 6B FAIL rows): TOTAL 21; TESTED 18; PASS 17; FAIL 1;
BLOCKED 0; NOT APPLICABLE 1; EXTERNAL PENDING 2.** B06–B10 and B20 now PASS; new B21 FAIL.

| Gap | Previous | Now | Evidence |
|---|---|---|---|
| B06 host children | FAIL HC-QA-010 | PASS | HC-QA-010, VIS-010-TRANSITION |
| B07 Circle | FAIL HC-QA-013/014 | PASS (014 = Model A, documented) | HC-QA-013/014, VIS-013-POLL, VIS-014-015 |
| B08 host profile | FAIL HC-QA-012 | PASS | HC-QA-012, VIS-012-SCHEDULED |
| B09 Circle summaries/upcoming | FAIL HC-QA-011 | PASS | HC-QA-011, VIS-011-CIRCLE, VIS-COUNTS |
| B10 scheduled discovery | FAIL HC-QA-012 | PASS | HC-QA-012, VIS-012-SCHEDULED |
| B20 club schedule | FAIL HC-QA-015 | PASS | HC-QA-015, VIS-014-015 |
| B21 join vs invite-only visibility (new) | — | **FAIL — HC-QA-016 P1 OPEN** | stage-b-open: HC-QA-016 |

Source candidates: `db/queries.ts` `listScheduledActivities` (was 1240/1248) AFFECTED → fixed;
`getLocalMomentum` AFFECTED (public counts) → fixed; `getSupplyOverview`/`getLiquidityScores`/
participation stats SAFE (admin-only); `nextSteps.ts` `nextGame` AFFECTED → fixed; Circle
recent-activity and `/activity` counts AFFECTED → fixed; `sharing.ts` `getShareData` AFFECTED
(future publish_at) → fixed; favourites/follow feed SAFE (already `canViewGame`).

Aggregate counts: disclosure demonstrated with the predicate temporarily removed (private label
appeared in public momentum; `plansThisMonth`/`plansCreated` 0→3 from three protected
activities; source restored byte-identical). With the fix: unchanged by protected activities,
+1 for a public control. Folded into HC-QA-011/012 (same root cause), no new ID.

Chat (source review only, NOT runtime PASS): all five scopes share `resolve()` (401 no
session / 404 unknown scope / 403 not allowed) proven for Circle, but membership predicates
differ materially — game: host or joined participant (affected by HC-QA-016); experience
session / programme / club: paid, non-cancelled booking/enrollment/registration by resident
id or verified email, or owning vendor organisation. Runtime coverage remains work.

Account link (follow-up candidate, not a finding): `POST /manage/link/confirm` does not
re-check an existing link; impact not demonstrated; needs focused review.


## Phase 6B — Stage B completion (2026-09-29, CURRENT; supersedes the Phase 6 ledger below)

Resumed only the previously BLOCKED / EXTERNAL groups. Local isolated QA (REAL API +
disposable MySQL), synthetic data, no Stripe/provider/network, no deployment. Every
denial asserts scoped DB invariants. Nested endpoints were tested as correct parent+
child, own parent+foreign child, foreign parent+own child, foreign parent+foreign
child, nonexistent parent and nonexistent child wherever the route has that shape.

**Ledger: TOTAL 20; TESTED 17; PASS 11; FAIL 6; BLOCKED 0; NOT APPLICABLE 1;
EXTERNAL PENDING 2.** (B01–B17 carried over; B18–B20 split out during execution.)
Group counts, not endpoint or test counts. No whole-platform percentage.

| Gap | Risk | Boundary | Status | Evidence (spec: test) |
|---|---|---|---|---|
| B01 | CRITICAL | Admin mutations × guest/user/host/vendor/read-only staff/manager; admin positive; admin has no resident/vendor power | **PASS** | stage-b-admin: STAGE-B-ADMIN (15 ops × 6 roles, all 401, rows unchanged) |
| B02 | CRITICAL | Staff/manager org boundaries, cross-org invite management, owner/manager mass assignment, role gating | **PASS** | stage-b-org: STAGE-B-ORG; stage-b-vendor: STAGE-B-VENDOR-OPS; stage-b-refund |
| B03 | HIGH | Cross-vendor club/experience CRUD, club sessions, experience sessions/bookings/attendance, waitlist | **PASS** | STAGE-B-EXPERIENCES, STAGE-B-CLUBS |
| B04 | HIGH | Programme/session attendance read association | **PASS** (HC-QA-008 fixed locally) | ATTENDANCE-READ, STAGE-B-CHILD |
| B05 | HIGH | Attendance/enrollment writes, session↔room assignment, blocks, refund authorization | **PASS** (positive refund split to B18) | ATTENDANCE-WRITE (HC-QA-009), STAGE-B-ROOM-ASSIGNMENT, STAGE-B-REFUND |
| B06 | HIGH | Host cancel/update/capacity/pricing/lifecycle/roster/waitlist/coupons/refund; private reads | **FAIL** — HC-QA-010 (child reads); mutations/private detail PASS | STAGE-B-HOST-MUTATIONS, STAGE-B-HOST-PRIVATE; HC-QA-010 |
| B07 | HIGH | Circle roles, membership, management, chat, plan/poll/invitation children | **FAIL** — HC-QA-013, HC-QA-014; all other operations PASS | STAGE-B-CIRCLE-ROLES, STAGE-B-CIRCLE-CHILDREN; HC-QA-013/014 |
| B08 | HIGH | Host-profile aggregation vs canonical | **FAIL** — HC-QA-012 (draft/scheduled); private + Circle transitions PASS | STAGE-B-AGG-HOST-PROFILE; HC-QA-012 |
| B09 | HIGH | Circle summaries / nextPlan / upcoming | **FAIL** — HC-QA-011; membership teaser/transition PASS | STAGE-B-AGG-CIRCLES; HC-QA-011 |
| B10 | HIGH | Scheduled discovery (future publish_at) | **FAIL** — HC-QA-012 | HC-QA-012 |
| B11 | HIGH | Synthetic booking/registration/enrollment authorization; attendee contact | **PASS** | STAGE-B-BOOKING (+ IDOR-BOOKING) |
| B12 | HIGH | Error/exception secret leakage (canaries) | **PASS** | STAGE-B-ERRORS |
| B13 | HIGH | Manage link/confirm/switch/become-provider | **PASS** | STAGE-B-MANAGE |
| B14 | MEDIUM | Routines, search alerts, blocks, follows, invitations, host-review replies | **PASS** | STAGE-B-PERSONAL |
| B15 | MEDIUM | Reports/mine, chat report, notifications (resident + vendor), profile/household/export | **PASS** | STAGE-B-PERSONAL, STAGE-B-VENDOR-OPS, STAGE-B-CIRCLE-ROLES (+ earlier IDOR-*) |
| B16 | MEDIUM | Real cloud media delivery/deletion (R2/Cloudinary) | **EXTERNAL PENDING** | Authorized owners stop at 503 storage boundary |
| B17 | LOW | Invented PATCH/notification-delete routes, independent host role | **NOT APPLICABLE** | — |
| B18 | HIGH | Positive refund completion (programme/booking/experience/game) | **EXTERNAL PENDING** | Authorized owner/finance reach 502 provider boundary; no row change |
| B19 | MEDIUM | Local media authorization for remaining entity types (program/experience/club-session/club/org-logo/draft/avatar) | **PASS** | STAGE-B-MEDIA |
| B20 | LOW | Public club schedule vs parent publication (found during B10 work) | **FAIL** — HC-QA-015 | HC-QA-015 |

### Session ↔ room assignment (Step 3) — executed

| Actor | Programme session parent | Room | Result | DB |
|---|---|---|---|---|
| Vendor A | Programme A | Room A | 201, `room_id` = Room A | legitimate row only |
| Vendor A | Programme A | Vendor B room | 400 | sessions + rooms unchanged |
| Vendor B | Programme A | Vendor B room | 403 | unchanged |
| Vendor B | Programme A | Room A | 403 | unchanged |
| Vendor B | Programme B | Room A | 400 | unchanged |
| Vendor A | Programme A | nonexistent room | 400 | unchanged |
| Vendor A | nonexistent programme | Room A | 403 | unchanged |
| Blocks | own centre + foreign room / foreign block delete / foreign parent | — | 400 / 404 / 403 | blocks + rooms unchanged |

Cross-centre session↔room links after the run: 0.

### Refund authorization (Step 4) — provider-boundary strategy

QA profile has no `STRIPE_*`; `issueStripeRefund()` returns "Payments aren't configured
on this server" (502) with no network (backend wrapper also blocks sockets). Denied:
guest 401; foreign vendor/foreign parent 403; foreign vendor/own parent+victim child 404;
owner/own parent+foreign child 404; foreign parent+foreign child 403; nonexistent parent
403 / child 404; same-org read-only analyst 403; centre manager (no finance) 403; unpaid
400; cash 400; foreign booking refund/cancel 404. None reached the provider message;
enrollments, bookings, refund audit and notifications unchanged. Owner and same-org
finance staff reached the 502 boundary with no row change. **Positive refund = EXTERNAL
PENDING (B18).** Experience booking refund (foreign 403, own parent+foreign child 404) and
host game participant refund (non-host 403) also denied before the provider.

### Relationship principle (HC-QA-008/009 lesson) — result

Verified relationship-scoped: programme sessions (room), blocks (room), rooms, programme
session delete, enrollment cancel/refund, attendance read/write, experience sessions/
bookings/attendance/refund, club sessions, club waitlist offer, coupons, review replies,
vendor notifications, org invites, Circle plan read/edit/confirm/cancel, poll↔plan binding,
poll close, join-request respond, Circle invitation respond, game participant manage/
remove/check-in/refund, waitlist offer. **Not scoped:** Circle poll vote (HC-QA-013) and
activity→Circle attachment (HC-QA-014, documented as intentional in code). Assessed as
isolated instances, not a systemic parent→child failure.


## HC-QA-008 remediation — current, 2026-09-29

This addendum supersedes B04/HC-QA-008 failure status below; the Phase 6 ledger is a
historical stop snapshot, not current defect status. Broad Stage B is still paused.

| Boundary | Expected / actual | Evidence / status |
|---|---|---|
| Owner programme + owner session | 200, authorized enrollment attendance only | PASS, original regression unchanged |
| Owned programme + unrelated session (both organisations/directions) | 404, same as missing child | PASS |
| Foreign/missing programme + valid session | 403 | PASS |
| Owned programme + missing/wildcard child | 404, no attendance projection | PASS |
| Session attendance with malformed foreign-enrollment ref | Do not disclose unrelated enrollment | PASS, SQL join excludes it |
| Own session + foreign/nonexistent enrollment POST | 404; all programme/session/enrollment/attendance rows unchanged | PASS after HC-QA-009 guard |
| Foreign session + enrollment POST | 403; unchanged | PASS |
| Own session + own enrollment create/update | 200, only intended attendance changed | PASS |
| Own programme + foreign enrollment cancellation | 404; unchanged | PASS |
| Own programme + foreign session deletion | 200 scoped no-op; unchanged | PASS |

HC-QA-008 P1 and HC-QA-009 P2: FIXED LOCALLY — NOT DEPLOYED. B04 read gap is locally
resolved; B05 attendance-write portion is resolved but its other operational scope
is not certified. Other Stage B groups remain pending review/external configuration.

## Phase 6 gap analysis — 2026-09-29 (current work ledger)

The historical route-family inventory and proven operation rows below are retained.
The finite ledger here counts ONLY remaining work groups, not endpoints or all
possible role combinations. Already-proven cases are not duplicated to increase
coverage. HC-QA-008 triggered the mandatory stop; BLOCKED means untested due to
that stop, not a claim of an unavailable environment or a successful denial.

**TOTAL 17; TESTED 1; PASS 0; FAIL 1; BLOCKED 14; NOT APPLICABLE 1;
EXTERNAL INTEGRATION PENDING 1.** These are Phase 6 backlog-group counts only.
The 37 pre-existing passing regression scenarios below are a separate test-suite
baseline, not 37 additional resolved gap groups. No full-platform percentage.

| Gap | Risk | Remaining boundary / actual operation families | Current status |
|---|---|---|---|
| B01 | CRITICAL | Additional admin mutation variants and staff/manager denial | BLOCKED — HC-QA-008 stop |
| B02 | CRITICAL | Remaining vendor/staff role, organisation ownership and sensitive-field manipulation | BLOCKED — HC-QA-008 stop |
| B03 | HIGH | Cross-vendor club/experience CRUD and child sessions | BLOCKED — HC-QA-008 stop |
| B04 | HIGH | Programme/session attendance child-parent read association | FAIL — HC-QA-008; 403 direct but 200 foreign data with substituted parent |
| B05 | HIGH | Programme attendance/enrollment child writes and operational data scope | BLOCKED — HC-QA-008 stop |
| B06 | HIGH | Remaining host cancel/update/lifecycle/capacity/pricing boundaries | BLOCKED — HC-QA-008 stop |
| B07 | HIGH | Circle organiser/member roles, plan/poll child substitution and chat | BLOCKED — HC-QA-008 stop |
| B08 | HIGH | Public host-profile aggregation versus canonical draft/private visibility | BLOCKED — HC-QA-008 stop |
| B09 | HIGH | Circle summaries/next-plan/upcoming aggregation visibility | BLOCKED — HC-QA-008 stop |
| B10 | HIGH | Scheduled discovery publication visibility | BLOCKED — HC-QA-008 stop |
| B11 | HIGH | Additional synthetic unpaid booking/attendee/vendor authorization | BLOCKED — HC-QA-008 stop |
| B12 | HIGH | Authentication-related error/exception secret exposure | BLOCKED — HC-QA-008 stop |
| B13 | HIGH | Manage linking/workspace-switch boundaries beyond existing auth coverage | BLOCKED — HC-QA-008 stop |
| B14 | MEDIUM | Remaining preferences/routines/search-alert/follow personal-data isolation | BLOCKED — HC-QA-008 stop |
| B15 | MEDIUM | Remaining moderation/report/capability reads, household/profile/notification variants where supported | BLOCKED — HC-QA-008 stop |
| B16 | MEDIUM | Cloud media delivery/deletion against isolated storage | EXTERNAL INTEGRATION PENDING |
| B17 | LOW | Invented PATCH/notification-delete routes, independent global host role, payment operations in this checkpoint | NOT APPLICABLE |

Total planned groups: 17. Primary sequence: critical role/write boundaries,
cross-account/child ownership, private reads/aggregations, then lower-risk variants.
B04 is a concrete cross-organisation source candidate identified while tracing
vendor write/role architecture; reproduction takes priority over unrelated probes.

## Invitation closure — 2026-09-29 (supersedes deferred acceptance rows)

| Endpoint / boundary | Actor | Result | Database invariant |
|---|---|---|---|
| POST /auth/accept-invite | Authenticated resident/vendor mismatching recipient | 403 generic | Account/invite/resident/session unchanged; no cookie |
| POST /auth/accept-invite | Conflicting resident/vendor cookies | 403 | All scoped rows unchanged |
| POST /auth/accept-invite | Intended resident, normalized invite email | 201 | New staff only; exact invitation org/role; resident unchanged |
| POST /auth/accept-invite | Intended new recipient concurrently | One 201, one 400 | One account/session; consumed token; no duplicate membership |
| POST /auth/accept-invite | Existing intended member, same/conflicting role | 409 | No upgrade, credential/session/invite change |
| POST /auth/accept-invite | Expired/accepted/revoked | 400 | No account or session creation |
| QA-only historical audit fixture cleanup | Explicit run-marked rows | PASS | Active credential revoked; metadata/history retained; idempotent |

HC-QA-007 tracks binding separately from HC-QA-006 disclosure. All above PASS,
local-only; Stage B backlog remains unexecuted. Production cleanup is a plan only.

## Defensive hardening follow-up (current)

Not broad Stage B. All earlier disclosure/ownership assertions preserved.

| Focused operation | Actor / boundary | Evidence |
|---|---|---|
| Invitation creation audit | Synthetic owner | Before: raw credential persisted. After: SHA-256 management ID + safe metadata, no token |
| Invitation revocation audit | Synthetic owner, own fixture only | Unmatched legacy token input does not mutate/audit; safe ID revokes with token-free audit |
| Existing-recipient acceptance rejection | Authenticated intended synthetic recipient itself | 409, no credential/role/membership/session/invite changes; no new cookie |
| Club-session favourites hydration | Resident; approved/pending parent transitions | SQL alias regression fixed; 200 and visibility matches parent; saved relation unchanged |
| Acceptance recipient mismatch / concurrency | Source review only | Deferred; not an unauthorized redemption or escalation test |

See QA_INVITATION_SECURITY_REVIEW.md for risk/design details. Remaining broad rows
remain pending; green focused tests are not authorization completion.

## Latest focused update — HC-QA-006 (2026-09-28)

Broad Stage B paused by user. No invitation redemption/escalation attempted.
This update supersedes invitation-read rows only; other pending scope stays pending.

| Endpoint / operation | Actor | Current contract | Evidence |
|---|---|---|---|
| GET /vendor/org | Owner | Safe pending metadata only: id,email,platformRole,status,createdAt,expiresAt; no token/URL | Real QA regression PASS |
| GET /vendor/org | Invited centre_manager | No pending invitations; manager lacks invitation-management authority | Real QA regression PASS |
| GET /vendor/org | Read-only analyst | No pending invitations or credentials | FAIL before fix, PASS after |
| GET /vendor/org | Resident / guest | 401, no invitation secrets | Real QA regression PASS |
| POST /vendor/org/staff/invite | Owner | Create synthetic invitation normally | 201, DB pending row verified |
| DELETE /vendor/org/staff/invite/:id | Owner | Revoke by non-redeemable ID, org scoped | PASS, DB status revoked |
| DELETE /vendor/org/staff/invite/:id | Invited manager / read-only analyst | No management authority | PASS / 403, invite unchanged |
| GET /invites/:managementId | Guest | Management ID is not a bearer token | PASS / 404; no redemption attempted |
| POST /auth/accept-invite | Intended recipient | Existing implementation unchanged | CODE REVIEW ONLY, no redemption attempted |

HC-QA-006: P1 secret disclosure, FIXED LOCALLY — NOT DEPLOYED. Escalation not
confirmed. Acceptance concurrency/binding and raw token persistence in existing
creation audit records remain risks for separate review. No overall RBAC sign-off.

Stage A HC-QA-003/004/005 regressions passed before this focused request; historical
failure rows below are retained as before-fix evidence, not current open status.

Local isolated QA only. Source inventory is not execution evidence. An HTTP 200 can be a safe redacted teaser or ignored sensitive fields; a denial must also preserve database state. Unsupported HTTP methods are not invented CRUD coverage.

Resident and host use resident sessions; verified-host is a trust badge, not a general create permission. Vendors use approved user sessions with organisation-scoped ownership; invited staff also require platform roles. Admin is a separate user role, not a universal resident/vendor session. Guest booking access additionally uses device capability (`X-Client-Id`) or reference plus email recovery, not just resident IDs.

| Resource / endpoint (under /api) | Methods | Guest | Resident / Host | Vendor | Admin | Ownership / membership / state | Actual / automation | Finding |
|---|---|---|---|---|---|---|---|---|
| residents/me, me/export, me/preferences, me/*-prefs | GET/PUT/DELETE as implemented | null or deny | Self only | Deny without resident session | Same | Session identity, explicit field allowlists | Pending | — |
| household/:id | PUT/DELETE | Deny | Own household only | Deny | Deny | resident_id | Pending | — |
| residents/me/notifications/:id/read | POST | Deny | Own notification only | Deny | Deny | resident_id | Pending | — |
| favourites, follows, residents/me/search-alerts, routines, blocked | GET/POST/PUT/DELETE as implemented | Deny | Self only | Deny | Deny | Resident-scoped predicates | Source review; extended tests pending | — |
| residents/:id/host-profile | GET | Public safe fields | Public safe fields | Public safe fields | Public safe fields | Verified host; public listings only | Pending | — |
| games, games/:id | POST/PUT | Deny mutations | Create own; edit own | Deny without resident session | Same | host_resident_id; lifecycle/visibility | Pending | — |
| games/:id/lifecycle, cancel, participants/manage, updates | POST/GET | Public reads only where intended | Host management; restricted membership reads | No implicit host power | No implicit host power | Owner and resource state | Pending | — |
| circles/:id and members, polls, plan-ideas, upcoming, activity | GET | Open content or restricted teaser | Full private content requires member | No implicit membership | No implicit membership | join_mode=open/approval/invite | Pending | — |
| circles/:id; status; members/:residentId/remove,promote,demote | PUT/POST | Deny | Organiser only | Deny | Deny without resident organiser session | circle_members.role | Pending | — |
| circles/:id/join; join-requests/:requestId/respond; invitations/:id/respond | POST/DELETE | Deny | Self join by mode; organiser decides; invite recipient | Deny | Deny | Parent circle, recipient and invitation state | Pending | — |
| chat/:scopeType/:scopeId/messages | GET/POST | Scope-dependent | Scope membership | Scope ownership | Explicit scope rules | See chat access resolver | Source review; execution pending | — |
| vendor/centres/:id; rooms/:roomId; blocks/:blockId | GET/PUT/POST/DELETE as implemented | Deny | Deny | Same organisation; mutation platform role | Vendor middleware denies | Parent ownership AND child-parent association | Pending | — |
| vendor/clubs; experiences; programs; sessions; attendance | GET/POST/PUT/DELETE as implemented | Deny | Deny | Same organisation and relevant staff role | Vendor middleware denies | Ownership and parent association | Source review; extended tests pending | — |
| vendor/org; policies; staff/invite | GET/PUT/POST/DELETE as implemented | Deny | Deny | Own org; writes owner only | Deny | Session org; invited_staff guard | Pending | — |
| admin/*; admin/media/* | GET/PUT/POST/DELETE as implemented | Deny | Deny | Deny | Allow supported actions | requireAdmin middleware | Pending representative read/mutation | — |
| bookings/status/:ref, :ref/ics, lookup, :ref/cancel | GET/POST | Capability-scoped | Capability or account-scoped per endpoint | No implicit public ownership | Same | Seeded records only; no checkout/refund | Pending | — |
| registrations, passes, experiences booking APIs | GET/POST as implemented | Capability/auth scoped | Own records | Separate vendor management | Separate admin management | Payment operations excluded | Source inventory; execution pending | — |
| media/authorize, finalize, release | POST | Deny | Own avatar/activity; Circle organiser | Own org entity | No implicit vendor/resident grant | Authorization before storage configuration | Pending; external storage disabled | — |
| media/circles/:id/cover | GET | Restricted by join mode | Member for private | No implicit membership | No implicit membership | Restricted delivery vs public media | Pending; delivery blocked without QA cloud storage | — |
| manage/link, switch, become-provider | POST | Token or deny | Linked identity / verified host | Link proof, own resident | Explicit linked identity only | Tokens, resident_id and approved vendor boundary | Source review; execution pending | — |
| reports/mine; reviews; feedback; invitations | GET/POST as implemented | Device/capability where intended | Scoped actor | Scoped actor | Separate moderation | Client capability is not an account ID | Source inventory; execution pending | — |
| discover/search/centres/clubs/providers/programs/experiences/sharing | GET | Public representation | Public representation | Public representation | Public representation | Publication/privacy filters required | Source inventory; comprehensive leakage audit pending | — |

## Executed matrix (supersedes Pending for only the exact operations below)

All automated against REAL API + isolated REAL DB except the explicitly email-only logging probe. Roles not listed for an operation remain untested, not implicitly passed.

| Resource | Endpoint / method | Tested actor | Owner/member condition | Expected | Actual | Automated | Finding |
|---|---|---|---|---|---|---|---|
| Admin | GET /admin/vendors; PUT /admin/vendors/:id/status | Guest, resident, host, vendor | Non-admin | Deny, vendor row unchanged | PASS / 401, unchanged | Yes | — |
| Admin | GET /admin/vendors | Admin | Admin | Allow | PASS / 200 | Yes | — |
| Vendor | GET /vendor/listings | Guest, resident, host, admin / vendor | Approved vendor | Deny / allow | PASS / 401 / 200 | Yes | — |
| Profile | PUT /residents/me | Resident B | Only self; injected role, host status, email, credential/identity fields forbidden | Ignore sensitive fields; both rows unchanged | PASS / 200 no mutation | Yes | — |
| Profile | GET /residents/me and /me/export with victim query ID | Resident B | Session identity | Return B, not A; no password hash | PASS | Yes | — |
| Household | GET /household; PUT/DELETE /household/:id | Owner A / resident B | Own child record | A sees; B cannot read/change/delete | PASS / 403 mutations, snapshot unchanged | Yes | — |
| Notifications | GET /residents/me/notifications; POST /:id/read | Owner A / resident B | resident_id | No B disclosure or mutation | PASS / 404 mutation, unchanged | Yes | — |
| Host activity | GET /games/:id, /participants/manage; PUT /:id; POST /:id/lifecycle | Host A / host B / guest | Host A's draft | Owner read; others deny management/edit/publish | PASS / 404,401,403; row unchanged | Yes | — |
| Circle content | GET /circles/:id and /members | Guest, organiser A, resident B as non-member then member | open/approval/invite | Public open content; restricted teaser; member full detail | PASS | Yes | — |
| Circle content | GET /:id/plan-ideas,polls,upcoming,recent-activity,moments,activity | Guest, non-member B | Invite-only | Deny | PASS / 403 | Yes | — |
| Circle management | PUT /circles/:id; POST /:id/join and /members/:residentId/remove,promote,demote | Guest, non-member B; member B edit | Organiser only; invite-only admission | Deny, Circle/membership unchanged | PASS / 401,403 | Yes | — |
| Circle child | POST /:id/join-requests/:requestId/respond | Organiser B | A's request ID with B's parent | No approval/membership side effects | PASS / 404; both snapshots unchanged | Yes | — |
| Vendor listing | GET /vendor/centres/:id and /rooms; PUT/DELETE /:id | Vendor B versus vendor A | Distinct organisations verified | Deny; full row unchanged | PASS / 403 | Yes | — |
| Vendor child | PUT /vendor/centres/:B/rooms/:A | Vendor B | Own parent, foreign child | Deny; both parents/rooms unchanged | PASS / 404 | Yes | — |
| Program/session | GET /vendor/programs/:A; POST /:A/sessions | Vendor B | Foreign program | Deny | PASS / 403 | Yes | — |
| Program child | DELETE /vendor/programs/:B/sessions/:A | Vendor B | Own parent, foreign session | No foreign cancellation | PASS / 200 scoped no-op, session unchanged | Yes | — |
| Staff RBAC | GET/PUT/DELETE /vendor/centres/:id; PUT /vendor/org; GET /admin/stats | Read-only analyst in owner's org | Read permitted, management forbidden | Read allowed; writes/role escalation denied | PASS / 200,403,401; DB unchanged | Yes | — |
| Booking | GET /bookings/status/:ref; POST /lookup and /:ref/cancel | Owner capability / B / guest | Seeded unpaid row, foreign device and email | Owner read; foreign denial and no side effects | PASS / 200,404; unchanged | Yes | — |
| Media | POST /media/authorize,finalize,release for activity; authorize Circle; release centre | Foreign host, guest, resident, vendor as applicable | Own resource/organiser | Deny before storage | PASS / 401,403; entity unchanged | Yes | — |
| Private Circle cover | GET /media/circles/:id/cover | Non-member resident | approval/invite with synthetic stored reference | Deny | PASS / 403 | Yes; delivery not tested | — |
| Browser + API | /admin UI and GET /admin/vendors | Real signed-in resident | Non-admin | Redirect and API deny | PASS / login redirect + 401 | Yes / Chromium desktop | — |
| Favourites disclosure | POST/GET /favourites after GET /games/:id denied | Non-owner resident | Private invite-only draft | Do not hydrate private metadata | SECURITY FAILURE / title and schedule exposed | Yes / failing regression | HC-QA-005 |
| Recovery | Concurrent POST /guest/reset-password | Two holders of one synthetic valid token | One-time consumption | One success | SECURITY FAILURE / two successes, two sessions | Yes / failing regression | HC-QA-003 |
| Email fallback | Actual sendMail module without SMTP | Local test and production-mode process | No real credentials/network | No bearer link logging | SECURITY FAILURE / canary logged both modes | Yes / failing regression | HC-QA-004 |

## Explicit limits / remaining work

Source inventory above is grouped, not an exhaustive endpoint-level proof. NOT EXECUTED: every admin mutation variant, all host lifecycle transitions, full vendor club/experience surfaces, all platform staff roles, chat/report moderation, follows/preferences/search-alert/routine mutations, invitation-recipient variants, role combinations not listed above, rescheduling/attendee authorization and comprehensive error-leakage probes. BLOCKED: real cloud-media delivery/deletion until isolated storage is configured. NOT APPLICABLE here: invented PATCH routes, an independent host role, Stripe/payment and broad booking workflows. Unpaid booking denial is not payment ownership/integrity coverage.

No P0 or broad privilege escalation was demonstrated. This does not certify the untested surfaces. Open P1 findings and remaining coverage prevent recommending progression to broad E2E/payment testing. Detailed operations and database assertions live in tests/integration/specs/authorization-*.spec.ts.
