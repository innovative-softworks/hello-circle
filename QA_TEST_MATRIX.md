# HelloCircle QA Test Matrix

## Recovery validation (current, 2026-10-01)

All current matrix scenarios rerun through unfiltered existing commands against the
fresh guarded QA MySQL: auth/security 20 PASS, authorization/remediation 83 PASS,
security gate 39 PASS. No exclusions or weakened assertions. All eight final-closure
scenarios below passed again. Current safety 91 PASS, client 81 PASS, typechecking
and build PASS, mocked smoke 13 PASS / known HC-QA-001 FAIL.
Counts overlap and must not be summed. Full subgroup definitions and environment/
cleanup limits: QA_ENVIRONMENT_RECOVERY.md and QA_REPORT.md. Stage B locally signed
off within the defined security matrix; no production readiness or next-phase work.

## Final closure (historical, before recovery, 2026-10-01)

All below use real backend + isolated QA MySQL; no external provider calls.

| ID / scenario | Role | Priority | Status | Expected / verified result |
|---|---|---|---|---|
| CLOSURE-INV-STATE | Invitee / unrelated | P1 | PASS | Inactive invitations grant no view/join/waitlist eligibility |
| CLOSURE-INV-BIND | Intended / wrong recipient | P1 | PASS | Normalized email binding; wrong recipient denied with state unchanged |
| CLOSURE-INV-CREATE | Host / unrelated | P1 | PASS | Canonical visibility required before invitation creation |
| CLOSURE-CHAT | Member / owner / manager / unrelated / guest | P1 | PASS | Four scopes, parent-message isolation, denied-write invariants |
| CLOSURE-LINK | Synthetic approved vendors / resident | P1 | PASS | Stale second confirmation rejected; original association retained |
| Account-link race/replacement | Legitimate synthetic identities | P1 | PASS | One concurrent association; stale replacement rejected |
| CLOSURE-REVOKE | Invitee / Circle member | P1 | PASS | Requests after committed removal denied; in-flight ordering permitted |
| CLOSURE-INV-CONSUME | Legitimate invitee | P2 | PASS | ID/token response 200/409; replay denied, one successful side effect |

Eight scenarios are included in the complete 39-PASS security gate. Full final
authentication/authorization validation is environment-BLOCKED; see QA_REPORT.md.
Historical counts below are not current reruns. Stage B is not signed off.

## HC-QA-016 closure (historical, 2026-09-29)

All below: isolated QA / REAL API / REAL DB / external provider absent. Counts overlap
the full authorization and security gate; not additive platform coverage.

| ID | Scenario | Status | Expected result |
|---|---|---|---|
| HC-QA-016 original | Unrelated invite-only detail → join → detail | PASS, unchanged regression | 404 / 404 / 404; participants unchanged |
| HC-QA-016-join | Public, invitee, Circle member; unrelated/former member/draft/future | PASS | Eligible 200; ineligible 404; snapshots unchanged |
| HC-QA-016-waitlist | Same visibility matrix | PASS, failed before fix | Eligible 201; ineligible 404; no unauthorized waitlist |
| HC-QA-016-paid-concurrent | Paid local boundary + duplicate free join | PASS | Hidden paid 404; invited paid 503; no outbound attempt; free 200/409, one participant |

Historical failing statuses below are superseded only for HC-QA-016 by this closure.
Final executions: gate 31 PASS (002..016), authorization 75 PASS, auth/security
20 PASS; no exclusions. Subsets are listed in QA_REPORT.md and are not summed.

## Stage B remediation (latest, 2026-09-29)

| ID | Scenario | Status |
|---|---|---|
| HC-QA-010..015 | Original regressions, unchanged | PASS (were FAIL) |
| VIS-010-TRANSITION | Participants/updates: public → invite-only for guest, unrelated user, invitee, host | PASS |
| VIS-011-CIRCLE | circle_id plans per viewer; public-only label matches; protected IDs absent; public → private | PASS |
| VIS-012-SCHEDULED | Future publish_at/draft absent from list, host profile, discover, search, share, next-steps; owner views kept | PASS |
| VIS-COUNTS | Momentum, plansThisMonth, plansCreated unchanged by protected activities; public control counted | PASS (FAIL with predicate removed) |
| VIS-013-POLL | Poll vote parent/child matrix + vote invariants | PASS |
| VIS-014-015 | Organiser-only Circle attachment; club schedule owner vs public | PASS |
| HC-QA-016 | Uninvited join of invite-only activity | **FAIL — P1 OPEN** |

Gate `qa:security-gate` now includes HC-QA-010..015: 27 PASS.


## Phase 6B — Stage B completion (latest, 2026-09-29)

All REAL API + isolated disposable MySQL; synthetic data; no Stripe/provider/network.
One Playwright batch per spec file (fresh backend each, within the real 10-login limiter).

