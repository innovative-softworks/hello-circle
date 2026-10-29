# 12 · Phase 2 implementation report: attendees, questions and door check-in

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2`, from Phase 1 (`cc2def1`), in worktree `../hello-circle-participation-p1`.
**Not committed, not pushed, not deployed.** Every new switch is off by default. `participation.partial_cancel` and the new `participation.special_category_questions` are locked.
**Scope:** experiences and community events (the Phase 1 surface). Hall bookings, club registrations, programmes and games are unchanged.

The permission audit (step 1) is in [11-phase2-rbac-audit.md](11-phase2-rbac-audit.md).

## 1. Permission extensions (smallest set; no parallel role system)
| # | Extension | Where |
|---|---|---|
| X1 | **`checkin_staff`** is one more value in the existing organisation role list (`users.platform_role`), labelled "Check-in only". It's for invited staff only. `hasPlatformRole` grants it no existing gate. `requireVendor` limits it to **`/api/vendor/door/*`**. Chat, media upload and `requireVendorOrAdmin` refuse it too. The client shows it only the Check-in page | `auth.ts` (`checkinOnly`, allow-list), `routes/org.ts`, `routes/admin.ts`, `routes/chat.ts`, `routes/media.ts`, `packages/types`, `vendorTabAccess.ts` |
| X2 | **`listing_staff_assignments`**: a Check-in-only member is assigned to one listing or one date. Owners and the two managers assign; the assignment is re-read on every door request. Revoking it, removing the member (D-08) or suspending the organisation (D-01) stops access on the next request | `participation/checkin.ts` `doorScope`, `routes/vendorAttendees.ts` |
| X3 | **Role groups reused per route:** attendee list (contacts and answers) = `ROSTER_ROLES`; question set and staff assignment = the two managers; attendance summary counts = `ROSTER_ROLES` + `read_only_analyst`; door = owner and managers for every listing, `checkin_staff` where assigned. Finance and communications get nothing new | `routes/vendorAttendees.ts`, `routes/vendorDoor.ts` |
| X4 | **Door payload** never carries amounts, email or phone (checked by a test on the raw JSON) | `participation/checkin.ts` `doorViews` |
| X5 | **Switches** (admin Settings → Community events and registration): `participation.attendees`, `participation.checkin` (off); `participation.special_category_questions` (**locked**) | `circleFeatures.ts` |

**Admin:** no new admin permission or admin screen. Admin accounts can't reach partner routes (unchanged).

## 2. Schema (additive, idempotent, no FKs, no backfill)
| Change | Purpose |
|---|---|
| `booking_attendees` (UNIQUE source_type, source_ref, attendee_no) | One row per person: adult/child, order line, name, guardian (`contact` or an adult `attendee_no`), active/removed |
| `registration_questions` | Question sets, saved whole under `experiences.questions_version`. Rows are switched off, never deleted; `qkey` stays stable across versions |
| `registration_answers` (UNIQUE ref, attendee_no, qkey) | Answer plus a snapshot of the label, type, choices and door visibility at answer time. `attendee_no 0` = booking-level |
| `attendee_checkins` (UNIQUE source_type, source_ref, attendee_no) | One check-in per person; the unique key stops duplicates and races |
| `listing_staff_assignments` (UNIQUE `active_key`, NULL once revoked) | X2 |
| `experiences.questions_version INT NOT NULL DEFAULT 0` | Optimistic concurrency for the question builder |

**How it works with existing data:**
- **Older bookings:** no rows are needed. People are read from `party_size`, the seat names and the order lines, so check-in, My Life and the attendee list work the same for bookings made before Phase 2 or with the switch off.
- **Seat names:** `experience_booking_participants` is still written for every booking (from the attendee names when given).
- **Booking-level attendance:** the first door check-in sets the existing `attendance` row to `present` (source `door`). Reviews eligibility, attendance history and corrections are unchanged. Undoing the last door check-in removes only a `door`-sourced row.
- **Partial cancellation (still locked):** removing heads from a line marks that line's last attendees `removed`.
- **Abandoned checkout:** a deleted pending order also deletes its attendees and answers (`endPendingHold`).

**Verified:**
- applied on the worktree dev database, which holds Phase 1 data: the Phase 1 Stripe booking `EX-394953` is unchanged;
- applied on every fresh test database (server suite and QA).

## 3. APIs
| Route | Who | Notes |
|---|---|---|
| `GET /api/experiences/:id` → `registration.attendeeDetails` | public | `{questions, questionsVersion}` while switched on, else `null`; no internal category or ids |
| `POST …/checkout` + `attendees`, `answers`, `questionsVersion` | booker | validated on the server against the slots the order bought; 409 `questions_changed` on a stale version; 400 `attendees_invalid` / `answer_required` |
| `GET /api/experiences/bookings/:ref/details` | booker (device **or** resident account) | people, answers, check-ins, `canEditAnswers`, `missingAnswers`; no amounts |
| `PUT /api/experiences/bookings/:ref/answers` | booker, paid + active + before start | edits current-version answers; answers to removed questions are kept as given |
| `GET/PUT /api/vendor/experiences/:id/questions` | read: members · write: managers | 409 when stale; 400 `special_category` |
| `GET /api/vendor/experiences/:id/attendees` | `ROSTER_ROLES` | contacts, people, answers, check-ins, head-count reconciliation issues |
| `GET /api/vendor/experiences/:id/attendance-summary` | `ROSTER_ROLES` + analyst | counts only |
| `GET/POST/DELETE /api/vendor/experiences/:id/checkin-staff` | read: roster · write: managers | only same-organisation Check-in-only members |
| `GET /api/vendor/door` | door scope | the next 7 days the caller may check in |
| `GET /api/vendor/door/sessions/:id` | door scope | door list and counts |
| `POST /api/vendor/door/sessions/:id/lookup` | door scope | QR or typed reference. Another listing's pass gets a 404 `other_listing` that never says whose it is |
| `POST /api/vendor/door/sessions/:id/checkins` | door scope | `{ref, attendeeNos[]}`. The booking row is locked; refused unless paid, active, this date and today. A repeat check-in returns `already` |
| `DELETE /api/vendor/door/sessions/:id/checkins/:ref/:no` | door scope | undo, audited |

**Audit rows:** `experience.questions_saved`, `experience.checkin_staff_assigned` / `_revoked`, `experience_booking.checked_in` / `checkin_undone`, `experience_booking.answers_edited` (question keys only, never values).

## 4. UI
- **Resident booking popup:** "Who's coming" section:
  - a name for each person, prefilled from the booking name;
  - adult or child (fixed when the option has an age band);
  - who looks after each child (the booker or an adult in the booking);
  - the organiser's questions under each person, then the booking questions, each with **"Why we ask"** and a note when door staff see the answer;
  - all through the shared form error summary.
- **My Life booking page:** "Who's coming" card:
  - each person's type, option, guardian, answers and check-in time;
  - "Answer now" when the organiser added a required question after purchase;
  - "Change answers" until the start.
- **Partner event record page (70/30 shell, new tabs):**
  - **Questions:** visual builder with type, scope, who answers, choices, limits, required, door visibility, move up/down, remove. Sensitive categories show as disabled ("needs policy approval").
  - **Attendees:** summary stats; date filter and search; people with guardians, options, answers and check-in times; head-count warnings; **Open door mode** for today; **Check-in staff** assignment.
- **Check-in in the partner navigation:** visible to owners, managers and Check-in-only staff. For Check-in-only staff it is their whole workspace, and `/vendor` sends them there.
- **Door screen (`/vendor/door/:sessionId`):** phone-first page with no workspace navigation:
  - live counter and progress bar;
  - **Scan a pass** (existing camera and QR reader) and search by name or reference;
  - group card: tick who is arriving now, "Check in 1 of 2", undo per person, and a red refusal for cancelled, refunded, unpaid or wrong-date bookings;
  - refreshes every 20 seconds for several devices at one door.
- No side drawers, no new shell, no new admin system.

## 5. Privacy decisions in code
- Special-category questions are **refused** while the locked switch is off, both by the category the partner picks and by wording. The refused wording covers health, allergies, disability, religion, faith, caste, **gotra**, ethnicity, sexual orientation, political and trade-union topics.
- **Note for KNOTS:** a gotra question for the Pooja sankalpam is refused until a policy is approved.
- **Data minimisation:**
  - at most 12 questions;
  - each must say why it's asked (shown to people);
  - unknown answer keys are dropped, never stored;
  - answers are 500 characters at most.
- **Visibility:** partners read answers but can't edit them. Door staff see only the answers people were told the door sees, frozen at answer time. Answer values are never written to the audit log.

## 6. Test results (final code)
| Check | Result |
|---|---|
| Type-check: server, client, QA harness | pass |
| Production build | pass |
| Server suite (disposable MySQL) | **137 files, 1,273 passed, 0 failed, 23 skipped** (live R2/Cloudinary provider tests, off by design) |
| New `participation2.test.ts` (real vendor router, real `requireVendor`) | **19 / 19** |
| Client unit | 45 files, **347 passed** (new `attendeeSlots.test.ts`; `vendorTabAccess.test.ts` updated for the Check-in page and role) |
| QA harness self-tests | **100 passed** |
| New guarded browser batch `booking-event-attendees` (isolated QA, offset 10) | **4 / 4**: partner, resident desktop, resident mobile, door staff on a phone |
| Phase 1 batch `booking-event-options` | 4 / 4 |
| Guarded regression: every batch of `booking`, `authorization`, `product`, `revenue` | **90 batches: 225 passed, 8 failed, 3 skipped**. All 8 failures are the pre-existing ones that fail identically on the untouched base `f22294f` (report 10 §5): BK-UI-DESKTOP, HC-QA-043, HC-QA-066, HC-QA-068, HC-GAP-UI-EXP, PUB-05/33, PUB-21/22/23, B2-LISTS. Skips are the known REM-046 split and PERF-P13. **No new failure** |

**Found and fixed during QA:** the partner dashboard crashed for a Check-in-only account (it looked up the Overview tab that role can't see) before redirecting to `/vendor/door`. It now shows a spinner and redirects. The browser test covers it.

### Security scenarios (brief §7) → tests
| # | Scenario | Covered by |
|---|---|---|
| 1 | Resident opening another resident's booking | `participation2` #1: other device or other resident → 404 for details and answer edits; same resident on a new device → 200 |
| 2 | Partner reading another organisation's attendees | #2: attendees 403, door 404, check-in 404; another organisation's pass scanned at our door → 404 `other_listing` |
| 3 | Host making unauthorised event changes | resident-only session → 401 on questions and options; communications, finance and other organisation → 403; check-in staff → 403 `checkinOnly` |
| 4 | Check-in staff reaching payment information | #4: the raw door JSON has no email, phone, cents, total, amount or price; 10 partner routes → 403 (API test); browser test repeats it from the staff member's session |
| 5 | Revoked staff checking people in | #5: revoked assignment → 403; removed member → 403 `removedFromOrg`; unassigned colleague → 403; assigned to one date → 403 on another |
| 6 | Suspended organisation | #6: 403 `orgSuspended` at the door |
| 7 | Invalid and duplicate QR | #7/#8: not a pass → 400; unknown reference → 404; second scan → `already`; two simultaneous check-ins of one person → one `checked_in`, one `already`, one row |
| 8 | Part of a group arriving | #8 and the browser test: 1 of 2 checked in, the rest later; undo; counts and summary |
| 9 | Older bookings without attendee records | #9: people from seat names; check-in person 2; My Life shows them |
| 10 | Cancellation and refund | #10: cancelled, refunded, unpaid and other-date bookings refused at lookup and check-in; cancelling after a check-in refuses further check-in, leaves the booking off the door list and keeps the check-in record; answers can't be edited |
| 11 | Question changes after purchase | #11: old answers keep their wording and version; the new required question shows as missing; a stale version is refused at checkout and at edit; the edit uses the new wording |
| 12 | Mobile and desktop | browser batch: resident on 1440 and 390 wide (no sideways scroll); door on 390 |

## 7. Screenshots (`phase2-screenshots/`)
| File | Role | Screen |
|---|---|---|
| `phase2-01` | partner manager | Questions builder with a door-visible question |
| `phase2-02` | partner manager | sensitive question refused, with the error summary |
| `phase2-03` | resident, desktop and mobile | booking popup, "Who's coming": child with guardian, questions with "Why we ask" |
| `phase2-04` | resident, desktop and mobile | My Life booking page, "Who's coming" |
| `phase2-05` | Check-in only, phone | the Check-in page (their whole workspace) |
| `phase2-06` | Check-in only, phone | door screen: 1 of 2 in a family checked in |
| `phase2-07` | Check-in only, phone | cancelled booking refused at the door |
| `phase2-08` | partner owner | Attendees tab: summary, people, check-in time, Open door mode, Check-in staff |

## 8. Known gaps and recommendations
1. **Only experiences and events.** Halls, clubs, programmes and games keep their own check-in. Extend the same tables (they're keyed on `source_type`) when needed.
2. **Self-serve data export** (`GET /residents/me/export`) doesn't include attendees or answers yet. Erasure is a manual admin process today, and these tables must be added to its checklist. **Do both before switching `participation.attendees` on in production.**
3. **No retention rule for answers.** Recommend deleting answers N days after the event (owner decision).
4. **Attendee names can't be changed after booking** (answers can). Name changes go through the organiser for now.
5. **Check-in opens on the day only (Ireland date).** Late arrivals after midnight need a manager to record attendance with the existing per-booking tool.
6. **Door staff can undo check-ins** in their scope (audited). If owners want undo limited to managers, it's a one-line change.
7. **Partner answer editing isn't offered** (by design). Corrections go through the booker.
8. **Special-category questions** need a policy (lawful basis, explicit consent wording, retention, who sees them) before the lock is lifted.
