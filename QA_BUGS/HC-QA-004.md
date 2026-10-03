# HC-QA-004 — Secret-bearing email links exposed through fallback logging

Status: FIXED LOCALLY — NOT DEPLOYED. Severity / priority: P1 conditional. Historical reproduction below remains evidence, not an anonymous log-access or production compromise claim.

## Fix and verification

Affected file: server/src/email.ts. No-transport fallback now logs a constant diagnostic without message body/subject/recipient. SMTP errors also produce a constant error without raw provider message/object. Existing nonthrowing delivery behavior and API response semantics remain unchanged.

Before: original canary regression failed in test and production mode. After: SAME regression passes. Nine adjacent mode/transport cases pass: production/test/development crossed with absent/success/failure transport. Captures cover log/warn/error/info and secret-bearing provider exception text. Transport success/error is a local fake nodemailer transport, not actual SMTP delivery. No network or real credential used.

Residual risk: operational delivery remains dependent on correctly configured SMTP. No secret-logging development switch exists; configure a local SMTP test inbox for development instead. Historical deployed logs/retention/access require separate operator review. This change does not erase historical logs or claim a production deployment.

## Phase 5 proposed minimal remediation

SMTP_HOST/USER/PASS presence determines the transport; NODE_ENV is not checked and VITEST forces the no-transport branch. sendMail currently prints msg.text, so every secret embedded by recovery/verification callers reaches stdout. The configured-transport catch also prints arbitrary Error.message, which can contain request/provider content.

Replace both branches with fixed generic diagnostics without recipient, subject, body, URL or exception object/message. Retain nonthrowing delivery semantics and API responses. No secret-logging opt-in will be added; development usability is via explicitly configured local SMTP/test inbox rather than shared console output. Adjacent tests will capture both log and error in isolated child processes for production/test/development, and use a fake SMTP transport for success/error without external delivery. This does not claim deployed SMTP/log access verification.

Affected resource: recovery, verification and sign-in bearer links. Source: server/src/email.ts, sendMail fallback. Recovery callers include POST /api/guest/request-password-reset and POST /api/auth/request-reset; verification callers include resident signup/resend.

Required access: someone able to read application logs when SMTP_HOST, SMTP_USER or SMTP_PASS is missing. The fallback is not limited to development. VITEST also forces the logging path. A configured SMTP transport throwing during delivery follows a different error path; that is not the full-body fallback demonstrated here.

## Safe reproduction and evidence

`npm run qa:authorization -- --grep HC-QA-004` imports the actual email module in isolated email-only child processes, once with NODE_ENV=test and once with NODE_ENV=production. It never starts a production backend, loads production credentials, imports the database or sends email. A noncredential canary substitutes for the secret. console.log is captured in memory and only a boolean is returned.

Expected: no token-bearing message body written to logs.

Actual: fallback writes the entire text message, including the canary recovery link, in both modes. `.qa-data/<run>/evidence/hc-qa-004.json` records booleans only. Regression preserved and failing: authorization-logging.spec.ts.

Database evidence: not applicable, no database mutation needed for this finding. The isolated QA backend suppresses console output, so real QA tokens were not exposed.

Impact: when this configuration occurs in a deployed environment, log readers could obtain active bearer credentials. Production SMTP configuration, log access controls and historical exposure were not inspected and are unknown. P1 reflects credential disclosure potential with the demonstrated configuration prerequisite, not P0 tokenless takeover.

Recommended remediation: never log secret-bearing message bodies; fail safely or use an explicitly isolated local sink. Audit retention/access separately. No fix made during this checkpoint.
