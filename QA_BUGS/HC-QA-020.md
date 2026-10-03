# HC-QA-020 — Stale account-link confirmation bypasses existing-link checks

Severity: P1. Status: FIXED LOCALLY — NOT DEPLOYED.

## Remediation and validation

Implemented in server/src/routes/manage.ts: transaction locks token, resident and vendor; rechecks current associations and approved vendor status, then consumes and links atomically. Stale and concurrent confirmation regressions pass: one 200, competing 409, original identity/session invariants retained. No global DB uniqueness migration; additional identity writers remain a separate hardening consideration.

Included in current complete security gate: 39 PASS. Approved isolated-environment
recovery completed; current authentication 20 PASS and authorization 83 PASS;
see QA_REPORT.md. No production/development access or deployment occurred. Raw
operational credential storage remains separate future hardening. The original
failing-before regression assertions were preserved.

## Original finding and proposed remediation
Endpoint: POST /api/manage/link/confirm.

Root cause: initiation checks users.resident_id, but confirmation reads/deletes a
token and unconditionally updates a vendor's resident_id without rechecking either
side's current link. There is no DB uniqueness constraint on resident_id.

Safe reproduction: two synthetic approved vendors request a link to the same QA
resident before either link exists. Legitimately confirm first token; submit second
stale token. Both return 200; two users now reference the same resident. No switch
or impersonation was performed. No authentication cookie was issued by confirmation.
The behavior violates initiation's one-linked-vendor policy and creates ambiguous
privilege-bearing workspace associations. It is not demonstrated tokenless takeover.

Regression: CLOSURE-LINK in account-link-closure.spec.ts, failing before fix;
safe evidence closure-account-link.json contains only status/count/cookie boolean.

Minimum proposed remediation: transactionally lock token, target resident and vendor;
recheck current vendor/recipient links, refuse conflicting links before mutation,
then consume token and set association in one commit. Preserve anonymous bearer-link
confirmation and existing legitimate linking; do not redesign sessions or account UX.
Verify unchanged resident identity/credentials/provider state, vendor roles and sessions.
