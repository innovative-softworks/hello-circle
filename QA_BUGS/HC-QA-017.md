# HC-QA-017 — Expired or declined activity invitations grant visibility

Severity: P1. Status: FIXED LOCALLY — NOT DEPLOYED.

## Remediation and validation

Implemented in server/src/gameVisibility.ts: only unexpired pending/accepted/maybe invitations grant this relationship. CLOSURE-INV-STATE failed before and passes after; invalid states deny all five surfaces. Independent participant/host/Circle entitlements remain separate.

Included in current complete security gate: 39 PASS. Approved isolated-environment
recovery completed; current authentication 20 PASS and authorization 83 PASS;
see QA_REPORT.md. No production/development access or deployment occurred. Raw
operational credential storage remains separate future hardening. The original
failing-before regression assertions were preserved.

## Original finding and proposed remediation

Root cause: canViewPrivateGame matches an invitation row without status/expiry predicates.

Preconditions: synthetic invite-only active game, QA host, QA recipient A and
unrelated resident B; guarded isolated MySQL, no payments or external services.
Regression: `CLOSURE-INV-STATE` in activity-invitation-closure.spec.ts.
Failing-before run preserved. Evidence contains only statuses/booleans/counts.
No credentials, tokens or private payloads are reported.

Expected: no access or relationship mutation without active eligible authorization.
Actual: protected activity becomes readable through the invalid invitation path.
Impact demonstrated only for synthetic activity visibility/participation. No account
takeover, admin access or cross-organisation management was attempted/demonstrated.

Proposed minimum fix: Require unexpired pending/accepted/maybe invitation in the canonical policy; declined and removed relationships grant nothing.
Production/development untouched. Full validation and exact safe reproduction are
recorded in QA_STAGE_B_FINAL_CLOSURE.md after remediation.
