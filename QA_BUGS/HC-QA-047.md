# HC-QA-047 — Programme enrolment and paid activity confirmations showed the base price, not the amount charged

Severity: P2. Category: UX / BOOKING (pricing transparency). Status: FIXED LOCALLY — NOT DEPLOYED.
Found during the Phase 8 remediation cross-model review of HC-QA-042 (same defect pattern).

- **Actual (before):** the programme enrol modal footer showed `€25.00 for every session`, and the paid activity confirmation showed `€8.00 each`. The server charges `computePricing()`, i.e. **€32.00** / **€10.24** (+23% VAT, +5% platform fee). The provider checkout page would show the real total, but the in-app confirmation didn't.
- **Evidence of the before state:** source comparison (both confirmations rendered only `priceCents`). The pre-fix UI was not re-executed, because the fix shipped in the same pass.
- **Fix:** `GET /api/programs/:id/quote` and `GET /api/games/:id/quote` (visibility-gated like detail) use the same pricing as checkout. The confirmations display the quoted total with VAT and fee. Listing cards keep the per-person price.
- **Regression:** `HC-QA-047` in `tests/integration/specs/booking-findings.spec.ts` checks that the enrol modal shows €32.00 and the join confirmation shows €10.24. PASS.
- **Not affected:** hall booking and club registration flows already showed the full VAT/fee breakdown.