| ID | Scenario | Roles | Status |
|---|---|---|---|
| STAGE-B-ROOM-ASSIGNMENT | Programme session↔room, blocks, hours, foreign room update | Vendor A/B (distinct orgs) | PASS |
| STAGE-B-EXPERIENCES | Experience read/update/publish/delete; sessions; booking cancel/refund/attendance children | Vendor A/B, guest | PASS |
| STAGE-B-CLUBS | Club CRUD/pause/duplicate; club sessions; roster; waitlist offer; participation | Vendor A/B | PASS |
| STAGE-B-VENDOR-OPS | Coupons, review reply, vendor notification, messages, programme update, Circle link, owner mass assignment | Vendor A/B | PASS |
| STAGE-B-REFUND | Enrollment/booking refund + cancel up to provider boundary | Guest, vendor A/B, analyst, manager, finance | PASS (positive refund EXTERNAL PENDING) |
| STAGE-B-ORG | Manager org/policy/logo/invite denial; foreign invite revoke; staff data; mass assignment | Owner A/B, manager | PASS |
| STAGE-B-MANAGE | Unlinked switch, become-provider, link token, competing link, scoped switch | Vendor B, user A/B, synthetic vendor | PASS |
| STAGE-B-HOST-MUTATIONS | Cancel/update/remove/check-in/refund/roster/waitlist/coupons/edit/lifecycle | Host A/B, participant | PASS |
| STAGE-B-HOST-PRIVATE | Invite-only/draft detail, ics, next-steps, manage; meeting instructions | Host A/B | PASS |
| STAGE-B-CIRCLE-ROLES | Management × member/non-member/vendor/admin/guest; chat; share; promote/demote | Owner, member, non-member, vendor, admin, guest | PASS |
| STAGE-B-CIRCLE-CHILDREN | Plan/poll/invitation substitution across Circles | Two organisers, invitee | PASS |
| STAGE-B-AGG-CIRCLES | Circle list/detail teaser across open→approval→invite | Owner, guest | PASS |
| STAGE-B-AGG-HOST-PROFILE | Private activity and non-open Circle exclusion, public→private | Host, guest | PASS |
| STAGE-B-ADMIN | 15 admin operations × 6 non-admin roles; admin positive; admin no resident/vendor power | 7 roles | PASS |
| STAGE-B-BOOKING | Booking/registration/enrollment status/ics/reschedule/cancel; vendor/host isolation; attendee contact | User A/B, vendor A/B, host A/B | PASS |
| STAGE-B-PERSONAL | Routines, alerts, blocks, follows, invitations, reports, host reviews, profile identity | User A/B, guest | PASS |
| STAGE-B-ERRORS | Canary login/token/header/cookie/malformed/DB-exception responses | Guest, user | PASS (malformed JSON → generic 500, P3 robustness note) |
| STAGE-B-MEDIA | 7 entity types × authorize/finalize/release × 3 foreign roles; legacy/local upload | Vendor A/B, user A/B, guest | PASS (delivery EXTERNAL PENDING) |
| HC-QA-010 | Game participants/updates vs canonical visibility | Host, user B, guest | **FAIL — P1 OPEN** |
| HC-QA-011 | Circle upcoming/nextPlan aggregation of private/draft/scheduled | User, host B, guest | **FAIL — P1 OPEN** |
| HC-QA-012 | Host profile + public list draft/scheduled | Host, guest | **FAIL — P2 OPEN** |
| HC-QA-013 | Cross-Circle poll vote | Two organisers | **FAIL — P2 OPEN** |
| HC-QA-014 | Outsider activity attached to private Circle | User, host B | **FAIL — P2 OPEN (product decision)** |
| HC-QA-015 | Club schedule for non-approved club | Guest | **FAIL — P3 OPEN** |

Permanent gate `npm run qa:security-gate`: HC-QA-002 (12 focused cases) + 003, 004, 005,
006, 007, 008, 009 (ATTENDANCE-READ/WRITE/SIBLINGS) = 21 PASS.
Earlier FAIL rows below are historical before-fix evidence.


## Attendance relationship remediation (latest, 2026-09-29)

| ID | Scenario | Backend / DB | Status |
|---|---|---|---|
| STAGE-B-CHILD / HC-QA-008 | Preserved cross-org read regression, owner positive control | REAL API / isolated MySQL | FAIL before; PASS after, unchanged test |
| ATTENDANCE-READ | Parent/child matrix, malformed descendant, auth-session/audit invariants | REAL API / isolated MySQL | PASS |
| ATTENDANCE-WRITE / HC-QA-009 | Valid enrollment association; foreign/missing child rejects without mutation | REAL API / isolated MySQL | FAIL before; PASS after |
| ATTENDANCE-SIBLINGS | Scoped enrollment cancel/session delete and private enrollment read denial | REAL API / isolated MySQL | PASS |

No refund/payment/broad booking tests. Historical HC-QA-008 FAIL rows below are
before-fix evidence. Broad Stage B completion remains unclaimed.

## Phase 6 — mandatory early stop (2026-09-29)

| ID | Scenario | Role | Environment / backend / DB | Status | Finding |
|---|---|---|---|---|---|
| STAGE-B-CHILD | Own programme + foreign session attendance | Vendor B vs distinct organisation A | Isolated QA / REAL API / REAL MySQL | FAIL; foreign enrollment ID and attendance status exposed; DB unchanged | HC-QA-008 P1 |

This is a significant cross-organisation read bypass, so new Stage B probes stopped.
No application remediation. Default authorization runner stops on this regression;
the pre-existing baseline is validated separately with explicit exclusion, never
represented as an all-green authorization run. Remaining work-group classifications
are in QA_AUTHORIZATION_MATRIX.md: 17 total, 1 tested/fail, 14 blocked by stop,
1 not applicable, 1 external integration pending. No full coverage percentage.

## Invitation closure — 2026-09-29 (latest)

All REAL API + isolated MySQL; no external services or mock application responses.

| ID | Scenario | Expected / actual | Status |
|---|---|---|---|
| INVITE-BINDING | Resident/vendor mismatch, dual-cookie conflict; legitimate normalized recipient | 403 and full DB invariants; intended recipient 201, DB org/role authoritative | PASS |
| INVITE-CONCURRENCY | Two legitimate concurrent acceptances, then replay | 201/400; one account/session; loser anonymous; replay 400 | PASS |
| INVITE-STATES-EXISTING | Existing staff, identical versus conflicting intended role | 409; no account/role/session/invite changes | PASS |
| INVITE-STATES-INVALID | Expired, consumed, revoked | 400; zero accounts/new cookies, invite unchanged | PASS |
| INVITE-HISTORY | Four synthetic historical credential states | Active revoked before redaction; metadata retained; idempotent rerun | PASS |

These five cases extend the prior three invitation scenarios; 8 invitation cases
are included in the 37-case authorization/remediation suite, not additional totals.

## Current defensive hardening additions

| ID | Scenario | Role | Priority | Backend / DB | Status | Notes |
|---|---|---|---|---|---|---|
| INVITATION-AUDIT | Secret-free creation/revocation audit history | Owner | P1 | REAL API / isolated MySQL | PASS after fix; failed before | No other-recipient acceptance |
| INVITATION-EXISTING | Own existing invitation rejects account/role mutation | Intended authenticated recipient | P1 | REAL API / isolated MySQL | PASS | 409; full identity/invite/session invariants |
| VISIBILITY-CLUB | Saved club session tracks parent publication | Resident | P1 regression | REAL API / isolated MySQL | PASS after alias correction; failed before | Approved/pending/approved; relation unchanged |

HC-QA-002/003/004/005/006 regressions are preserved. Historical open findings below
are superseded by latest QA_REPORT.md status; broad Stage B is not resumed.

## Phase 4 — authorization checkpoint (2026-09-28)

This section supersedes historical statements that paired personas/IDOR were only planned. See `QA_AUTHORIZATION_MATRIX.md` for precise endpoint/method/role coverage and explicit untested surfaces. No percentages or whole-platform security certification.

