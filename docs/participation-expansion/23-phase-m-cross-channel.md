# 23 · Phase M: cross-channel booking compatibility

**Date:** 2026-10-30.
**Commits:**
- web: `5ebb0c7`, `a9793a9`, `b7229fc`;
- mobile `hello-circle-mobile`: `f3f48da`, `ea46242` on `feature/registration-forms`.

All are local; nothing is pushed.

## 1. Current-state audit: every order entry point
The order tables are `registrations`, `program_enrollments`, `bookings`, `experience_bookings`, `game_participants` and `passes`. Rows are inserted only by these server routes (checked by searching the source):

| Entry point | Route | Shared contract applied |
|---|---|---|
| Event or experience checkout (web, app) | `POST /api/experiences/:id/sessions/:sid/checkout` | Published form, version, required and conditional, per person and per booking, capability, capacity lock, pricing |
| Club registration (free, cash, paid, trial, pass) | `POST /api/registrations/checkout` → `reserveRegistration` | Same; answers checked before the pass credit or place is used |
| Programme enrolment | `POST /api/programs/:id/enroll` | Same |
| Hall booking (web, app) | `POST /api/bookings/checkout` → `createBookingInternal` | Same |
| Make It Happen (paused) | `POST /api/make-it-happen/confirm` → `createBookingInternal` | **Refused (409 `form_required`) for a venue with a form unless answers are sent; validated and stored when they are.** Venues with forms are left out of its search |
| Resident-hosted activity join (web, app) | `POST /api/games/:id/join` | Host questions (Phase N): version, required, before the place |
| Waitlist claim | The normal checkout | Same as above |
| Pass purchase | `POST /api/passes/checkout` | No form (a prepaid credit). Forms apply when it is used |
| Circle-linked participation | Circle plans → `POST /api/games` (`planId`); joins via `/games/:id/join` | Game rules, plus Circle visibility (`canViewGame`) |
| Staff-assisted booking | **None exists.** Partners can't create orders for people | n/a |
| Legacy routes | No other insert path. `/quote` routes don't reserve | n/a |

## 2. Shared registration contract
- **One engine** (`participation/questions.ts`, `formAnswers.ts`, `gameQuestions.ts`):
  - the published version, required fields and conditions;
  - booking- and attendee-level answers;
  - the field policy and organisation ownership.
- **Capacity, pricing and status** stay in each route's existing locked transaction. No channel has its own registration logic.
- **Errors:**
  - **`form_required` (409):** the listing has a form and none was sent (an older app, or a page from before it was published);
  - **`questions_changed` (409):** a stale version;
  - **`answer_required` (400):** a required answer is missing.

## 3. Mobile
The mobile codebase is available, and these changes are implemented, not just specified:
- **Every booking flow:** events and experiences, club registration, programme enrolment, hall booking and activity join all fetch the published form, render every field type (with sections and conditions), and submit versioned answers.
- **Errors and recovery:** the app shows validation errors and, on a form change, reloads the listing and asks again.
- **Unchanged requests:** an app booking on a listing without a form sends exactly the old request.
- **Checks:** the type check, lint and **Jest (41 tests, 6 for forms)** pass.
- **Not tested on a device or simulator:** no build or E2E on a phone was run in this environment. That's a stated gap, not an implied pass.
- **Older app builds** are safely gated: they're refused with a clear message on listings that publish forms.

## 4. Make It Happen
- **Paused:** it stays paused (`commerce.open_booking`).
- **Server path ready:** its server path now loads the hall's form version and validates and stores answers, in the same locked transaction as capacity and pricing (tested).
- **Screens not ready:** the web and app screens don't ask the questions yet, so venues with forms stay excluded and the path refuses them.
- **Re-enabling it** needs the screens, an end-to-end pass and owner approval.

## 5. Acceptance
| # | Criterion | Status |
|---|---|---|
| 1 | No supported channel bypasses required questions | Met: server-enforced on every insert path |
| 2 | Existing web bookings keep working | Met: listings without forms are unchanged. Server suite passes (1,371) |
| 3 | Version mismatches recover safely | Met (web and app reload and ask again) |
| 4 | Mobile verified or gated | Implemented with unit tests and the type check; device E2E pending. Older builds are gated |
| 5 | Make It Happen stays paused | Met |
| 6 | Legacy routes can't bypass | Met (no other insert path) |
| 7 | Stripe and capacity unchanged | Met: no payment code changed. Stripe TEST reruns in the final validation |

## 6. Tests
- **Server:**
  - `participation/compatibility.test.ts` (5): the Make It Happen gate and stored answers, a hall without a form, an app sending no form, a stale version, a missing answer;
  - plus the Phase H, I and N suites.
- **Mobile:** `formQuestions.test.ts`.

## 7. Release impact
- **App users:** they need the app update before partners publish forms on listings app users book.
- **Make It Happen:** unchanged (paused).
