# HC-QA-007 — Invitation acceptance ignored conflicting authenticated identity

Severity: P1. Status: FIXED LOCALLY — NOT DEPLOYED.
Confirmation: source-level boundary defect; no pre-fix unauthorized redemption or
privilege escalation was performed. No account-takeover claim.

## Root cause / endpoint

POST /api/auth/accept-invite supported signed-out onboarding and also accepted
authenticated requests, but ignored attached vendor/resident/guest identities.
Token possession selected a new account's email/org/role, then replaced the vendor
session without checking whether an existing signed-in identity matched.

## Minimal remediation

Within the authoritative transaction, SELECT the pending/unexpired invitation FOR
UPDATE; compare all authenticated identities' normalized emails against the bound
recipient. Reject any mismatch with generic 403 before mutation. Existing vendor
email still yields 409, not role upgrade. New intended recipients retain onboarding.
No identity-system or UI redesign. Related single-use consumption was transactionally
hardened at the same boundary; duplicate successful consumption was NOT demonstrated
before fix and is not claimed as a separately confirmed exploit.

## Safe regression / evidence

Synthetic QA_USER_B and QA_VENDOR versus QA_USER's invite are denied after the fix.
Mixed A resident/B vendor cookies are denied. Complete invitation/user/resident/
session snapshots remain unchanged, no new cookie or recipient disclosure. Intended
QA_USER with case/whitespace-normalized invitation email succeeds; resulting new
staff identity has exactly the invitation's organisation and read-only role, not
client-injected role/org fields. This is defensive validation, not privilege probing.

Files: server/src/routes/auth.ts; invitation-binding.spec.ts, invitation-fixture.ts.
Related regressions: invitation-consumption.spec.ts and invitation-states.spec.ts.
Residual risk: raw operational storage and historical audit credential retention
are separate. No production/development access or deployment.