| ID | Module / scenario | Roles | Priority | Environment / backend / DB | External service | Automation | Status / expected invariant |
|---|---|---|---|---|---|---|---|
| RBAC-001 | Admin read/write boundary; vendor boundary | Guest, user, host, vendor, admin | P0 | Local / REAL API / REAL DB | None | API | PASS: denies non-admin, victim unchanged, positive admin read |
| RBAC-002 | Profile mass assignment and query identity | USER_A/B | P0 | Local / REAL API / REAL DB | None | API | PASS: role, credential and identity fields unchanged |
| IDOR-PERSONAL | Household child read/update/delete | USER_A/B | P1 | Local / REAL API / REAL DB | None | API | PASS: owner can read, cross-owner denied |
| IDOR-HOST | Draft read, management, edit, publish, media | HOST_A/B, guest | P1 | Local / REAL API / REAL DB | Storage disabled | API | PASS: owner-only management and full row invariant |
| IDOR-CIRCLE | Restricted content, join, organiser/member actions | Owner, non-member, guest | P1 | Local / REAL API / REAL DB | None | API | PASS: no private reads or membership/role mutations |
| IDOR-CIRCLE-MODES | Open/approval/invite; non-member/member; cover | Owner, guest, user | P1 | Local / REAL API / REAL DB | No real media delivery | API | PASS: public/member controls and restricted teaser |
| IDOR-VENDOR | Listing, rooms, program/session parent substitution | VENDOR_A/B, distinct orgs | P1 | Local / REAL API / REAL DB | None | API | PASS: cross-org denial and foreign child unchanged |
| IDOR-NOTIFICATIONS | Notification/private export isolation | USER_A/B | P1 | Local / REAL API / REAL DB | None | API | PASS: no victim read/mark-read |
| IDOR-BOOKING | Unpaid seeded booking status/lookup/cancel | Owner capability, user B, guest | P1 | Local / REAL API / REAL DB | NO Stripe | API | PASS: foreign capability/email denied, unchanged |
| IDOR-APPROVAL | Cross-Circle join request ID substitution | Two organisers | P1 | Local / REAL API / REAL DB | None | API | PASS: request and memberships unchanged |
| RBAC-STAFF | Read-only organisation staff restrictions | Vendor owner, read-only analyst | P1 | Local / REAL API / REAL DB | None | API | PASS: read allowed; writes/escalation denied |
| RBAC-BROWSER | Resident admin route + API boundary | User | P1 | Local / REAL frontend/API/DB | None | Chromium E2E | PASS: UI redirect and API 401 |
| HC-QA-005 | Private draft metadata through favourites | Host A / user B | P1 | Local / REAL API / REAL DB | None | API, regression preserved | SECURITY FAILURE: title/date/time disclosed |
| HC-QA-003 | Concurrent same recovery token | Synthetic resident | P1 | Local / REAL API / REAL DB | No delivery | API, regression preserved | SECURITY FAILURE: two resets and two sessions |
| HC-QA-004 | Fallback email bearer-link logging | Local synthetic canary | P1 conditional | Local / real email module / no DB | No delivery/network | Isolated diagnostic regression | SECURITY FAILURE: logs include link in both modes |

Whole-platform authorization matrix remains partial; remaining work is explicitly listed in `QA_AUTHORIZATION_MATRIX.md`. Existing HC-QA-002 tests remain unmodified. No security failure has been converted to expected-failure or skipped to claim a green suite.

Latest HC-QA-002 remediation results are below and supersede Phase 3 failure status. Earlier inventory and phase tables are historical baselines, not current execution claims.

## HC-QA-002 focused security matrix — current

All rows use the guarded disposable local MySQL environment. Real backend/API unless a narrower level is stated. No live external provider or email-delivery coverage. Full real suite: **20 passed**, including **12 security cases** (the eight named matrix requirements map to combined/parameterized cases, not eight additional independent tests).

| ID | Scenario | Role | Type / automation level | Priority | Automated? | Status | Expected result / measured evidence |
|---|---|---|---|---|---|---|---|
| SEC-REVIEW-001 / HC-QA-002 | Original passwordless signup takeover reproduction | Guest attacker | REAL API + DB | P0 | Yes, unchanged | **PASS after fix; FAIL before** | 409; no password assignment/access; provider link retained |
| AUTH-SEC-001 | Existing Google/passwordless email + public signup | Guest attacker | REAL API + DB | P0 | Yes | Pass | No credential assignment, cookies, session DB row or token response; full resident row unchanged |
| AUTH-SEC-002 | Existing password account + signup | Guest attacker / owner | REAL API + DB | P0 | Yes | Pass | Password unchanged; original password login/logout works |
| AUTH-SEC-003 | Unknown email legitimate signup | New user | REAL API + DB | P0 | Yes | Pass | One new row, intended session and verification token; confirmation and serial replay behavior preserved |
| AUTH-SEC-004 | Uppercase email collision | Guest attacker | REAL API + DB | P0 | Yes | Pass | Same existing account conflicts; attacker login rejected |
| AUTH-SEC-005 | Whitespace email collision | Guest attacker | REAL API + GUARDED SERVICE + DB | P0 | Yes | Pass | API rejects malformed email; trimmed service lookup also refuses credential linking |
| AUTH-SEC-006 | Attacker login after blocked signup | Guest attacker | REAL API | P0 | Yes, combined with collision cases | Pass | Selected password returns 401; requester stays anonymous |
| AUTH-SEC-007 | Original Google identity still resolves | Original owner | REAL SERVICE + DB | P0 | Yes, combined with collision cases | Pass | Actual UID resolver returns original ID; no Firebase verification/UI claim |
| AUTH-SEC-008 | Repeated malicious signup | Guest attacker | REAL API + DB | P0 | Yes | Pass | Repeated 409; unchanged full row, zero sessions |
| AUTH-SEC-BROWSER | Real signup form attack | Guest attacker | REAL BROWSER → API → DB | P0 | Yes | Pass | Generic error, no authenticated redirect/state, unchanged identity |
| AUTH-SEC-PASSWORDLESS | Non-Google passwordless account | Guest attacker | REAL API + DB | P0 | Yes | Pass | Same protection for magic-link identity; no invented additional provider model |
| AUTH-SEC-RACE | Concurrent new signup | Two guest contexts | REAL API + DB | P0 | Yes | Pass | 201/409, one row/session, winning hash not overwritten |
| AUTH-SEC-RECOVERY-001 | Passwordless reset and invented token | Guest attacker | REAL API + DB | P0 | Yes | Pass | No reset token/session or password mutation |
| AUTH-SEC-RECOVERY-002 | Recovery expiry/binding/serial replay | Synthetic owner with trusted token | REAL API + DB | P0 | Yes | Pass | Expired rejected; valid token targets bound identity; serial replay rejected. Concurrent replay remains source-audit concern |

