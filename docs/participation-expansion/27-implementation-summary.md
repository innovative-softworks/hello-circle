# 27 · Participation expansion: implementation summary (Phase 1 → Phase P)

**Date:** 2026-10-30.
**Web:** `hello-circle`, branch `feature/participation-phase2` (base `f22294f`), 25 local commits `cc2def1`…HEAD (including this report).
**Mobile:** `hello-circle-mobile`, branch `feature/registration-forms`, 2 local commits.
**Nothing has been pushed or deployed.** The release verdict belongs to the separate Final Master Validation.

## Status of every phase
Statuses:
- **Implemented:** built, with unit and type-check evidence; browser evidence as noted.
- **Gated:** built, but behind a switch that's off, or locked.
- **Audited:** existing functionality covers it; nothing new was needed.
- **Deferred:** owner decision pending.

| Phase | Scope | Status | Evidence | Report |
|---|---|---|---|---|
| 1 | Community events, registration options, order lines | Implemented | Validated: Phase 1 final validation | 07–10 |
| 2 | Attendees, registration questions, door check-in, check-in staff | Implemented | Browser batch `booking-event-attendees` | 11–12 |
| B–D | Organisation capabilities, admin configuration, dynamic partner navigation | Implemented | Browser batch `config-capabilities` | 13–14 |
| D-A4 | Free-text medical collection stopped; legacy notes kept, unread | Implemented | Source scan test | 15, 18 |
| E | Categories and organisation eligibility | Implemented | Browser batch `config-categories` | 15 |
| F | Field registry and field policy | Implemented | Browser batch `config-fields` | 16 |
| G | Form builder: drafts, versions, templates, conditions | Implemented | Browser batch `config-forms` | 17 |
| Governance | Read-only privacy counts and legal review list | Implemented | Unit test | 18 |
| H | Universal forms: clubs, programmes, halls | Implemented | Browser batch `config-universal-forms` | 19 |
| I | Resident registration on every booking: answers, versions, editing, status | Implemented | Browser batch `config-operations` | 20–21 |
| J | One partner record per booking: roles, actions, history, search and filters | Implemented | Browser batch `config-operations` | 20–21 |
| K | Partner messages (audience, templates, preview, idempotent delivery, retries) and answer-change notices | Implemented | Browser batch `config-messages` | 22 |
| K | Day-before reminders | **Gated** (`participation.reminders`) | Unit tests | 22 |
| L | Reports (filters, trend, per listing, check-ins, repeat), exports, admin Governance | Implemented | Unit tests; browser `config-operations` (first version) | 22 |
| M | Every entry point enforces published forms; mobile app sends forms; Make It Happen gated | Implemented | Unit tests, mobile Jest; **mobile not device-tested** | 21, 23 |
| M | Make It Happen | **Gated** (paused) | Server path tested | 23 |
| N | Host questions (approved library), host-only answers, no-show; web and app | **Gated** (`participation.host_questions`) | Unit tests | 24 |
| O1 | Family and group participation | Audited (events and experiences) | Phase 2 tests | 25 |
| O1 | Partial group cancellation | **Locked** (`participation.partial_cancel`) | Phase 1 | 25 |
| O2 | Programme progress and finished state | Implemented | Unit test | 25 |
| O3 | Team notes on bookings | Implemented | Unit test | 25 |
| O4 | Volunteers | Audited | n/a | 25 |
| O5 | Commercial extensions | Documented; **not enabled** | n/a | 25 |
| P | Security review, reliability notes, ops fix (job failures reported), accessibility review, pilot pack | Engineering done; **not a verdict** | Server suite | 26 |

## Latest results (type checks and unit tests only, by owner instruction)
| Check | Result |
|---|---|
| Server suite (disposable MySQL) | **152 files, 1,371 passed, 0 failed**, 23 skipped (live provider tests, off by design) |
| Client unit | **352 passed** |
| Type checks (server, client, QA harness) and production build | pass |
| Mobile type check, lint and Jest | pass, **41 tests** |
| Browser batches written for this work | `booking-event-attendees`, `booking-config-capabilities`, `booking-config-categories`, `booking-config-fields`, `booking-config-forms`, `booking-config-universal-forms`, `booking-config-operations`, `booking-config-messages`. Each passed when run on its own; not yet run together |
| Full browser, Stripe TEST, security-gate and authorization regression | **Not run since Phase H**. Deferred to the Final Master Validation. Baseline known failures: 17 tests (doc 17 §9), plus the once-per-database `SANDBOX-SPLIT` (reset first) |

## Switches that are off or locked (need approval)
- **Off:** `participation.reminders`, `participation.host_questions`. Also `participation.events`, `participation.options`, `participation.attendees` and `participation.checkin`, as configured per environment.
- **Locked:** `participation.partial_cancel`, `participation.special_category_questions`.
- **Paused:** `commerce.open_booking` (Make It Happen).

## Outstanding decisions (owner, legal, accounting)
**Legal:**
- Privacy-policy wording on medical information.
- Legacy medical notes: basis, retention, erasure.
- Registration-answer retention periods.

**Owner policy:**
- Notification consent model for organiser messages and reminders.
- Answer edit windows.
- Finance access to any answer class.
- Recipients of answer-change notices.
- Host question limit.
- Programme "completed" threshold.

**Product and release:**
- Mobile app release before partners publish forms on listings app users book.
- Make It Happen screens before re-enabling it.
- Resync of the mobile copy of `@hello-circle/types`.
- The mobile `package-lock.json` (generated; left uncommitted).

**Accounting:**
- Paid booking eligibility, Irish VAT treatment per listing type, donations, external payments.

## Release impact if deployed as is (with switches off)
- **Partners:**
  - forms on clubs, programmes and halls (when a partner publishes one);
  - the booking record;
  - team notes and programme progress;
  - Reports;
  - the richer Messages screen.
- **Residents:** their registration on booking pages; answers asked only where a partner published a form.
- **Admins:** the Governance page.
- **App users:** need the app update before forms are published on the listings they book.
