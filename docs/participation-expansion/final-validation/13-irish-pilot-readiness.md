# 13 · Irish pilot readiness

**Scope:** a limited pilot with a small number of Irish organisations, run on the **web** channel. All evidence in this validation is synthetic; no real participant, organisation or payment was used.

## 1. What a pilot can use today (technically verified, see [01](01-feature-completeness.md))

| Capability | Verified | Condition |
|---|---|---|
| Community events with options, attendees and door check-in | Yes (browser) | Switches `participation.events`, `.options`, `.attendees`, `.checkin` turned on **per pilot environment** by an admin |
| Registration forms on events, clubs, programmes and halls, with versions | Yes (browser) | — (web only; no mobile app exists) |
| Resident registration management in My Life | Yes (browser) | — |
| Partner booking record, roles, search and team notes | Yes (browser; team notes unit-tested) | — |
| Partner messages to their own participants | Yes (browser) | Consent model accepted by the owner as "service messages" for the pilot (legal blocker 5) |
| Reports and exports | Yes (unit and browser) | Known P2 count issue DEF-04: brief partners that event no-shows count bookings, not people |
| Capabilities, categories and field policy (admin) | Yes (browser) | — |
| Free and cash bookings | Yes | — |
| Paid bookings through Stripe | Verified in **TEST** mode only | **Not part of the pilot** until the paid-booking and VAT decision (gate 14) |

## 2. What must stay off for the pilot
- `participation.reminders` (consent decision; DEF-03).
- `participation.host_questions` (owner approval).
- `participation.partial_cancel` (locked).
- `participation.special_category_questions` (locked).
- `commerce.open_booking` (Make It Happen) stays paused.
- Paid production checkout.

## 3. Onboarding and support pack
The checklists in doc 26 §P8 are complete and match the verified behaviour:
- organisation onboarding (admin);
- vendor setup;
- staff training: door, record, messages, reports;
- resident journey;
- support procedures;
- feedback collection;
- success metrics;
- incident and rollback.

**Not yet in place for a real pilot:**
1. **Named pilot organisations** and their **data processing terms** (owner and legal).
2. **An approved privacy policy.** The current text still says medical information is collected for clubs (legal blocker 1).
3. **A support rota and contact route** for the pilot weeks (owner).
4. **Off-server backups.** Nightly on-server backups and a restore drill exist; an off-server copy was declined earlier, so re-raise it before real data arrives (ops).
5. **A production configuration check.** A read-only check that the switches above are off in production (`SELECT key, value FROM app_settings WHERE key LIKE 'participation.%' OR key LIKE 'commerce.%'`), done by the operator.

## 4. Irish specifics checked
- **Times:** Ireland wall-clock times, DST-aware (`irelandTime.ts`). Reminders use Ireland's "today".
- **Prices:** in EUR (Stripe TEST checkout amounts asserted in EUR).
- **VAT:** 23% applied by the existing pricing model. **Treatment per listing type isn't decided** (accountant).
- **Language:** English only. Irish-language content was out of scope.
- **Children's data:**
  - club registrations capture a child's name and date of birth, plus guardian details;
  - medical free text is no longer collected;
  - special-category questions are locked.
  - Safeguarding policy wording is a legal and owner item.

## 5. Pilot readiness verdict
**Technically ready for a web-only, free and cash pilot,** under the conditions in [12](12-release-gates.md) and [00](00-executive-summary.md). **Not ready** for:
- paid bookings;
- reminders;
- host questions;
- any mobile app channel (none exists; out of scope).

The listed owner and legal items must also be closed before real residents are invited.
