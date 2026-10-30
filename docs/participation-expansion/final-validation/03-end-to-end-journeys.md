# 03 · End-to-end journeys A–J

**Commit:** web `d22f4a6`.
**Environment:** isolated QA, real UI (Chromium, desktop 1440 and phone 390) and real API sessions, with synthetic personas.

**How to read this:** each journey is validated by the browser batches named in its table. Each batch drives the real UI and/or the real API end to end for its segment.
- **Only journey E** was written as **one continuous scenario** for this validation (new batch `booking-config-host-questions`).
- The others are **composed** from batches that each cover a contiguous part of the journey. They ran in the same full regression on the same database, but not as one script.
- Where a segment has only server-test evidence, or none, that is stated.

Result key:
- **VALIDATED:** every step has passing UI/API evidence.
- **VALIDATED (composed):** every step is covered, across more than one batch.
- **PARTIAL:** at least one step isn't covered.
- **NOT TESTED.**

## A · Community event: VALIDATED (composed)

| Step | Evidence (batch → test) |
|---|---|
| Admin enables capability | `booking-config-capabilities` → CFG-CAPABILITIES (template with review; partner workspace and API follow) |
| Vendor creates event, selects category | `validation-categories` → CAT-VENDOR (wizard Basics stores the category); BK-EVENT-PARTNER (options) |
| Configures form, publishes | `booking-config-forms` → CFG-FORMS (template → draft → condition → preview → publish → history) |
| Resident registers, answers saved, booking confirmed | CFG-FORMS (guest answers); `booking-event-options` → BK-EVENT-DESKTOP / -MOBILE (server totals) |
| My Life updated | BK-EVENT-DESKTOP / -MOBILE ("finds the lines in My Life") |
| Vendor sees registration | `booking-event-attendees` → P2-PARTNER; CFG-OPERATIONS (one record) |
| Staff checks in | P2-DOOR (check-in-only staff, partial group, on a phone) |
| Report reconciles | CFG-OPERATIONS (Reports tab); `vendorReports.test.ts` (exact counts, see [08](08-communications-and-reporting.md)) |

## B · Sports club: VALIDATED (composed)
- **Club manager creates the registration form:** CFG-UNIVERSAL (club form published by the partner).
- **Parent or adult registers; fixed and custom fields validated:**
  - CFG-UNIVERSAL;
  - CFG-OPERATIONS (child registration, version 2 adds a required question, the resident answers on a phone);
  - BK-CLUB-LIFECYCLE.
- **Club sees permitted answers:**
  - CFG-OPERATIONS: the owner sees them;
  - finance doesn't;
  - check-in-only staff get 403.
- **Resident views their registration:** CFG-OPERATIONS (My Life: version, locked answer).
- **Attendance recorded:** registration check-in (`POST /api/vendor/checkin/registration/:ref`) was exercised 30 times in FINAL-PERF; club check-ins appear in the per-listing report detail (not in the summary, DEF-05).

## C · Programme: PARTIAL
- **Vendor creates the programme; resident enrols:** BK-PROGRAM-LIFECYCLE, BK-PROGRAM-CONCURRENT-BOUNDARY.
- **Registration questions captured:** CFG-UNIVERSAL (programme form).
- **Session attendance recorded:** ATTENDANCE-WRITE, ATTENDANCE-READ (authorisation-scoped register).
- **Progress updated:** `vendorPrograms.test.ts` (server only, no browser).
- **Completion criteria applied:** **NOT APPLICABLE / BLOCKED.** No completion threshold exists by owner decision; "finished" means every session is past.
- **Resident and vendor views reconcile:** programme journey (Experience 3.0 suites) plus the partner register; no single reconciling test.

## D · Hall booking: VALIDATED (composed)
- **Centre manager configures hall questions:** CFG-UNIVERSAL (hall form, venue pages on).
- **Resident books; answers validated:** CFG-UNIVERSAL; `compatibility.test.ts` (a hall with a form refuses a form-less path).
- **Staff see permitted setup requirements:** CFG-UNIVERSAL (partner reads answers); team notes (`vendorOrders.test.ts`, server).
- **Calendar reflects the booking:** BK-CENTRE-LIFECYCLE (persist, availability); `booking-ui` BK-UI-DESKTOP "view and cancel a hall booking" is a **baseline failure** (timeout, same signature on `f22294f`).
- **Cancellation and changes:** BK-CENTRE-LIFECYCLE (reschedule, cancel idempotently, rebook, vendor cancel); STRIPE-REFUND-HALL.

