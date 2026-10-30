# 21 · Phases I, J and M: release batch (resident, vendor, compatibility)

**Date:** 2026-10-30.
**Repositories:**
- web `hello-circle`, branch `feature/participation-phase2`;
- mobile `hello-circle-mobile`, branch `feature/registration-forms`.

Both are committed locally; nothing is pushed or deployed.
**Builds on:** doc 20 (the first Phases I–M build). This batch closes the gaps against the release brief and adds the mobile app.

## 1. Current-state audit (before this batch)
| Brief item | State after doc 20 | This batch |
|---|---|---|
| **I:** submitted answers, historical wording, attendees, controlled editing, check-in status | Built for all four order types (`/api/orders/:source/:ref`, `BookingPeople`) | — |
| **I:** registration status | Only the "needs attention" banner | **Status line:** "Needs your answers", "Registration complete" (with or without "you can still change answers"), or "Cancelled — answers kept for the record" |
| **I:** booking instructions | Existing "get ready" sections (experiences, venues, programmes, games) | Unchanged |
| **I:** empty and error states | Empty: the section is hidden when there's nothing to show. **A failed load silently showed nothing** | **Error state** with "Try again". A booking that isn't yours still reads as not found |
| **J:** unified record, attendees, answers by role, check-in summary, status, actions | Built (`/vendor/orders/:source/:ref`, 70/30) | — |
| **J:** search and filtering | Experience attendees could be searched. Club, programme and hall answers were a flat list of orders *with answers only* | **Every registration is listed** with what it's still missing. Search by name or reference; filter by waiting for answers, complete or cancelled. A "N waiting for answers" count |
| **M:** Make It Happen | Gated: venues with forms excluded, confirm refused (`form_required`) | **Confirm now validates and stores** a venue's answers when they're sent. Venues with forms stay excluded from its search (its web and app screens don't ask questions yet), and it **stays paused** |
| **M:** mobile | The app sent no form, so it got `form_required` once a listing published one | **The app shows and sends the form in all four booking flows** (below) |

## 2. Resident screens (web)
- **`/bookings/:kind/:ref`**: the registration section for club registrations, programme enrolments, hall bookings and experiences. It shows:
  - **Status line**, plus the "needs attention" banner when a required answer is missing.
  - **People:**
    - an experience's group, with door check-in per person;
    - a club's registrant;
    - a programme's participant, with sessions attended.
  - **Answers:** with the question as it was asked, "Answered on form version N", and "can't be changed" on locked answers.
  - **Actions:** "Answer now" / "Change answers" within the edit window, or the reason they can't be changed.
  - **Errors:** "We couldn't load your registration details just now. Your booking itself isn't affected." with **Try again**.

## 3. Vendor screens (web)
- **Record page** `/vendor/orders/:source/:ref` (doc 20 §3): role-based answers, actions and history.
- **Listing → Questions tab** (clubs, halls) and **programme page → Enrolment questions:** "Registrations and answers · N waiting for answers", with:
  - search by name or reference;
  - a Show filter: All, Waiting for answers, Complete, Cancelled;
  - each registration links to its record and shows "Waiting for: …" or its answers;
  - the CSV export (doc 20 §5).
- **The hall booking record** shows its answers section.
- **The experience Attendees tab** is unchanged (it already had search), and its names link to the record.

## 4. Compatibility matrix
| Channel | Experiences / events | Club registration | Programme enrolment | Hall booking | Published form can be bypassed? |
|---|---|---|---|---|---|
| Web | Shows and validates the form; reloads on a stale or missing form | Same | Same | Same | No |
| **Mobile app** (`feature/registration-forms`) | **Shows and sends** (per person and once per booking) | **Shows and sends** (the registrant) | **Shows and sends** (the participant; a child by date of birth) | **Shows and sends** (once per booking) | No. The server refuses a missing (`form_required`) or stale (`questions_changed`) form, and the app reloads and asks again |
| Older app builds (before this branch ships) | Refused with a clear `form_required` once a form is published; unchanged while there's none | Same | Same | Same | No |
| Make It Happen (paused; web and app) | n/a | n/a | n/a | Venues with forms are not offered. Confirm refuses them without answers and stores them when given | No |
| Pass redemption, free trial, waitlist claim | Via the normal checkout | Same | n/a | n/a | No |
| Games | Out of scope (resident-hosted, no organisation form) | | | | n/a |
| Payments | No change to Stripe, pricing, webhooks or checkout agreements | | | | n/a |

**Mobile implementation details:**
- `src/registration/formQuestions.ts` holds the rules, mirroring web's `attendeeSlots.ts`:
  - shown-when conditions;
  - per-person questions by age;
  - pre-filled answers;
  - missing answers;
  - programme adult or child from the date of birth.
- `src/components/RegistrationQuestions.tsx` is the native form: text, long text, number, email, phone, date, pick one/several, buttons, tick box and information, with sections and "why we ask".
- **Requests are unchanged** when a listing asks no questions.
- **The app's copy of `@hello-circle/types` predates these types.** They live in `src/registration` until it is resynced (blocker 3).

## 5. Security validation
- **Organisation isolation:**
  - records, answers, exports and reports for another organisation return 403 or 404;
  - unknown order kinds return 404.
- **Booking ownership:**
  - the resident's registration matches by browser id or resident, plus the verified email for clubs and halls (the existing "my …" rule);
  - anyone else gets 404;
  - a reference can't be read as another type.
- **Staff permissions:**
  - answers are visible only to the listing's managers and the owner;
  - **finance sees the record and the refund, not the answers (UI and API)**, and is refused the answers export;
  - communications and analysts can't open records;
  - check-in-only staff are refused records, reports and answers (the door screen is unchanged).
- **Payment controls:** answers are checked before a place is held and stored in the order's transaction. Cancel and refund use the existing role-checked endpoints.
- **Sensitive data:**
  - the special-category switch stays locked;
  - exports follow the field policy (never contact details or special categories);
  - audit rows and notifications hold keys or counts only, never answers.

## 6. Screenshots (`phase2-screenshots/`)
| Screenshot | Shows |
|---|---|
| `config-30` | Resident needs answers (status "Needs your answers") |
| `config-31` | Resident after answering ("Registration complete") |
| `config-32` | Owner record |
| `config-33` | Finance record (no answers, refund only) |
| `config-34` | Reports |
| `config-35` | The club's registrations with search and the Complete filter |
| `config-20`…`25` | (Phase H) Builder and resident forms |

## 7. Test results
See §9.

## 8. Outstanding blockers
1. **Mobile release.** The app branch must be reviewed, built and shipped (EAS) before partners publish forms on listings app users book. Until then, those users get a clear refusal.
2. **Mobile lockfile.** The mobile repo had no lockfile. `npm install` resolved fresh versions to run its checks, and the generated `package-lock.json` is left **uncommitted** for the owner to decide.
3. **Shared types drift.** The app's `packages/types` is far behind the web copy (≈1,500 vs ≈3,000 lines). The form types live locally in the app until a deliberate resync.
4. **Make It Happen** stays paused. Its screens need the venue's questions before venues with forms can be offered (the server path is ready).
5. **Mobile: answers after booking.** The app's My Life doesn't yet show or edit registration answers; the web booking page does.
6. **Policy decisions** from doc 20 §9 still stand: reminders switch, edit windows, finance access, notice recipients, retention.

## 9. Validation results (2026-10-30)
| Check | Result |
|---|---|
| Web type checks (server, client, QA harness) and production build | pass |
| Web server suite (disposable MySQL) | **149 files, 1,353 passed, 0 failed**, 23 skipped (live provider tests, off by design) |
| Web client unit | **351 passed** |
| Browser batch `booking-config-operations` (resident status, record by role, search/filter, reports) | **passed** |
| Browser batch `booking-config-universal-forms` | passed (Phase H) |
| Mobile type check, lint and Jest | pass, **41 tests** (6 new) |

**Deferred by the owner until all phases are complete:** the full browser regression (all 210 batches, including Stripe TEST, booking, security-gate and authorization). It was started and stopped before the browser batches ran, so the code under development could keep changing.
