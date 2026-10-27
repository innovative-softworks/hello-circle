# Circles 3.0 — 09 Regression report

- **Free-text plans**: unchanged (no `listing` → `listing: null`); conversion to activity unchanged (63 existing
  Circle tests pass, including the concurrent-conversion guard).
- **Share to Circle**: unchanged unless `addAsPlan` is sent; response adds `planId` (null by default).
- **Reports**: existing target types unchanged; one type added.
- **Bookings, payments, Stripe, VAT, fees, waitlists**: no code touched. Booking state is only *read*.
- **Visibility**: listing visibility reuses the listing pages' own filters; no route changed.
- **Schema**: additive nullable columns + index; no existing data rewritten.
- **Known unrelated failure**: `complaintsSubject.test.ts` in the full run only (see 08).
