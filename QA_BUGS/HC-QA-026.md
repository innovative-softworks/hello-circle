# HC-QA-026 — Waitlist state diverges from participation: phantom held offers and unclaimable offers

## Remediation — 2026-10-01 (current): FIXED LOCALLY — NOT DEPLOYED

Where: server/src/waitlist.ts, server/src/routes/games.ts.
Authoritative availability for an offer: (joined + pending_payment) + unexpired held offers < capacity, never for a cancelled game (`gameHasFreeSpot`). Promotion and manual offers require it; waiting/offered entries of residents who already hold a place are resolved (`claimed`) instead of offered; a join resolves the joiner's waiting entry too; a participant cannot also waitlist (409). Club waitlist behaviour unchanged.

Verification (isolated QA, real API/MySQL/browser): HC-QA-026 (original), HC-QA-026-OFFER-WHEN-FULL and HC-QA-026-INVARIANT: full → waitlist (one per resident, none for participants, multiple waiting); manual offer while full 409; leave → exactly one offer to first in line; held spot blocks others; claim; second offer; expiry (safe control on the test's own row) releases capacity; offer to a since-joined resident refused. taken + held ≤ capacity and zero stale entries asserted at every step.
The original failing-before regression is unchanged and now passes. Gate: `npm run qa:lifecycle -- --grep 'HC-QA-026'`.
Security gate HC-QA-002..021 re-run green after remediation.

## Original finding (historical)

Severity: P2. Category: FUNCTIONAL. Found: Phase 7 lifecycle validation, 2026-10-01.
Original status (Phase 7 discovery): OPEN.
Environment: guarded disposable MySQL `hello_circle_e2e_qa_7a01b2c0c87998f1`, real Express/React, synthetic free
activities, no Stripe/email/external services. Evidence contains statuses/counts/booleans only.
Regression: preserved as an UNSKIPPED failing test in `tests/integration/specs/lifecycle-findings.spec.ts`;
verify with `npm run qa:lifecycle -- --grep 'HC-QA-026'`. It must turn green after a fix without editing the assertion.

## Journey
Capacity + waitlist (Parts 8-9)

## Expected
A resident is either a participant or waitlisted, not both; a direct join resolves their waitlist entry; an offer only exists when a spot exists.

## Actual
(1) A joined participant can join the waitlist (201). (2) Full activity, A waitlists, host raises capacity, A joins directly — A's entry stays 'waiting'. When another participant leaves, A (already joined) is promoted to 'offered', notified "A spot opened up", and the held offer blocks everyone else for 48h: another resident gets 409 "full" with 2/3 joined. (3) Host 'invite from waitlist' succeeds while full (200) but the offered resident's join returns 409 full. Capacity is never exceeded; the defect is lost capacity and misleading offers.

## Likely source
`server/src/routes/games.ts` POST /:id/waitlist (no already-joined / not-full check), POST /:id/join only claims 'offered' entries via `claimWaitlistOffer`; `server/src/waitlist.ts` offerToWaitlistEntry has no capacity check; PUT /:id capacity increase does not promote (documented as not implemented — not itself a defect).

## Proposed minimum fix (not applied)
On join, close any 'waiting'/'offered' entry for that resident; reject waitlist for joined residents; skip/clean entries of already-joined residents in promotion; check capacity before a manual offer.

## Regression / security
Not a regression of HC-QA-002..021; security gate unaffected. No production/development data, payment or email involved.
