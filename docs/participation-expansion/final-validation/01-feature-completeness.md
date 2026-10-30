# 01 · Feature completeness (Phase 1 → Phase P)

**Validated web commit:** `d22f4a6` (branch `feature/participation-phase2`; 28 commits above `f22294f`).
**Mobile:** out of scope. The owner confirmed there is no mobile app; this is a web-only release ([06](06-mobile-compatibility.md)).
**Environment:** isolated QA (disposable MySQL container, synthetic personas, Stripe TEST). Details are in [02](02-test-execution-results.md).

## Status legend
- **Verified working:** a browser batch exercised it in this validation and it passed, or a server test on a disposable DB did where no UI exists.
- **Implemented (unit only):** code and server tests pass; no browser or device run in this validation.
- **Disabled intentionally:** built, but behind a switch that is off.
- **Blocked by approval:** needs an owner, legal or accounting decision before it can be enabled.
- **Deferred:** not built, by decision.
- **Partially working:** some of it works and some doesn't, or one channel is untested.

A disabled or documented-only item is **never** counted as operationally complete.

## Per phase

| Phase | Feature | Status | Evidence in this validation |
|---|---|---|---|
| 1 | Community events, registration options, pricing, immutable order lines | **Verified working** (switches on in QA) | `booking-event-options` (BK-EVENT-PARTNER, BK-EVENT-OFF), Stripe TEST suite (51/51 incl. order-line snapshots) |
| 1 | Events in production | **Disabled intentionally** (`participation.events`, `participation.options` per environment) | BK-EVENT-OFF proves the off state hides events and refuses option bookings |
| 2 | Attendees, questions, door check-in, check-in-only staff | **Verified working** | `booking-event-attendees` (P2-PARTNER, P2-DOOR) |
| B–D | Capabilities, admin templates, dynamic partner navigation | **Verified working** | `booking-config-capabilities` (CFG-CAPABILITIES: UI and direct API follow the template) |
| D-A4 | Club medical free-text collection stopped | **Verified working** (code) | `privacyMedical.test.ts` source scan; registrations write `medical: ""`; see [07](07-privacy-and-governance.md) |
| D-A4 | Legacy medical notes: retention and erasure | **Blocked by approval** (legal) | Counts only; nothing deleted |
| E | Categories and organisation eligibility | **Verified working** | `booking-config-categories` (CFG-CATEGORIES) |
| F | Field registry and field policy | **Verified working** | `booking-config-fields` (CFG-FIELDS: sensitive refusal, export rules) |
| F | Special-category questions | **Disabled intentionally / locked** (`participation.special_category_questions`, 409) | CFG-FIELDS, P2-PARTNER |
| G | Form builder: drafts, versions, templates, conditions | **Verified working** | `booking-config-forms` (CFG-FORMS) |
| H | Universal forms: clubs, programmes, halls | **Verified working** | `booking-config-universal-forms` (CFG-UNIVERSAL) |
| I | Resident registration management (answers, edits, status) | **Verified working** | `booking-config-operations` (CFG-OPERATIONS) |
| J | One partner record per booking, roles, history, search | **Verified working** | `booking-config-operations` |
| K | Partner messages: audience, templates, preview, test send, idempotent delivery, retries | **Verified working** | `booking-config-messages` (CFG-MESSAGES, after fix `d22f4a6`); `vendorMessages.test.ts` (8) |
| K | Day-before reminders | **Disabled intentionally** + **Blocked by approval** (consent model) | `bookingReminders.test.ts` (2) only; defect DEF-03 found (see [11](11-defects-and-remediation.md)) |
| L | Reports, filters, trend, per listing, check-ins, repeat people, exports, admin Governance | **Verified working** (first version in browser; filters and exports by server tests) | `booking-config-operations`; `vendorReports.test.ts` (6); `governance.test.ts` |
| M | Every entry point enforces published forms | **Verified working** (server) | `participation/compatibility.test.ts` (5); CFG-UNIVERSAL |
| M | Mobile app sends forms | **Out of scope**: the owner has no mobile app (web-only release); local branch not validated on a device | [06](06-mobile-compatibility.md) |
| M | Make It Happen | **Disabled intentionally** (paused, `commerce.open_booking`) | Direct-API refusal test (compatibility.test) |
| N | Host questions, host-only answers, no-show (web) | **Verified working in isolated QA with the switch on**; **Disabled intentionally** in every other environment | New batch `booking-config-host-questions` (CFG-HOST-QUESTIONS), screenshots 50–51 |
| N | Host questions (app) | **Out of scope** (no mobile app) | [06](06-mobile-compatibility.md) |
| O1 | Group and family participation (events, experiences) | **Verified working** (existing) | P2-DOOR (partial group check-in), Stripe TEST group orders |
| O1 | Partial group cancellation | **Disabled intentionally / locked** (`participation.partial_cancel`) | n/a |
| O1 | Clubs and programmes with several people per order, per-person passes | **Deferred** | Doc 25 |
| O2 | Programme progress and "finished" | **Implemented (unit only)** | `vendorPrograms.test.ts`; no browser batch |
| O2 | Programme completion threshold, certificates | **Deferred / blocked by approval** (owner) | Doc 25 |
| O3 | Team notes on bookings | **Implemented (unit only)** | `vendorOrders.test.ts` |
| O4 | Volunteers (experience kind `volunteer`, options as roles, door check-in) | **Implemented** via existing models; no volunteer-specific approval | Covered only as an experience; see journey G in [03](03-end-to-end-journeys.md) |
| O5 | Donations, external payments, VAT per listing type | **Deferred / blocked by approval** (accounting) | Not enabled |
| P | Job failures reach the error reporter | **Implemented (unit only)** | `a84b302` + server suite |
| P | Security, accessibility, performance review | Engineering notes only (doc 26); this validation is the test | [04](04-security-and-permissions.md), [09](09-ui-ux-accessibility.md), [10](10-performance-and-reliability.md) |

## Switches: state in the code default and in QA

| Switch | Code default | During this validation | Notes |
|---|---|---|---|
| `participation.events`, `.options`, `.attendees`, `.checkin` | off (`featureOn` → "false" without a row) | turned on per batch by fixtures, restored afterwards | |
| `participation.reminders` | off | **off** in the browser run; on only inside the disposable server-test DB | |
| `participation.host_questions` | off | on **only** for the CFG-HOST-QUESTIONS batch; the spec asserts the original value is restored | |
| `participation.partial_cancel` | locked | locked | |
| `participation.special_category_questions` | locked (409) | locked | |
| `commerce.open_booking` (Make It Happen) | paused | paused | |

**Production configuration** was not inspected: this validation has no production access by design. That the switches are off in production rests on the code default (no row = off) plus the fact that nothing in this branch writes those rows. Confirm with a read-only `SELECT` on `app_settings` before release (gate 13 condition).
