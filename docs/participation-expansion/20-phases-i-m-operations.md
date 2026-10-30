# 20 · Phases I–M: registration after booking, partner operations, communication, reports, compatibility

**Date:** 2026-10-30.
**Branch:** `feature/participation-phase2`. Committed locally in small phases; not pushed, not deployed.
**Builds on:** Phase 2 (attendees, answers, check-in), Phases F–H (field registry, builder, universal forms).
**Nothing duplicated:** every view reads the existing order, attendee, answer, attendance and audit rows.

## 1. Existing implementation audit
| Area | Before | Gap |
|---|---|---|
| Resident booking page `/bookings/:kind/:ref` | Experiences showed people, answers, door check-in and answer editing (`BookingPeople`). Every kind showed pass, policy and cancel | Clubs, programmes and halls showed no registration at all. No form version, no "can't be changed" label, no general "needs attention" |
| Partner booking views | Hall booking: 70/30 record page with check-in and change history. Experience: Attendees tab cards. Clubs: registrations table rows. Programmes: enrolments table | No record page for registrations, enrolments or experience bookings. Programme enrolments had no cancel/refund in the UI (the API existed). Answers lived only on the Phase H Questions tab. No change history except for hall booking changes |
| Roles | `ORDER_ROLES` (both managers + finance) read orders and contacts; `ROSTER_ROLES` (managers) read rosters. Check-in-only staff are allow-listed to `/vendor/door` | Nothing yet decided who may read registration answers across types |
| Notifications | New booking or registration (guest email, vendor and admin in-app and email, resident in-app), cancellation, refund, hall change proposals, partner messages, waitlist, Circle plan reminders | No notice when answers change. No booking reminder: the resident's "Booking reminders" preference was stored but never read |
| Reports | Bookings CSV (finance, analyst), statements, demand, liquidity | No participation report (attendance, capacity, cancellations, form completion). No answers export for clubs, programmes or halls |
| Entry points | Web checkouts for all four types. Mobile app (separate repo) calls the same APIs. Make It Happen (paused) books halls through `createBookingInternal` with no form | Make It Happen could book a hall that asks questions without asking them. An app sending no form got a misleading "questions changed" |

## 2. Phase I: resident registration management
- **One read for all four order types:** `participation/orderRecords.ts` (`ownedOrder`, `registrationView`, `saveOrderAnswers`). Routes: `GET /api/orders/:source/:ref/registration` and `PUT …/answers`, where `source` is `experience | registration | program | booking`.
- **Ownership.**
  - Same rule as the existing "my …" lists: this browser's guest id or the signed-in resident, plus the verified email for club registrations and hall bookings.
  - Someone else's reference reads as "not found".
  - A reference of one type can't be read as another.
- **What the resident sees** (`BookingPeople`, now on every type):
  - **People:** an experience's group, a club's registrant or a programme's participant. A hall booking has none.
  - **Answers:** with the question wording they were given on, and "Answered on form version N". If the organiser has since changed the form: "your answers are kept as you gave them".
  - **Locked answers:** marked "can't be changed".
  - **Attendance:**
    - per person at the door (experiences);
    - checked in or not attended (halls, clubs);
    - "attended N of M sessions" (programmes).
  - **Attention:** "Needs your attention — the organiser is waiting for: …" when a required question has no answer, for example one added in a later version.
  - **When it can't be edited**, the reason (cancelled, started, finished, unpaid).
  - **Booking instructions** stay where they were (the existing "get ready" sections).
- **Editing rules.**
  - The live form, its version, required answers and conditions apply, as at booking.
  - A "can't be changed after booking" answer keeps what was given.
  - Editing is allowed only on confirmed (paid), not cancelled bookings:
    - experiences and halls until the start;
    - programmes until the last session day;
    - clubs while the registration is active.
  - Price, places, dates and payments are never touched.
- **Audit and notice.** Each change is audited (`<type>.answers_edited`, question keys only, never the answers), and the partner gets an in-app note without the answers (Phase K).