HC-QA-001 stays OPEN (final mocked suite 13 passed / 1 failed). IDOR, payments, booking and provider-integration expansion remain outside this checkpoint. Source findings for nontransactional reset consumption and non-SMTP secret-link logging are tracked in the remediation report, not hidden as passing coverage.

## Phase 3 — real integration execution

Environment: disposable local Docker MySQL, real frontend/backend, no external-provider integration. Default `qa:auth`: **8 passed / 1 failed**, stopped for P0 review. No full IDOR mutations performed.

| ID | Module / scenario | Role | Environment | Backend | Database | External service | Automation level | Priority | Automated? | Status | Expected result / notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| QA-SAFE-003 | Actual identity / grants policy | Runner | Offline synthetic evidence | None | None | None | UNIT | P0 | Yes | 17 passed | Refuse root, shared/prod/unknown DB, UUID/marker mismatch, excess/unescaped-wildcard grants |
| QA-ENV-003 | Container / DB / application-pool identity | Harness | Local QA | Real | Real isolated MySQL | Blocked | CONNECTED PREFLIGHT | P0 | Yes | Pass | Validate actual identity before mutation; verify via frontend proxy before each test |
| QA-DATA-001 | Setup / repeat seed / reset | Four personas + suspended control | Local QA | Application schema/helpers | Real isolated MySQL | None | REAL DB | P0 | Yes | Pass | Restricted account; no global DELETE; exact container reset; repeat seed preserves identity |
| REAL-AUTH-001 | UI login / refresh / UI logout / restricted access | User | Local desktop Chromium | Real | Real | Blocked | REAL E2E + API | P0 | Yes | Pass | Same resident identity after refresh; protected data denied after logout |
| REAL-AUTH-ROLE-HOST | Login and manage; admin denied | Host resident | Local desktop Chromium | Real | Real | Blocked | REAL E2E + API | P0 | Yes | Pass | `/manage` available; admin UI/API rejected |
| REAL-AUTH-ROLE-VENDOR | Login and vendor listings; admin denied | Approved vendor | Local desktop Chromium | Real | Real | Blocked | REAL E2E + API | P0 | Yes | Pass | Vendor context available, admin unavailable |
| REAL-AUTH-ROLE-ADMIN | Login and admin stats | Admin | Local desktop Chromium | Real | Real | Blocked | REAL E2E + API | P0 | Yes | Pass | Correct real identity/role; no destructive actions |
| REAL-AUTH-NEG | Wrong/unknown/empty credentials and suspended account | Guest / suspended vendor | Local QA | Real | Real | None | REAL API | P0 | Yes | Pass | Wrong/unknown resident errors match; empty 400; suspended 403 without vendor access |
| REAL-AUTH-EXPIRY | Expired real session | User | Local QA | Real | Real | None | REAL API + UI | P0 | Yes | Pass | Expired cookie rejected; exact fixture token cleanup |
| REAL-AUTH-GUEST | Missing/invalid session and protected UI | Guest | Local desktop Chromium | Real | Real | Blocked | REAL API + UI | P0 | Yes | Pass | Protected APIs 401, manage redirects, profile sign-in gate |
| REAL-AUTH-FORM | Empty/malformed form inputs | Guest | Local desktop Chromium | Real | Real available | Blocked | BROWSER VALIDATION | P1 | Yes | Pass | Disabled empty submit; native email validity; not server malformed-email coverage |
| SEC-REVIEW-001 / HC-QA-002 | Signup cannot claim passwordless Google-linked resident | Unauthenticated outsider | Local QA only | Real | Real | No real Google/SMTP | REAL API + DB REGRESSION | P0 | Yes | **FAIL — CONFIRMED DEFECT** | Must not set password/authenticate without ownership proof; 201 and original-identity access observed |
| HC-QA-001 | Mobile cookie controls accessible | Guest | Local 390×844 | Mocked | None | Stubbed | MOCKED BROWSER | P1 | Yes | **FAIL, unchanged** | Retained existing regression; no UI changes |
| QA-IDOR-REAL-001–005 | Owner versus second account mutation/privacy boundaries | Owner / User B / Host B / Vendor B / Admin | Future guarded QA | Planned real | Planned isolated | Media deferred | PLAN ONLY | P0 | No | Await P0 remediation/review | Actual endpoint/action mapping remains in QA_ENVIRONMENT.md; second-owner accounts not yet seeded |

The first real P0 authentication journey now has measured password/session coverage; onboarding, discovery/detail, publish and booking/payment journeys are not claimed complete. Real mobile authentication, Google provider behavior, staging HTTPS cookies, back-navigation replay, complete role matrix and full resource IDOR remain pending.

## Historical inventory

**Audit baseline:** 2026-09-27  
**Status legend:** Existing = covered by an inspected Vitest suite; Proposed = not automated at the required layer; Manual = intentionally manual/provider-dependent; Blocked = requires safe environment or product decision. “Existing” does not imply browser E2E coverage.

The table below preserves the initial inventory. The **Approved foundation execution** table at the end records implementation and measured results after approval; it supersedes the initial statuses only for the listed scenarios.

