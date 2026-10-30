# 03 · Resident and host audit

## 1. Resident capabilities
| Area | Status | Evidence (code) |
|---|---|---|
| Explore, search, filters, map | Implemented and verified | `pages/Browse.tsx`, `DiscoveryMap`; public reads add `orgActiveSql` (D-01) |
| Saved listings | Implemented and verified | `routes/favourites.ts`, 8 types: centre, club, game, program, program_session, club_session, experience, circle |
| Free Time Mode | Implemented | `pages/FreeTimeMode.tsx`; `experience.*` switches (`circleFeatures.ts`) |
| Activities (resident-hosted) | Implemented and verified | `routes/games.ts` |
| Events, experiences, adventures, volunteering | Implemented and verified | `experiences.kind` = experience \| adventure \| event \| volunteer (`vendorExperiences.ts:75`) |
| Programmes | Implemented and verified | `routes/programs.ts`; progress server-tested only |
| Clubs | Implemented and verified | `routes/registrations.ts` (free-text medical no longer collected, D-A4) |
| Halls and venues | Implemented and verified | `routes/bookings.ts` |
| Circles | Implemented and verified | `routes/circles.ts`, visitor page behind `circles.visitor_experience` |
| My Life | Implemented and verified | `/api/my-life`, `myLifePlans.ts` (games, programmes, circles in own history) |
| Registration answers: view, edit permitted, status | Implemented and verified | `/api/orders/:source/:ref/*` (`participation/orderRecords.ts`), locked answers by field policy |
| Notifications | Implemented | `/residents/me/notifications`; reminders **off** (`participation.reminders`) |
| Reviews | Implemented and verified | eligibility after attendance; a no-show blocks a review (`reviewEligibility.ts`) |

**Actions:** discover ✓, save ✓, join ✓, request to join ✓ (approval-mode activities and Circles), waitlist ✓ (activities, clubs; experiences use spot alerts, never a hold), register ✓, book ✓, answer questions ✓, view own registration ✓, edit permitted answers ✓, cancel within policy ✓ (partial group cancel **locked**), view attendance ✓ (My Life "missed" or "attended"), joining instructions ✓ (`meeting_instructions` only to host and joined people), own history ✓.

**Isolation:** another resident's order returns 404 (FINAL-SEC, IDOR-BOOKING, STAGE-B-BOOKING, re-run today: passed). Host answers are never in the public participant preview (`gameQuestions.test.ts`).

## 2. Host capabilities
**Who is a host:** any signed-in resident. `POST /api/games` needs only `requireResident`. **Paid** activities need `residents.host_status = 'verified'` (`mayHostPaid`). No organisation is created or needed. Matches discussion 4 ("A host does not need to become a vendor").

| Area | Status | Evidence |
|---|---|---|
| Overview: hosted, upcoming, counts, status, pending requests, attendance | Implemented | Host workspace (`HostWorkspace.tsx`: Overview, Activities, Reservations, Calendar, Circles, Insights, Earnings, Reviews, Offers); `GET /api/games/mine`, `/host/insights` |
| Title, description, category, subcategory | ✓ | `categoryFromBody("game")`, taxonomy family `activity` |
| Photos | ✓ | game cover upload (existing media pipeline) |
| Date, start time, duration (end) | ✓ | `date`, `time`, `duration_minutes` |
| Location | ✓ | `centre_id` (venue) or `location_text`; venue reservation via host Reservations |
| Capacity, minimum participants | ✓ | `capacity`, `min_participants` → `pending_participants` |
| Skill level, equipment | ✓ | `skill_level`, `equipment_needed`, `experience_required` |
| Age eligibility | ◐ | `min_age` only; no safeguarding rules per category |
| Visibility | ✓ | `public` \| `circle` \| `invite` |
| Joining rules | ✓ | `join_mode` (instant / approval), `booking_open_at` / `booking_close_at` |
| Draft and publishing | ✓ | `lifecycle` = draft \| coming_soon \| active, `publish_at` |
| Circle association | ✓ (as organiser) / ◐ (as member: proposal) | `circleId` / `planId` (organiser only, `games.ts:1804`); `shareToCircleId` for members |
| Edit, move, cancel | ✓ | `PUT /:id`, `/move`, `/cancel` (host only) |
| Recurring | ✓ | `/series` + cancel remaining |
| Duplicate | ✓ (client prefill) | `HostActivitiesTab` "Duplicate", `rehost.ts` |
| Participants, approvals, waitlist, remove, refund | ✓ | host-only handlers |
| Instructions and updates | ✓ | `meeting_instructions`, `POST /:id/updates` (notifies), activity chat |
| Attendance | ✓ | per-person host check-in; **no-show** (`/no-show`) |
| History | ✓ | Insights, past activities |
| Co-host | **Missing** | no column or table |
| Archive | **Missing** (implicit) | no archive lifecycle; past and cancelled drop out of lists |

## 3. Approved host questions (`participation/gameQuestions.ts`) — **switch off**
Tested in the isolated test database only. The switch was turned on inside the test and never in dev or prod.

| Check | Result | Evidence |
|---|---|---|
| Off by default: nothing asked, set-up refused | PASS | `gameQuestions.test.ts` "are off by default"; `PUT /:id/questions` → 404 while off |
| Library only (5 approved questions), no own wording | PASS | library keys only; unknown keys refused |
| Maximum 3 | PASS | test "host-only, library-only, at most three" |
| Answer validation at join, before a place is taken | PASS | `form_required`, `questions_changed`, `answer_required` |
| Host-only visibility | PASS | `/participants/manage` shows answers; public preview never does; another resident 403 |
| Sensitive questions impossible | PASS | the library has no sensitive item; special categories locked platform-wide |
| Direct API bypass while off | PASS | set-up 404; join answers ignored |
| Vendor form builder on a game | PASS | `/vendor/forms/game/*` → 404 |
| Answers removed on leave, remove, decline, withdraw | PASS | test "leaving takes the answers with it" |

**Correction to the product discussions:** they say "host questions **and no-show** are built but switched off". Only the questions are behind `participation.host_questions`. The **no-show button and route have been live for every host since Phase N.** This audit added the missing "not before the activity day" rule ([11](11-gap-register.md) RAV-DEF-01).

## 4. Host restrictions (verified)
| Restriction | Result | Evidence |
|---|---|---|
| Another host's records | 403 | 23 host-only handlers; FINAL-SEC, IDOR-HOST; `roleSeparation.test.ts` |
| Organisation registration answers | unreachable | a resident session has no `req.user`; `/api/vendor/*` → 401 (`roleSeparation.test.ts` test 18) |
| Unrestricted vendor forms | 404 | `vendorForms.ts` refuses `game` |
| Staff, finance, capabilities | unreachable | partner and admin routes need `req.user` |
| Unrelated Circle membership data | 403 | `isMember` / `isOrganiser` per Circle; Circles suites |
