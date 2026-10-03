# HC-QA-044 — Hard-deleting a club session orphans its registrations

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Deleting a club session that has registrations deactivates it (`active = 0`, history kept, closed to new registrations, the same convention as rooms); an unused session is still deleted. Verified: empty → `deactivated:false` and removed; used → `deactivated:true`; a new registration for it → 400; 0 orphans.

The original failing-before regression in `booking-findings.spec.ts` is unchanged and now passes (`npm run qa:booking -- --grep 'HC-QA-044'`). Extended scenarios are in `booking-remediation*.spec.ts` / `booking-provider.spec.ts`. The security gate (HC-QA-002..021) and the lifecycle gate (HC-QA-001, 022..033) were re-run green. No payment provider was configured or called.

## Original finding (historical)

Severity: P3. Category: DATA INTEGRITY.
Original status (Phase 8 discovery): OPEN.
Environment: guarded disposable MySQL, real Express/React, synthetic resources owned by the QA vendor, payment provider unconfigured (no Stripe/email). Evidence holds only statuses, counts and amounts.
Regression: an unskipped failing test in `tests/integration/specs/booking-findings.spec.ts`. Verify with `npm run qa:booking -- --grep 'HC-QA-044'`. It must turn green after a fix without changing the assertion.

## Journey
Data integrity (Part 28)

## Expected
Removing a session never leaves registrations pointing at a missing session (deactivate instead, as rooms do).

## Actual
`DELETE /api/club-sessions/:id` with an active registration on that session → 200, and the registration's `session_id` now references nothing (1 orphan).

## Likely source
`server/src/routes/clubSessions.ts` DELETE runs `DELETE FROM club_sessions`. There are no FKs (by design), so nothing guards it.

## Proposed minimum fix (not applied)
Soft-deactivate (`active = 0`) like rooms, or block deletion while active registrations exist.

## Regression / security
Not a regression of HC-QA-001..033 (those gates stay green). There's no cross-user or cross-organisation authorization failure: booking ownership tests passed. No payment provider was contacted.