| ID | Module | Scenario | Role | Type | Priority | Automated? | Status | Expected Result | Notes |
|---|---|---|---|---|---|---|---|---|---|
| QA-SMK-001 | Application | Health endpoint responds | Guest | API smoke | P0 | No | Proposed | `/api/health` returns 200 and `{ok:true}` | First foundation test. |
| QA-SMK-002 | Application | Public entry and primary assets load without fatal errors | Guest | E2E | P0 | No | Proposed | Page is usable; first-party assets load; no uncaught error | Run in explicit public/prelaunch modes. |
| QA-SMK-003 | Navigation | Primary desktop/mobile navigation | Guest | E2E | P1 | No | Proposed | Destinations open; no overflow or inaccessible controls | 1440×900 and 390×844. |
| QA-AUTH-001 | Resident auth | Valid password sign-in | Resident | E2E/API | P0 | Partial | Proposed | Secure resident session established; account UI loads | Password signup route tests exist; browser journey absent. |
| QA-AUTH-002 | Resident auth | Invalid/empty/malformed credentials | Guest | E2E/API | P1 | Partial | Proposed | Generic safe error; no session/cookie | Include loading and server error. |
| QA-AUTH-003 | Resident auth | Logout, refresh, back navigation, expiry | Resident | E2E | P0 | No | Proposed | Session persists until logout/expiry; protected data unavailable afterward | Validate API, not just redirect. |
| QA-AUTH-004 | Resident auth | Magic-link request and completion | Guest | API/E2E | P0 | Partial | Proposed | Token is single-use/expiring; correct resident session issued | Use mail sink; existing consent/token route coverage is partial. |
| QA-AUTH-005 | Resident auth | Duplicate email and concurrent signup | Guest | API | P0 | Yes | Existing | One account only; deterministic conflict | `residentPasswordSignup`/Google suites. |
| QA-AUTH-006 | Google auth | Existing linked resident signs in | Resident | API | P0 | Yes | Existing | Verified UID opens correct account | Do not drive Google UI. |
| QA-AUTH-007 | Google auth | New identity completes account explicitly | Guest | API | P0 | Yes | Existing | No account before confirmation; one account afterward | Includes terms and concurrency. |
| QA-AUTH-008 | Google auth | Email collision/account-linking protection | Resident | API | P0 | Yes | Existing | No implicit takeover/link; 409 where expected | Existing Google route suite. |
| QA-AUTH-009 | Google auth | Popup cancel/close/provider outage | Guest | Manual/component | P2 | No | Manual | User remains signed out with recoverable feedback | Provider UI remains manual; client handling can be mocked. |
| QA-AUTH-010 | Vendor auth | Signup → pending → admin approval → access | Vendor/Admin | API | P0 | Yes | Existing | Pending is blocked; approved vendor gains access | Browser journey remains proposed. |
| QA-AUTH-011 | Admin auth | Non-admin cannot access admin API | Vendor/Resident | API | P0 | Partial | Proposed | 401/403; no state change or sensitive body | Expand systematic matrix. |
| QA-ONB-001 | Onboarding | First sign-in opens account setup gate | New resident | E2E | P0 | No | Proposed | Setup appears at correct time | `/onboarding` redirects; actual UI is `AccountSetupGate`. |
| QA-ONB-002 | Onboarding | Required, optional, skip, back, refresh, resume | New resident | E2E | P0 | No | Proposed | Data persists correctly; no dead-end or loss | Include mobile. |
| QA-ONB-003 | Onboarding | Completed user does not re-enter setup unexpectedly | Resident | E2E/API | P1 | Partial | Proposed | Normal destination opens | Terms/setup route tests cover part of state logic. |
| QA-DISC-001 | Discovery | Home/Explore discovery to detail | Guest | E2E | P0 | No | Proposed | Selected public item opens correct detail | QA-003. |
| QA-DISC-002 | Discovery | Search term, category, county and combined filters | Guest | E2E/API | P1 | Partial | Proposed | Results and URL state match filters | Search/parser logic exists; browser absent. |
| QA-DISC-003 | Discovery | Empty, loading and API error states | Guest | E2E | P1 | No | Proposed | Clear non-destructive feedback and retry | UX assertion. |
| QA-DISC-004 | Discovery | Draft/pending/unpublished content excluded | Guest | API/E2E/security | P0 | Partial | Proposed | Direct/list/search access reveals no protected content | Cover every concrete entity. |
| QA-DISC-005 | Discovery | Pagination/infinite content does not duplicate/skip | Guest | E2E | P2 | No | Proposed | Stable continuous result set | Apply only where implemented. |
| QA-MAP-001 | Maps | Map loads and markers correspond to cards | Guest | E2E | P2 | No | Proposed | Bidirectional selection remains consistent | Mock external map calls for default suite. |
| QA-MAP-002 | Maps | Missing/invalid coordinates and disabled provider | Guest | E2E | P1 | No | Proposed | Safe fallback; rest of discovery remains usable | Exercise kill switch. |
| QA-MAP-003 | Maps | Pan/zoom/location search/mobile sheet | Guest | E2E/manual | P2 | No | Proposed | Interaction is usable without excess external calls | One controlled provider integration test. |
| QA-LST-001 | Public listings | Centre/club/game/program/experience detail fields | Guest | E2E/API | P1 | Partial | Proposed | Title, host/provider, venue, schedule, capacity, image, price and CTA are accurate | Entity-dependent assertions. |
| QA-LST-002 | Public listings | Sold-out/cancelled/expired state | Guest | E2E/API | P0 | Partial | Proposed | Status and CTA are correct; mutation refused server-side | Existing lifecycle/capacity tests are partial. |
| QA-BKG-001 | Centre booking | Public centre → room/date/time/party → pending checkout | Guest/Resident | E2E/API | P0 | Partial | Proposed | Server validates price/availability and creates one pending booking | QA-004 initial transaction. |
| QA-BKG-002 | Booking | Invalid quantity/date/session/capacity | Guest/Resident | API | P0 | Partial | Proposed | 4xx; no booking/payment side effect | Server enforcement required. |
| QA-BKG-003 | Booking | Simultaneous last-capacity requests | Guest/Resident | Integration | P0 | Partial | Proposed | At most allowed capacity succeeds | Strong coverage exists for registrations/games; verify bookings. |
| QA-BKG-004 | Booking | Duplicate submission/idempotency | Guest/Resident | API/E2E | P0 | Partial | Proposed | One payable transaction and one eventual booking | Browser double-click plus API replay. |
| QA-BKG-005 | Booking | Confirmation/status/My Life reflects purchase | Guest/Resident | API/E2E | P0 | Partial | Proposed | Correct persisted booking shown once | Status payload route tests exist. |
| QA-BKG-006 | Booking | Cancellation cutoff and off-platform refund messaging | Guest/Resident/Vendor | API/E2E | P1 | Partial | Proposed | Valid cancellation follows policy; no false automatic-refund claim | Refund is not implemented. |
| QA-PAY-001 | Stripe | Successful test payment confirms transaction | Guest/Resident | E2E/integration | P0 | Partial | Blocked | Confirmation only after paid signed webhook | Needs Stripe test environment. |
| QA-PAY-002 | Stripe | Declined/cancelled/incomplete/expired checkout | Guest/Resident | E2E/integration | P0 | Partial | Blocked | No confirmed booking; pending row reconciled per type | Verify all six transaction types over time. |
| QA-PAY-003 | Stripe | Duplicate webhook | System | Integration | P0 | Yes | Existing | Confirmation and side effects occur once | Existing selected confirm-handler coverage. |
| QA-PAY-004 | Stripe | Delayed success/failure webhook | System | Integration | P0 | Partial | Proposed | Async state converges correctly exactly once | Signed fixture events. |
| QA-PAY-005 | Stripe | Server-side pricing/coupon/deposit | Guest/Resident | API | P0 | Partial | Proposed | Client tampering cannot change calculated total | Include coupon concurrency. |
| QA-PAY-006 | Stripe | Live key/environment guard | System | Safety | P0 | No | Proposed | Test runner aborts before mutation if key/host is unsafe | Foundation prerequisite. |
| QA-HOST-001 | Resident host | Create/edit/publish a game/activity | Game host | E2E/API | P0 | Partial | Proposed | Owned activity transitions correctly and appears publicly when eligible | Use actual game workflow, not invented generic entity. |
| QA-HOST-002 | Resident host | Other resident edits host's activity | Resident B | API/security | P0 | Partial | Proposed | 403/404; resource unchanged | Ownership negative. |
| QA-VND-001 | Vendor | Create/edit centre or club draft | Vendor owner | E2E/API | P0 | Partial | Proposed | Draft saved with validation and remains non-public | Existing route tests; browser absent. |
| QA-VND-002 | Vendor | Create/edit/publish experience or program | Vendor owner | E2E/API | P0 | Yes/Partial | Proposed | State workflow and public visibility are correct | Route suites exist for both entities. |
| QA-VND-003 | Vendor | Vendor A accesses Vendor B resource | Vendor B | API/security | P0 | Partial | Proposed | Read/write denied; no leaked operational data | Systematic cross-owner matrix needed. |
| QA-VND-004 | Vendor staff | Platform-role write permissions | Invited staff | API/security | P0 | Partial | Proposed | Only allowed role actions succeed | Test each actual role. |
| QA-VND-005 | Vendor staff | Org-wide read permissions | Invited staff | API/security | P1 | No | Blocked | Result follows agreed product policy | Current intent is undefined/broad. |
| QA-VND-006 | Vendor operations | Booking/check-in/schedule/insights | Vendor | API/E2E | P1 | Yes/Partial | Proposed | Correct org data and authorized mutations | Route coverage exists; E2E absent. |
| QA-CIR-001 | Circles | Create open/approval/invite-only Circle | Resident | API/E2E | P1 | Partial | Proposed | Correct organiser, join mode and public teaser | Route logic is strongly covered. |
| QA-CIR-002 | Circles | Join/request/invite/approve/leave | Resident/Organiser | API | P0 | Yes | Existing | State changes are idempotent and role-correct | Existing Circle suite. |
| QA-CIR-003 | Circles | Outsider guesses private Circle/subresource IDs | Guest/Resident | API/security | P0 | Yes | Existing | Restricted fields, media and subresources are unavailable | Retain as critical regression; add deployed check. |
| QA-CIR-004 | Circles | Invited but not joined user reads private content | Resident | API/security | P0 | Yes | Existing | Access denied until membership is accepted | Existing regression. |
| QA-CIR-005 | Circles | Non-organiser mutates settings/members/polls | Member | API/security | P0 | Yes/Partial | Existing | Forbidden; resource unchanged | Expand all endpoints. |
| QA-CIR-006 | Circles | Private Circle SEO/indexing | Guest | SEO/security | P0 | No | Proposed | No sensitive metadata/indexable content | Include OG and image URL. |
| QA-MED-001 | Media | Upload supported JPEG/PNG/WebP/AVIF/HEIC | Authorized roles | API/E2E | P1 | Partial | Proposed | Accepted formats persist and display correctly | HEIC conditional on provider/processing mode. |
| QA-MED-002 | Media | Unsupported/corrupt/oversized upload | Authorized roles | API | P0 | Partial | Proposed | Safe validation error; no orphaned object/record | Existing sniff/processing tests are partial. |
| QA-MED-003 | Media | Replace/delete/retry and variant display | Owner/Admin | E2E/API | P1 | Partial | Proposed | Ownership enforced; UI shows correct persisted variants | Test local/R2/Cloudinary separately. |
| QA-MED-004 | Media | Cross-owner/private asset access | Guest/Other owner | API/security | P0 | Partial | Proposed | Private/reference data cannot be enumerated or exposed | Circle image regressions already cover one path. |
| QA-PRO-001 | Profile | View/edit name, bio, preferences | Resident | E2E/API | P1 | Partial | Proposed | Valid data persists; invalid/request failure preserves form | Include mobile. |
| QA-PRO-002 | Profile | Avatar upload/replacement | Resident | E2E/API | P1 | Partial | Proposed | Correct owner/variant; previous state handled safely | Media dependency. |
| QA-PRO-003 | My Life | Saved/following/bookings/invitations | Resident | E2E/API | P1 | Partial | Proposed | Correct scoped items and empty/error states | Helper/route tests exist. |
| QA-NOT-001 | Notifications | Booking/activity notification persisted and linked | Resident/Vendor | API/E2E | P1 | Partial | Proposed | One correct notification; link opens intended resource | Existing notification/link tests partial. |
| QA-NOT-002 | Chat | Non-member/non-participant reads chat | Outsider | API/security | P0 | Partial | Proposed | Access denied and no message metadata leaks | Circle membership is live-gated; expand other chats. |
| QA-ADM-001 | Admin | Vendor approval/moderation | Admin | API/E2E | P0 | Partial | Proposed | Authorized state transition is audited | Vendor flow route test exists. |
| QA-ADM-002 | Admin | Vendor/resident attempts admin mutation | Non-admin | API/security | P0 | Partial | Proposed | 401/403 and no side effect | Cover every critical admin family. |
| QA-ADM-003 | Admin media | Cloudinary/media pause switches | Admin | API | P1 | Yes/Partial | Existing | Flags honor deployment prerequisites and do not break delivery | Existing admin media tests. |
| QA-RBAC-001 | Permissions | Unauthenticated protected API access | Guest | API/security | P0 | Partial | Proposed | 401 with no sensitive payload | Generate endpoint inventory. |
| QA-RBAC-002 | Permissions | Resident accesses vendor/admin APIs | Resident | API/security | P0 | Partial | Proposed | 401/403; no data leakage | Separate identities/cookies matter. |
| QA-RBAC-003 | Permissions | Vendor accesses resident-only resource as vendor identity | Vendor | API/security | P0 | No | Proposed | No implicit resident privilege | Linked account switch tested separately. |
| QA-RBAC-004 | Permissions | Account/workspace link cannot mint arbitrary identity | Resident/Vendor | API/security | P0 | Yes | Existing | Only explicitly linked counterpart can be selected | Existing manage tests. |
| QA-RBAC-005 | Permissions | Anonymous `X-Client-Id` ownership tampering | Guest | API/security | P0 | Partial | Proposed | Cannot read/mutate another guest's transaction | Critical because header is primary guest ownership key. |
| QA-API-001 | API contract | Critical endpoints return expected 2xx/400/401/403/404/409/422/500 shapes | All | API | P1 | Partial | Proposed | Stable error schema and authorization semantics | Build from mounted route inventory. |
| QA-API-002 | API contract | Unexpected server exception | All | API/E2E | P1 | No | Proposed | Safe 500 body; no secret/stack leakage; UI recoverable | Inject only in test mode. |
| QA-A11Y-001 | Accessibility | Automated critical-page scan | Guest/Resident/Vendor | E2E | P1 | No | Proposed | No critical automated violations | Does not establish WCAG compliance. |
| QA-A11Y-002 | Accessibility | Keyboard navigation/focus/dialog errors | All | E2E/manual | P1 | No | Proposed | Logical focus, visible focus, trapped/restored dialogs, announced errors | Cover sign-in, booking, setup, creation wizard. |
| QA-SEO-001 | SEO | Public detail metadata | Guest | E2E/API | P1 | Partial | Proposed | Correct title, description, canonical, OG and implemented structured data | Server OG tests exist. |
| QA-SEO-002 | SEO | Draft/private/account/payment pages | Guest | E2E/API | P0 | Partial | Proposed | Not indexable; sensitive metadata absent | Verify robots plus per-page directives. |
| QA-SEO-003 | SEO | Prelaunch/public robots and sitemap | Guest | API | P1 | Partial | Proposed | Mode-appropriate crawl rules and URLs | `VITE_LAUNCH_MODE` defaults closed. |
| QA-UX-001 | Responsive | Critical flows at desktop/mobile sizes | All | E2E/manual | P1 | No | Proposed | No horizontal overflow, clipped dialogs, hidden CTA, broken bottom nav | Include keyboard behavior on device/manual. |
| QA-UX-002 | Forms | Failed requests preserve user input and show actionable feedback | All | E2E | P1 | No | Proposed | No silent loss or duplicate submit | Auth, booking, onboarding, creation wizards. |
| QA-PERF-001 | Performance | Critical pages avoid failed/repeated/excess requests | Guest | E2E observation | P2 | No | Proposed | No obvious request loop, giant image, or avoidable map usage | Establish baseline, not premature budget. |
| QA-OBS-001 | Observability | Console, page errors and first-party network failures captured | All | Fixture | P0 | No | Proposed | Evidence attached; documented noise allowlist | Central Playwright fixture. |
| QA-CI-001 | CI | Web build and Vitest on pull requests | System | CI | P0 | No | Proposed | Build/tests gate merge using isolated MySQL | Current workflow does not cover web. |
| QA-CI-002 | CI | Chromium smoke after local/staging deploy | System | CI/E2E | P0 | No | Blocked | Small stable suite runs and publishes failure evidence | Requires environment contract. |
| QA-NAT-001 | Native | Capacitor deep link/payment return/push/keyboard | Resident | Native/manual | P1 | No | Manual | Native shell behavior works on real/simulator devices | Separate from browser Playwright. |