## 3. Phase J: unified partner operations
- **The record.** `GET /api/vendor/orders/:source/:ref` and the page `/vendor/orders/:source/:ref`, using the existing 70/30 `RecordView` (no drawer). It shows:
  - status and payment chips;
  - the key numbers: when, people, attendance and answers;
  - the people and their answers;
  - the hall booking's notes;
  - contact details;
  - a history built from the audit log: Booked, then labelled events such as "Answers changed by the person who booked", "Cancelled by the organiser" and "Refunded". Labels only; never values.
- **Linked from:**
  - club registration rows (Bookings → Club registrations);
  - programme enrolment rows;
  - experience attendee cards;
  - the Phase H answers list.
- **The hall booking record** keeps its own page and gains the registration answers section.
- **Who sees what:**

| Role | Record (status, contact, people, attendance, history) | Registration answers | Cancel | Refund |
|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | ✓ |
| Listing's manager (halls: centre manager; clubs: facility manager; programmes: by parent; experiences: either) | ✓ | ✓ | ✓ | — |
| Other manager | ✓ | — (count only) | — | — |
| Finance | ✓ | **— (count only)** | — | ✓ |
| Communications, read-only analyst | 403 | — | — | — |
| Check-in only | 403 (allow-list): only the door screen's minimal admission data | — | — | — |

- **Actions:**
  - They use the existing endpoints, with the same roles they already enforce: registration and programme cancel/refund, experience cancel/refund.
  - A hall booking keeps its own record's actions.
  - Programme enrolments gained cancel and refund in the UI, through the existing API.

## 4. Phase K: operational communication (audit and gaps only)
- **Already covered:**
  - registration confirmation (email, and in-app for the resident, vendor and admins);
  - cancellations, refunds, hall change proposals;
  - partner messages to participants;
  - event instructions on the booking page.
- **Added:**
  - **Registration changes:** an in-app note to the partner when a resident changes answers (count only).
  - **Reminders:** a day-before reminder (`participation/bookingReminders.ts`) for experiences and events, hall bookings and programme sessions:
    - time and place;
    - "show your pass at the door to check in";
    - a note when answers are still missing.
- **Reminder delivery:**
  - In-app plus push, through the existing `notifyResident`, so the resident's **"Booking reminders"** preference now actually applies.
  - Once per order and day.
  - **Behind `participation.reminders`, off by default.**
  - Signed-in residents only; guests already have their confirmation email.
- **No parallel messaging system:** the notifications table, templates and preferences are the existing ones.

## 5. Phase L: reports and exports
- **Partner Reports tab.** Roles: managers, finance and the read-only analyst. It covers:
  - registrations by listing type (orders, confirmed, cancelled, people);
  - attendance for what has happened: expected, attended, not attended, not marked;
  - capacity: experience places in the period, programme places;
  - cancellations by month;
  - registration-form completion: bookings on listings with required questions, complete versus waiting.
- **Report rules:**
  - Counts only: no names, contact details or answers.
  - Always the caller's organisation.
  - Up to a year per period.
  - The CSV download is audited (`report.participation_exported`).
- **Approved answers export** for club, programme and hall forms (`…/answers.csv`):
  - for the listing's role only (finance and other managers get 403);
  - only questions marked exportable **and** whose data class the platform policy lets be exported, so contact details and special categories are never included;
  - every export is audited (`<type>.answers_exported`).
- **Retention:** still count-only (doc 18). Nothing is deleted.

## 6. Phase M: compatibility assessment
| Entry point | Status |
|---|---|
| Web: experiences/events, club registration, programme enrolment, hall booking | Show and validate the published form (Phases 2/H). Reload the form on `questions_changed` or `form_required` |
| Pass redemption and free trials (clubs) | Same checkout route, so the form is checked before the credit is spent |
| Waitlist claims | Go through the normal checkout, so the form applies |
| **Make It Happen** (paused) | **Gated:** venues with a live booking form are no longer offered. Its booking path is refused with 409 `form_required`. Halls without a form book as before |
| **Mobile app** (separate repo) | Sends no form today. While a listing has no form nothing changes. Once one is published, the app gets 409 `form_required` with a clear message (no longer "questions changed"), and the booking isn't made. A stale version gets `questions_changed`. **The app needs updating before partners publish forms on listings app users book** |
| Games | Out of scope (resident-hosted; doc 19) |
| Payments | Unchanged: no Stripe, pricing, webhook or checkout-agreement code changed |

