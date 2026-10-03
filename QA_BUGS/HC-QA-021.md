# HC-QA-021 — Concurrent activity invitation responses consume one pending invitation twice

Severity: P2. Status: FIXED LOCALLY — NOT DEPLOYED.

## Remediation and validation

Implemented in server/src/routes/invitations.ts: conditional UPDATE requires matching ID/token, pending state and unexpired credential. Only the winner emits successful side effects. CLOSURE-INV-CONSUME failed before (200/200, two notifications), passes after (200/409, one notification); ID and token routes plus replay covered.

Included in current complete security gate: 39 PASS. Approved isolated-environment
recovery completed; current authentication 20 PASS and authorization 83 PASS;
see QA_REPORT.md. No production/development access or deployment occurred. Raw
operational credential storage remains separate future hardening. The original
failing-before regression assertions were preserved.

## Original finding and proposed remediation
Endpoints: POST /api/invitations/:id/respond and token response (shared helper).
Root cause: pending/expiry validation precedes an unconditional UPDATE. Two legitimate
recipient requests can both succeed and emit notification/analytics side effects.
This is bounded invitation-state integrity, not account takeover or role escalation.

Safe reproduction: one synthetic pending invite for QA_USER, two simultaneous
accepted responses. Preserved regression CLOSURE-INV-CONSUME expects 200/409 and one
notification, but failed before remediation. Safe evidence stores statuses/count only.
Minimum fix: condition the state transition on unchanged token, pending state and
unexpired credential. Only the successful conditional UPDATE may notify/log success.
Removed/reissued invitations must also fail the old request. No token storage redesign.