## Initial P0 Journey Mapping

| Journey | Concrete implementation path | Initial automated scope |
|---|---|---|
| QA-001 Authentication | `/signin`, `/login`, resident/vendor/admin APIs and cookie sessions | Resident login/logout/session plus vendor/admin negative boundaries; magic-link via mail sink next. |
| QA-002 Onboarding | `AccountSetupGate`; legacy `/onboarding` → `/bookings?setup=1` | First-login gate, validation, skip/resume/completion, desktop/mobile. |
| QA-003 Discovery → detail | `/home` or `/explore` → centre/club/game/program/experience | Seeded public item, search/filter, correct detail, draft exclusion. |
| QA-004 Booking → payment → confirmation | `/centres/:id` → `/book/:centreId` → Stripe Checkout → `/payment/success` → `/bookings` | Stripe test mode, signed webhook, one confirmed booking, duplicate/capacity checks. |
| QA-005 Host/vendor publish | `/manage` game/host flow or `/vendor/*` concrete editor | Start with the most deterministic implemented publish lifecycle; assert owner isolation and public visibility. |

## Manual Coverage That Must Remain

- Google-controlled popup/consent/account-selection UI and provider-specific cancellation.
- Stripe-hosted Checkout visual/provider behavior beyond deterministic test cards/events.
- Native push delivery, deep links, browser return, mobile keyboard, and real-device layout.
- Full accessibility assessment with assistive technologies.
- Exploratory UX, content quality, and Mapbox gesture behavior on representative devices.