## 7. Screenshots (`phase2-screenshots/`)
- `config-30-resident-registration-attention-phone.png`: a club registration on a phone, showing the registrant, answers with version 1, a locked answer, "Needs your attention" for a version-2 question, and "Answer now".
- `config-31-resident-answers-saved-phone.png`: after answering; the attention note is gone.
- `config-32-partner-record-owner.png`: the owner's record, with answers, history ("Answers changed by the person who booked") and Cancel.
- `config-33-partner-record-finance.png`: finance sees the record, "3 answers given. Only the managers who run this listing can read them." and Issue refund, with no Cancel.
- `config-34-partner-reports.png`: the Reports tab.

## 8. Tests
- **Server:**
  - **`participation/orderRecords.test.ts`** (Phase I):
    - ownership across types and devices, including email matching for clubs and halls but not programmes;
    - versions, locked answers and missing answers;
    - stale or invalid edits;
    - audit with keys only;
    - the partner notice has no values;
    - cancelled and past bookings can't be edited;
    - hall and programme views.
  - **`routes/vendorOrders.test.ts`** (Phase J):
    - another organisation and unknown kinds get 404;
    - the owner sees everything;
    - **finance sees no answers**;
    - other managers see no answers or actions;
    - communications and analysts get 403;
    - a cancelled registration offers no cancel;
    - partial attendance: 1 of 2 people at the door, 1 of 3 programme sessions.
  - **`participation/bookingReminders.test.ts`** (Phase K): off by default; once only; the resident's setting; cancelled bookings skipped; place and missing-answer note.
  - **`routes/vendorReports.test.ts`** (Phase L): counts by type, attendance, capacity, form completion; no personal data; organisation isolation; roles; period limit; audited CSV; answers export policy (contact class excluded) and roles.
  - **`participation/compatibility.test.ts`** (Phase M):
    - Make It Happen's booking path is refused for a hall with a form and works for a hall without one;
    - the web path with the form works;
    - an app that sends no form gets `form_required`;
    - an old version gets `questions_changed`;
    - a missing answer gets `answer_required`.
- **Browser batch `booking-config-operations`:**
  - a resident on a phone sees the attention prompt, can't edit the locked answer, answers the new question and saves;
  - answers are stored with their versions, and the partner notice holds no values;
  - the owner's record and Reports;
  - a real finance member sees no answers (UI and API), has refund but not cancel, and is refused the answers export;
  - a real check-in-only member is refused the record, the report and the answers.
- **Full regression:** see §10.

## 9. Outstanding policy decisions
1. **Reminders:** switch `participation.reminders` on? Should email be sent too, or in-app and push only? Reminders reach every signed-in resident who hasn't turned "Booking reminders" off (the existing default is on).
2. **Edit windows:** clubs can be edited while the registration is active; programmes until the last session day; experiences and halls until the start. Confirm, or set per-listing cut-offs.
3. **Answer access:** listing managers and the owner only. Should finance ever see specific classes, for example dietary preferences for catering invoices?
4. **Answer-change notices** go to the listing owner's account only (as for new bookings). Should they also go to assigned managers?
5. **Mobile app:** schedule the update to send forms (or keep partners from publishing forms until it ships).
6. **Make It Happen:** if it's ever re-enabled, should venues with forms stay excluded, or should it collect the venue's questions?
7. **Retention and erasure** of answers: still pending the legal review (doc 18).

## 10. Validation results
The full regression is **deferred by the owner until all phases are complete** (2026-10-30). The partial run before it was stopped:

| Check | Result |
|---|---|
| Type checks (server, client, QA harness) and production build | pass |
| Server suite (disposable MySQL) | **149 files, 1,352 passed, 0 failed**, 23 skipped (live provider tests, off by design) |
| Client unit | **351 passed** |
| QA harness self-tests | pass |
| New browser batches, run on their own | `booking-config-operations` **passed**; `booking-config-universal-forms` passed at Phase H |
| Full browser run | stopped after 29 of 210 batches: 46 passed; the only failures were the baseline COMPLETE-REVIEW-STATE, COMPLETE-SILENT and OG-27-UI |

**Still to run** in the final validation:
- every browser batch, including Stripe TEST;
- the booking regression;
- the security-gate and authorization suites.
