# 25 · Phase O: advanced participation (workstreams)

**Date:** 2026-10-30.
**Commit:** `8eb1d5d` (local). No replacement booking system; each workstream reuses the existing models.

## O1 · Family and group participation: audited, already in place
**Current state.** On events and experiences:
- **People and answers:**
  - a group booking contact (`participant_name`, email, phone);
  - multiple attendees (`booking_attendees`), each adult or child (fixed by option when sold that way), with a guardian for each child (the contact or an adult in the booking);
  - **attendee-specific answers** (Phase 2/G/H).
- **Group handling:**
  - one group confirmation;
  - **partial group check-in** at the door (per person, Phase 2);
  - group details in My Life (`BookingPeople`, Phase I);
  - removing one person, which refunds their share, exists but is locked (`participation.partial_cancel`, owner decision).

**Gap and limit.** Clubs and programmes keep **one person per order**. Siblings are separate registrations, and the fixed forms collect only what each needs. Per-person passes (one QR per attendee) aren't built; the door finds people by booking pass or name.

**Commercial boundary.** Family checkout pricing, settlement and refund allocation are unchanged.

## O2 · Programme lifecycle: implemented (progress)
**Current state:**
- enrolment, sessions and schedule;
- per-session attendance register (present, absent, late, cancelled, no-show);
- enrolment status, cancel and refund;
- session deletion;
- the resident's programme journey (attended, missed, to come);
- messages (Phase K now reaches programmes, with a session filter);
- reports (Phase L).

**Added:**
- Each enrolment's **progress** from the register (sessions so far, attended, missed, not recorded) and **"finished"** once every session is past. This shows on the partner's programme page (`GET /vendor/programs/:id/enrollments` adds `progress`).
- No "completed" attendance threshold is invented (owner decision).

**Not added:** certificates, and a moving-session workflow (sessions are deleted and added).

## O3 · Venue and hall operations: implemented (team notes)
**Current state:**
- **Booking and availability:** rooms with their capacity, rate and description; availability blocks; opening hours; the booking calendar; hall booking requirements via the hall's booking form (Phase H).
- **Changes, people and reports:** booking changes (propose and withdraw); centre-manager role, door check-in; venue usage (Reports by listing).

**Added:**
- **Team notes** on any booking record: setup, equipment, preparation.
  - **Who:** for the listing's managers and owner; never shown to the person who booked, in exports or to finance.
  - **Rules:** append-only, with each note audited (without its text).
  - **Where:** on the record page and the hall booking record (`order_notes`, `POST /api/vendor/orders/:source/:ref/notes`).

**Not added:**
- per-room arrival instructions (the room description and venue "get ready" section serve);
- venue staff assignments beyond check-in staff.

## O4 · Volunteers: audited, already in place
- **Opportunities:** `experiences.kind = 'volunteer'` (the Volunteer registration template).
- **Registration and questions:** the experience form.
- **Shifts:** sessions. **Roles within a shift:** registration options with limits (e.g. "Steward: 6").
- **Attendance:** door check-in.
- **Coordinators:** the two managers, plus check-in-only staff per date.
- **Communication:** Phase K, by session and attended or not.
- **History and reporting:** My Life; Reports.

No new global roles. Volunteer-specific approval (accept or decline applicants) isn't built: bookings confirm directly.

## O5 · Commercial extensions: audited and documented, **not enabled**
| Item | State |
|---|---|
| External payment verification | Not built; no path marks an order paid outside Stripe or cash-on-arrival |
| Cash-due workflows | Existing: cash rooms, clubs and events confirm with "due on arrival" |
| Donations | Not built, not enabled |
| Family or group payment allocation | Group price is priced and paid as one order; allocation per person happens only via the locked partial-cancel |
| Partial cancellation and refunds | Built and **locked** (`participation.partial_cancel`) |
| VAT and booking fees | Existing `pricing.ts` (23% VAT, 5% platform fee). **Irish VAT treatment of each listing type isn't inferred.** Owner, accountant decision |
| Ledger reconciliation | Existing (Stripe TEST sandbox reconciliation suite) |

No commercial setting, switch or payment rule was changed in Phases I–P.

## Tests
- `routes/vendorOrders.test.ts`: team notes. Managers add and read; finance can't; another organisation gets 404; the audit holds no text.
- `routes/vendorPrograms.test.ts`: progress per enrolment (attended, missed, not recorded, finished).

## Release impact
- Team notes and programme progress are visible to partners immediately (no switch).
- Nothing changes for residents.