## Approved Foundation Execution

All browser cases below use real frontend code with **mocked APIs**, so they do not complete the real QA-001–QA-005 journeys. Full run: 13 passed / 1 failed. Targeted mobile reproduction: 1 failed with the same obstruction.

| ID | Module | Scenario | Role | Type | Priority | Automated? | Status | Expected Result | Notes |
|---|---|---|---|---|---|---|---|---|---|
| QA-SAFE-001 | QA foundation | Refuse missing/unsafe configuration and disallowed requests | Runner | Unit | P0 | Yes | Pass: 15 cases | Unsafe targets/methods fail before requests | `tests/support/environment.test.ts`; no DB |
| QA-SMK-002 | Application | Landing assets, cookie choice and partner navigation | Guest | Browser/mock | P0 | Yes | Desktop pass; mobile FAIL | Landing usable; consent controls clickable; partner login opens | HC-QA-001 blocks mobile before navigation |
| QA-AUTH-001a | Auth | Resident form loads; create-account link works | Guest | Browser/mock | P1 | Yes | Pass: desktop/mobile | Correct form and route | Does not test valid credentials |
| QA-AUTH-002a | Auth | Injected invalid-login response | Guest | Browser/mock | P1 | Yes | Pass: desktop/mobile | Error shown; email retained; submit re-enabled | Explicit expected 401 only |
| QA-AUTH-002b | Auth | Injected server error | Guest | Browser/mock | P1 | Yes | Pass: desktop/mobile | Error shown; email retained; submit re-enabled | Explicit expected 500 only |
| QA-AUTH-011a | Auth | Guest vendor and admin URL redirects | Guest | Browser/mock | P0 | Yes | Pass: both routes × desktop/mobile | Login form opens after unauthenticated response | Does not prove API authorization |
| QA-UX-001a | UX | Sign-in overflow and keyboard traversal | Guest | Browser/mock | P1 | Yes | Pass: desktop/mobile | No horizontal overflow; email → password focus | Narrow check, not full a11y compliance |
| QA-SMK-001 | API | Health, empty sessions, vendor/admin 401 | Guest | Live read-only API | P0 | Yes | Not executed | Correct JSON/status; redirects not followed | Requires explicitly configured running target |
| QA-OBS-001 | Observability | Record errors and expected-response decisions | Guest | Automatic browser fixture | P0 | Yes | Executed on all 14 browser cases | Unexpected errors fail; attachment records evidence | Actual failure artifacts preserved |
| HC-QA-001 | Mobile UX | Cookie controls unobstructed by navigation | Guest | Browser/mock regression | P1 | Yes | FAIL, reproduced twice | User can choose Necessary only/Accept | Existing mobile landing test remains failing |

