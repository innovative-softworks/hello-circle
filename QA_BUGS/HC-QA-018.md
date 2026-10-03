# HC-QA-018 — Email-only activity invitation can be claimed by another resident

Severity: P1. Status: FIXED LOCALLY — NOT DEPLOYED.

## Remediation and validation

Implemented in server/src/routes/invitations.ts: email-only token responses compare normalized authenticated email before mutation. CLOSURE-INV-BIND failed before and passes after; wrong identity 403 with snapshots unchanged, legitimate recipient succeeds.

Included in current complete security gate: 39 PASS. Approved isolated-environment
recovery completed; current authentication 20 PASS and authorization 83 PASS;
see QA_REPORT.md. No production/development access or deployment occurred. Raw
operational credential storage remains separate future hardening. The original
failing-before regression assertions were preserved.

## Original finding and proposed remediation

Root cause: Token response validates resident ID only when populated, ignoring intended email.

Preconditions: synthetic invite-only active game, QA host, QA recipient A and
unrelated resident B; guarded isolated MySQL, no payments or external services.
Regression: `CLOSURE-INV-BIND` in activity-invitation-closure.spec.ts.
Failing-before run preserved. Evidence contains only statuses/booleans/counts.
No credentials, tokens or private payloads are reported.

Expected: no access or relationship mutation without active eligible authorization.
Actual: protected activity becomes readable through the invalid invitation path.
Impact demonstrated only for synthetic activity visibility/participation. No account
takeover, admin access or cross-organisation management was attempted/demonstrated.

Proposed minimum fix: Compare authenticated normalized email for email-only rows before mutation; keep bound resident-ID checks.
Production/development untouched. Full validation and exact safe reproduction are
recorded in QA_STAGE_B_FINAL_CLOSURE.md after remediation.
