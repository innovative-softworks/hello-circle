# HC-QA-019 — Private activity share teaser authorizes invitation creation

Severity: P1. Status: FIXED LOCALLY — NOT DEPLOYED.

## Remediation and validation

Implemented in server/src/routes/invitations.ts: loadViewableGame must authorize before invitation insertion. CLOSURE-INV-CREATE failed before and passes after; unrelated caller 404, host creation and legitimate recipient access preserved.

Included in current complete security gate: 39 PASS. Approved isolated-environment
recovery completed; current authentication 20 PASS and authorization 83 PASS;
see QA_REPORT.md. No production/development access or deployment occurred. Raw
operational credential storage remains separate future hardening. The original
failing-before regression assertions were preserved.

## Original finding and proposed remediation

Root cause: Creation treats getShareData's generic private teaser as authorization to create a relationship.

Preconditions: synthetic invite-only active game, QA host, QA recipient A and
unrelated resident B; guarded isolated MySQL, no payments or external services.
Regression: `CLOSURE-INV-CREATE` in activity-invitation-closure.spec.ts.
Failing-before run preserved. Evidence contains only statuses/booleans/counts.
No credentials, tokens or private payloads are reported.

Expected: no access or relationship mutation without active eligible authorization.
Actual: protected activity becomes readable through the invalid invitation path.
Impact demonstrated only for synthetic activity visibility/participation. No account
takeover, admin access or cross-organisation management was attempted/demonstrated.

Proposed minimum fix: Use loadViewableGame before creating game invitations, preserving eligible sharing and host flows.
Production/development untouched. Full validation and exact safe reproduction are
recorded in QA_STAGE_B_FINAL_CLOSURE.md after remediation.
