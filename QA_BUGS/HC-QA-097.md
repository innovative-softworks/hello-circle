# HC-QA-097 — Refunded experience bookings and programme enrolments disappeared from My Life

Severity: P3. Category: DATA / UX. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 11B, 2026-10-03). Found while implementing the Phase 11B self-cancel refund states.

- **Where:** `GET /api/experiences/bookings/mine`, `GET /api/programs/enrollments/mine`.
- **Problem:** Both filtered `payment_status = 'paid'`. As soon as a provider refunded a booking or enrolment, it vanished from the resident's My Life. That left no record that it existed or was refunded, and made an accurate "Refunded" state impossible to show.
- **Fix:** The lists include `payment_status IN ('paid', 'refunded')` and return a server-computed `refundState` (`none` / `pending` / `refunded`). The timeline still excludes cancelled rows from "upcoming".
- **Regression:** HC-GAP-EXP-1, HC-GAP-PROG-1 and HC-GAP-STRIPE-* (real TEST refund) assert the refunded row stays listed with `refundState: "refunded"`.