## Phase 2 — environment/guard and integration readiness

Execution: safety tests **74 passed**, client **81 passed**, mocked browser **13 passed / 1 failed**. No real API/DB or external-sandbox execution. The real-integration rows below are **plans**, not newly automated tests. `QA_ENVIRONMENT.md` defines endpoints, identities, cleanup and independent runtime-verification requirements.

| ID | Module / scenario | Role | Environment | Backend | Database | External service | Automation level | Priority | Automated? | Status | Expected result / notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| QA-ENV-001 | Inventory local/staging/production/test wiring | Operator | Local source/config audit | Not contacted | Not contacted | Presence/prefix classification only | STATIC REVIEW | P0 | No | Complete | Shared development is not treated as isolated QA; secrets omitted |
| QA-SAFE-001 | Production flags/aliases and read request allowlist | Runner | Local | None | None | None | UNIT | P0 | Yes | Pass: 26 cases | Refuse production process and ambiguous/credential-bearing URLs |
| QA-SAFE-002 | Offline auth integration configuration and refusal | Runner | Proposed local QA | None | None | None | UNIT | P0 | Yes | Pass: 48 cases | Flags/origins/DB naming/account/storage/provider/persona checks; valid config still blocked |
| QA-ENV-002 | Offline preflight on current workspace | Operator | Local | None | None | None | CONFIG CHECK | P0 | Yes | Expected abort, exit 1 | No `.env.test`/QA configuration; zero services contacted |
| QA-ENV-003 | Independent DB/grants/runtime/egress attestation | Harness | Proposed local QA | Real, planned | Real disposable, planned | Denied by network policy, planned | REAL DB / INFRA PLAN | P0 | No | Blocked | Must precede all seeding and integration mutations |
| QA-DATA-001 | Deterministic per-run personas and manifest-owned teardown | All QA personas | Proposed local QA | Real, planned | Real disposable, planned | Disabled | REAL DB PLAN | P0 | No | Planned | No global DELETE/reset-demo; repeat twice without residue |
| QA-AUTH-REAL-001 | Real browser login, identity, refresh, logout and replay | User / vendor | Proposed local QA | Real, planned | Real, planned | Disabled | REAL E2E PLAN | P0 | No | Blocked | At least one complete UI login; other tests use real API storage state |
| QA-AUTH-REAL-002 | Wrong/unknown password, expired/invalid session | User / host / vendor / admin | Proposed local QA | Real, planned | Real, planned | Disabled | REAL API PLAN | P0 | No | Blocked | Correct errors, no unauthorized session, isolate expiry/logout sessions |
| QA-RBAC-REAL-001 | Guest/resident cannot call vendor/admin routes | Guest / user / host | Proposed local QA | Real, planned | Real, planned | Disabled | REAL API PLAN | P0 | No | Blocked | Real middleware; no injected req.user; deny with unchanged DB state |
| QA-IDOR-REAL-001 | Host B cannot edit/cancel/lifecycle-update Host A game | Host A/B / user | Proposed local QA | Real, planned | Real, planned | Disabled | REAL API PLAN | P0 | No | Blocked | Valid request reaches owner guard; public reads handled separately |
| QA-IDOR-REAL-002 | Vendor B cannot GET/PUT/DELETE Vendor A centre | Different-org vendors | Proposed local QA | Real, planned | Real, planned | Disabled | REAL API PLAN | P0 | No | Blocked | Different orgs; owner positive control; no side effects |
| QA-IDOR-REAL-003 | Private Circle fields/subresources require membership | Organiser / member / outsider | Proposed local QA | Real, planned | Real, planned | Disabled | REAL API PLAN | P0 | No | Blocked | 200 teaser can be intentional; private sentinel fields absent; internal routes denied |
| QA-IDOR-REAL-004 | Profile/booking ownership via cookie/client ID | User A/B / guest | Proposed local QA | Real, planned | Real, planned | Disabled | REAL API PLAN | P0 | No | Blocked | Test actual /me, cancel/reschedule endpoints, not invented generic CRUD |
| QA-IDOR-REAL-005 | Media reference/release/private-cover ownership | Owner / outsider | Later isolated media QA | Real, planned | Real, planned | Isolated storage required | REAL API / MEDIA PLAN | P0 | No | Deferred | A missing-image 404 does not validate membership checks |
| SEC-REVIEW-001 | Signup against existing passwordless resident | Signed-out outsider | Source review; future QA reproduction | Not contacted | Not contacted | None | STATIC SECURITY REVIEW | P0 candidate | No | Needs isolated reproduction | Possible password/session issuance without ownership proof; do not treat as expected success |
| HC-QA-001 | Cookie controls obscured by mobile navigation | Guest | Local 390×844 | Mocked APIs | None | Stubbed assets | MOCKED BROWSER | P1 | Yes | FAIL again, unchanged | Evidence in test-results/phase2; product fix outside this checkpoint |

Google provider UI remains MANUAL; HelloCircle token/completion/linking tests with stub verification are distinct from real Firebase integration. Stripe, media-provider and payment-integrity automation remain deferred. No critical real journey is marked complete on the basis of mocked results.
