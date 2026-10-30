# 19 · Phase H: universal registration forms

**Date:** 2026-10-29.
**Branch:** `feature/participation-phase2`. Committed locally; not pushed, not deployed.
**Builds on:** the Phase G builder (doc 17), the Phase F field registry and policy (doc 16), and the Phase E suggested form (doc 15).
**No second builder.** The same engine, tables, drafts, versions, templates, policy and answer validation now serve four listing types.

## 1. Audit by listing type

| Listing type | Order table / route | Fixed fields (the platform's own form) | Attendee records | Booking ownership | Form entry points before H | After H |
|---|---|---|---|---|---|---|
| **Events** (`experiences.kind = 'event'`) | `experience_bookings`, `POST /api/experiences/:id/sessions/:sid/checkout` | Name, email, phone, party size, seat names, options, terms and safety | `booking_attendees` (Phase 2) | `client_id` + `resident_id`; the listing's `vendor_id` → organisation | Partner: Questions tab. Guest: booking popup | Unchanged |
| **Experiences and adventures** | Same as events | Same, plus minimum-age confirmation | Same | Same | Same | Unchanged |
| **Volunteering** (`kind = 'volunteer'`) | Same | Same | Same | Same | Same | Unchanged (the Volunteer registration template applies) |
| **Clubs** | `registrations`, `POST /api/registrations/checkout` (free, cash, pass and paid paths, all through `reserveRegistration`) | Child or adult registrant: first and last name, date of birth and age group (child), guardian name, email, phone, emergency contact, consent, session, trial/pass/coupon | One registrant per registration (no attendee table) | `client_id` + `resident_id`; `clubs.vendor_id` | None (fixed form only) | **Questions tab** on the club page. Answers on the **Review** step of `/register/:clubId` |
| **Programmes** | `program_enrollments`, `POST /api/programs/:id/enroll` | Participant name, date of birth (optional), email, phone, coupon, terms | One participant per enrolment | `client_id` + `resident_id`; `programs.vendor_id`. The editing role follows the parent listing (hall or club) | None | **"Enrolment questions"** section on the programme page. Answers in the Enrol popup |
| **Community centres and halls** | `bookings`, `POST /api/bookings/checkout` → `createBookingInternal` | Room, date, time, duration, event type, guests, name, email, phone, notes, open spots | None (a hall booking has no people list) | `client_id` + `resident_id`; `centres.vendor_id` | None | **Questions tab** on the hall page; once-per-booking questions only. Answers on the **Details** step of `/book/:centreId` |
| **Activities / games** | `game_participants`, `POST /api/games/:id/join` | None beyond the joiner's identity and the minimum-age confirmation | One row per joiner | Hosted by a **resident** (`games.host_resident_id`), not an organisation | None | **Not extended** (see §7) |

## 2. Shared form architecture
- **One engine.**
  - `participation/questions.ts`: validation, conditions, versions and answers.
  - `participation/forms.ts`: drafts, publish, history and templates.
  - Every function now takes a `listingType` (`experience | club | program | centre`). The default stays `experience`, so every Phase 2–G caller and test is unchanged.
- **One description of the differences**, `participation/formListings.ts`:
  - **`FORM_TABLE`:** where each listing's `questions_version` lives. New idempotent `ensureColumn` on `clubs`, `programs` and `centres`.
  - **`ANSWER_SOURCE`:** the answers' `source_type`, the same key the order's acknowledgements already use (`experience | registration | program | booking`).
  - **`PERSON_QUESTIONS`:** halls ask once per booking only.
  - **`FIXED_LIBRARY_FIELDS` / `fixedFieldClash()`:** questions that repeat the listing's own form are refused at publish. For clubs, that covers date of birth, age group, address, emergency contact and relationship. For programmes, date of birth. For halls, event type, guests, date, time, duration and notes. That's on top of the platform-wide reserved labels (name, email, phone, price, payment, guardian and so on).
  - **`DEFAULT_FORM_TYPE`:** the suggested template when the category names none.
- **Booking side.** `participation/formAnswers.ts`:
  - **`publicForm()`:** for the public detail reads.
  - **`checkFormAnswers()`:** runs before any place is held.
  - **`saveFormAnswers()`:** runs inside the order's own transaction.
- **Database.** No new tables: `registration_questions`, `registration_answers` and `registration_form_drafts` were already keyed by listing or source type. The only addition is `questions_version` on three tables. There are no foreign keys, per D-A1.
- **Partner API.** `/api/vendor/forms/:listingType(club|program|centre)/:id/questions[/draft|/draft/from|/publish|/versions[/:v]]` and `…/answers`. This mirrors the experience routes; experience routes are untouched. Organisation templates (`/api/vendor/form-templates`) are shared by all types.
- **Client.**
  - `QuestionsEditor` takes `experienceId` **or** `listing`. It's the same component.
  - Hall forms offer only "Once per booking". Ready-made per-person fields aren't offered there, nor fields the listing's form already has.
  - The preview shows a group (experiences), one sample child (clubs and programmes), or no people (halls).
  - **`FormQuestions`:** a questions-only block reusing `QuestionInput`, `QuestionList`, conditions and sections. It's for flows that already ask who's coming.
  - **`FormAnswersPanel`:** the partner's answer list.
- **Pending orders.** `endPendingHold(…, "delete")` now removes the answers of any deleted pending order (it used to cover experiences only). Paid, failed and reviewed orders keep theirs.
- **Retention.** Admin's "answers past retention" count and the operator counts (doc 18) now cover all four sources, still as counts only:
  - session date for experiences;
  - booking date for halls;
  - order date for club registrations and enrolments.

## 3. Integrations and compatibility
| Area | What happens |
|---|---|
| **No form published** (every existing listing) | The public read returns `registrationForm: { questions: [], questionsVersion: 0 }`. Checkout skips every form check, and the flows look and behave exactly as before |
| **Switch / capability off** | With `participation.attendees` off, or the organisation's `attendees` or `registration_questions` capability off, there's no form on the page. Answers sent are ignored, and partner writes are refused (404/403). Same rule as experiences |
| **Capacity, locks, coupons, passes** | Answers are checked **before** the reservation and written **inside** the existing locked transaction (`reserveRegistration`, the programme `FOR UPDATE`, the room lock). A refused answer never holds a place or uses a coupon or pass credit |
| **Payments** | No change to pricing, Checkout sessions, the checkout agreement or the webhook. Answers are stored with the pending row; a pending hold that's deleted takes them with it. **No new commercial feature** is switched on |
| **Club registrations** | The registrant is attendee 1, so child-only and adult-only questions follow `registrantType`. Fixed guardian and emergency-contact fields are unchanged. Health information is still not collected (D-A4) |
| **Programme enrolments** | The participant is attendee 1: a child when a date of birth under 18 is given, otherwise an adult. The server and client use the same rule |
| **Hall bookings** | Booking-level questions only. **Make It Happen** (paused) books without the form |
| **Experience seat names, attendee records, check-in** | Untouched. Club, programme and hall answers aren't door data: there's no check-in for those types |
| **My Life and receipts** | Untouched. Answers aren't shown to the resident after booking for the new types (see §7) |
| **Form version integrity** | A booking against a changed form gets 409 `questions_changed`, and the client reloads the form. Answers keep their wording and version, so a later version leaves them as given |
| **Older clients (mobile app)** | They send no answers. While a listing has **no** published questions nothing changes. Once a partner publishes a form, an older client gets 409 `questions_changed` (as for experiences since Phase 2) until it's updated |

## 4. Permissions and privacy
- **Organisation and listing ownership.** Every route resolves the listing's `vendor_id` against `req.vendorIds` (the organisation), so another organisation gets 403 for read, draft, publish and answers. Unknown listing types (e.g. `game`) never match a route.
- **Roles.** These reuse the existing editing roles:
  - **Halls**, and programmes attached to a hall: `centre_manager`.
  - **Clubs**, and programmes attached to a club: `facility_manager`.
  - **The owner** is unrestricted.
  - **Finance, communications and analyst roles** can read the form but not change it or see answers.
  - **Check-in-only staff** can't reach any of it (the `/vendor/door` allow-list).
- **Capabilities.** Drafts and publishing need `participation.attendees`, plus the organisation's `registration_questions` capability and its question limit.
- **Category eligibility.** Unchanged:
  - categories decide which listings an organisation may create (Phase E);
  - a category's suggested form is only a preset (D-A5);
  - a template never authorises a field the policy forbids, because it's validated again at publish.
- **Field policy.** Ready-made fields switched off by admin, disallowed answer types, financial and identity wording, and special-category wording are refused exactly as in Phase F. `participation.special_category_questions` **stays locked**.
- **Answer-level access.** Answers are listed only for the listing's editing role. The CSV export is still for experiences only. No answer is sent to the public or to other organisations.
- **No duplication of platform fields.** Fixed fields are refused per listing (§2), and the builder doesn't offer them.

## 5. Screenshots (`phase2-screenshots/`)
- `config-20-club-builder-preview.png`: the club's Questions tab, with a child-only kit-size question, a guardian question and a phone-width preview.
- `config-21-hall-builder-published.png`: a hall form published; "Once per booking" is the only option.
- `config-22-guest-club-questions-phone.png`: a resident on a phone, at the registration's Review step.
- `config-23-guest-hall-question-phone.png`: a hall booking's Details step, with the venue's question.
- `config-24-guest-programme-question-phone.png`: the Enrol popup, where the child's question appears once the date of birth makes the participant a child.
- `config-25-club-answers-partner.png`: the partner's view, showing the live version, a refused draft ("the club registration form already asks for this") and the answers.

## 6. Tests
- **`participation/universalForms.test.ts` (14):**
  - **Rules:** fixed-field clashes for each type; programme adult/child by date of birth.
  - **Access:**
    - another organisation gets 403 on read, draft and answers;
    - an unknown type gets 404;
    - roles: finance can read but not write; a centre manager can't change a club; a facility manager can't change a hall; a programme follows its parent;
    - capability off: 403.
  - **Clubs:**
    - no form: registers as before;
    - the fixed date-of-birth field is refused and the library hides the emergency contact;
    - publish and audit;
    - a stale or incomplete registration is refused; answers are stored at the booking and person level;
    - the partner's answers list;
    - version 2 keeps version 1's answers, and the history lists both;
    - an adult isn't asked children's questions.
  - **Programmes:** a child's required question, stored; an adult isn't asked it.
  - **Halls:** a per-person question is refused; the library is booking-only; a stale booking is refused; answers are stored; switch off: no form and booking as before.
  - **Pending holds:** a deleted pending order removes its answers.
- **Client unit:** programme adult/child rule; a hall's required booking question (`attendeeSlots.test.ts`).
- **Browser batch `booking-config-universal-forms`.** The partner builds and publishes forms on a club, a hall and a programme in the real UI. A repeated fixed field is refused and stays a draft. A resident on a phone answers inside the three usual flows: a required answer is asked for first. The answers are stored with each order, and the partner reads them. No console errors, no horizontal scroll. **Passes.**
- **Full regression:** see §8.

## 7. Limitations
- **Games:**
  - not extended, because a game's host is a resident with no organisation, roles or capabilities;
  - giving hosts a form would need its own ownership and privacy model (owner decision).
- **Answers after booking.** Residents can't view or edit their club, programme or hall answers after booking (experiences can). Partners see them on the Questions tab, not yet inside the Registrations, Bookings or Enrolments lists or exports.
- **One person per club registration or programme enrolment.** Matches the fixed form. Sibling registrations remain separate registrations.
- **Make It Happen** (paused) books halls without the venue's questions.
- **The mobile app** must send answers before partners publish forms on listings its users book (§3).
- **Unchanged from Phase G:**
  - the vendor onboarding form isn't built;
  - platform templates live in code;
  - there's no drag and drop reordering.

## 8. Validation results (final code, 2026-10-29)
| Check | Result |
|---|---|
| Type checks (server, client, QA harness) and production build | pass |
| Server suite (disposable MySQL) | **144 files, 1,329 passed, 0 failed**, 23 skipped (live R2/Cloudinary provider tests, off by design) |
| Client unit | 45 files, **351 passed** |
| QA harness self-tests | **100 passed** |
| Guarded browser QA: **every batch of every suite, Stripe TEST included**, each run on its own (isolated QA, offset 10) | **209 batches: 461 passed, 25 failed or timed out, 4 skipped** |

### Failures separated
**New failures caused by this work:** none.

**Known baseline (17 tests).** These fail identically on the untouched base `f22294f` (report 10 §5). Some run in two suites, so they appear 24 times:
- REAL-AUTH-001, LC-UI-DESKTOP-HOST, LC-UI-TABLET, HC-QA-001-STACK, HC-QA-032;
- BK-UI-DESKTOP, HC-QA-043, HC-QA-066, HC-QA-068, HC-GAP-UI-EXP;
- PUB-05/33, PUB-21/22/23, B2-LISTS;
- COMPLETE-REVIEW-STATE, COMPLETE-SILENT, OG-27-UI, CAT-PUBLIC.

**Harness limit, confirmed not a regression (1):**
- **What:** `SANDBOX-SPLIT` (Stripe TEST) refuses to run when the QA partners already have transfers, so it passes once per QA database.
- **Confirmation:** after `qa:db:reset` and `qa:db:seed` of the disposable QA database, it was re-run on its own and **passed**.
- **Other Stripe TEST batches:** all 18 passed in the full run.

**Skips (4):** PERF-P13 (needs a production server; it runs in two suites) and the known REM-046 split (2).

**Cross-organisation security:**
- all 43 authorization batches and all 19 security-gate batches pass, with no failures at all;
- Phase H's own cross-organisation, role and capability checks are in `universalForms.test.ts` (§6).

**Booking regression:**
- every booking batch passes apart from the baseline tests above;
- that includes the club, centre, programme, experience, remediation and cancellation batches, every Phase 1/2/C–G configuration batch, and the new `booking-config-universal-forms`.