## E · Resident-hosted game: VALIDATED (one continuous run)
New batch `booking-config-host-questions` → **CFG-HOST-QUESTIONS: PASSED.** Steps:
1. The switch `participation.host_questions` is turned on **in the isolated QA DB only**; the spec asserts its original value is restored afterwards.
2. The host creates an activity.
3. **Host-only, library-only:**
   - a resident's PUT of questions gets 403;
   - a custom "Any medical conditions?" question gets 400;
   - two approved questions (one required) are saved.
4. A resident joins **on a phone**, sees "A few questions from the host", and can't confirm until the required answer is given. They answer and confirm (screenshot `screenshots/config-50-resident-host-questions-phone.png`).
5. The answers are stored with label snapshots.
6. Another resident gets 403 on the manage view, and sees no answers in the public participant list.
7. The host sees "Your level: Intermediate" in Manage and marks "Didn't come". Attendance is `no_show` (screenshot `screenshots/config-51-host-answers-no-show.png`).
8. The resident leaves, which deletes their answers.

**Production configuration:** off by code default. It wasn't inspected on production (no access), so it's an operator check before release.

## F · Group or family booking: VALIDATED (composed)
- **Multiple attendees, attendee-level answers:** P2-PARTNER; `participation2.test.ts` "books with attendees and answers; heads reconcile with lines and capacity".
- **Capacity correct:** BK-EXPERIENCE-INTEGRITY (party sizes, held capacity); STRIPE-CONCURRENCY.
- **Passes generated:** one booking pass, used at the door. Per-person passes **aren't built** (doc 25 O1).
- **Partial check-in:** P2-DOOR.
- **Group records reconcile:** `participation2.test.ts` (heads = lines = capacity).
- **Partial group cancellation:** **locked** (`participation.partial_cancel`).

## G · Volunteering: PARTIAL
- **Volunteering is modelled as an experience of kind `volunteer`.** It uses the Volunteer registration template, options as roles with limits, sessions as shifts, and door check-in for attendance.
- **Covered generically:** the experience path is validated (CFG-FORMS, BK-EVENT-*, P2-DOOR).
- **No batch creates a `volunteer`-kind listing specifically, so that's NOT TESTED as a distinct journey.**
- **Coordinator approval** of applicants **isn't built.** Bookings confirm directly (doc 25 O4).

## H · Communication: VALIDATED
- **Vendor selects permitted recipients, previews, sends a test, sends:** CFG-MESSAGES (UI, after fix `d22f4a6`). The resident gets it in the app.
- **Recipient isolation:** `vendorMessages.test.ts` (another organisation, finance); FINAL-SEC (preview and send to another organisation → 403).
- **Delivery status and retries:** `vendorMessages.test.ts` (status history, at most 3 attempts).
- **Audit record:** `vendor_message.sent` (counts only).

## I · Reporting: VALIDATED
Deterministic dataset with hand-computed expected values (registrations, attendees, attendance, capacity, cancellations, repeat participation, form completion), plus filters and export permissions: see [08](08-communications-and-reporting.md) §3.
- **Live stack:** FINAL-PERF reads the report, the listing detail and both CSVs on 30 synthetic registrations; the answers CSV has 30 rows.
- **Defects:** DEF-04 (event no-shows counted per booking) and DEF-05 (club check-ins missing from the summary).

## J · Configuration change: VALIDATED (composed)
- **Admin disables a capability or category, so new creation is blocked:** CFG-CAPABILITIES (the partner API follows the template); CFG-CATEGORIES (the picker and API follow; **legacy listings keep theirs**).
- **Existing bookings preserved:** BK-EVENT-OFF (switches off: events leave public lists, options can't be booked); `participation.test.ts` "new registration pauses; existing orders still show lines and can be cancelled".
- **Vendor navigation updated:** CFG-CAPABILITIES (dynamic partner navigation).
- **Direct API bypass refused:** CFG-CAPABILITIES, CFG-CATEGORIES (API refusals); FINAL-SEC (a vendor can't change its own capabilities).

## Make It Happen (paused): validated as paused
- **Switch:** `commerce.open_booking` is not `true` in QA (asserted in FINAL-SEC).
- **Direct API, paused:** `POST /api/make-it-happen/search` and `/confirm` return **503** and create no booking (FINAL-SEC).
- **Server path ready, not used:** with the switch on, inside the disposable server-test DB only (`compatibility.test.ts`):
  - a venue with a published form is refused (`409 form_required`) without answers;
  - answers are validated and stored when sent.
- **Not reactivated.**
- **Missing for reactivation:**
  - web and app Make It Happen screens that render and submit the venue's form;
  - an end-to-end browser pass;
  - owner approval.

  Until then, venues with forms are excluded from its search.
