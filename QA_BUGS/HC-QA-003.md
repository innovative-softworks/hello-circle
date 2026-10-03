# HC-QA-003 — Concurrent recovery-token reuse

Status: FIXED LOCALLY — NOT DEPLOYED. Severity / priority: P1. Historical reproduction below remains evidence, not current behavior.

## Fix and verification

Affected files: server/src/routes/guestAuth.ts and server/src/routes/auth.ts. Token row locking, bound password update and deletion now share a MySQL transaction. Only the resident winner reaches existing session creation; vendor recovery continues to create no session.

Before: original concurrent regression failed, HTTP 200/200 and two sessions. After: SAME regression passed; adjacent tests require sorted statuses [200,400], hash matching only the winning submission, anonymous losing context, rejection of serial replay and one resident session. Independent account tokens pass concurrently. Vendor reset also passes winner/replay/expired/unknown/no-session checks. Existing resident expired/token binding checks remain in the unmodified authentication suite.

Residual risk: session issuance follows transaction commit, as before; a later session-delivery error does not roll back an already successful password change. Existing session revocation policy was not redesigned. Multiple distinct valid recovery tokens are not globally revoked by this scoped change. No deployment or deployed MySQL engine verification performed.

## Phase 5 proposed minimal remediation

Root cause traced in routes/guestAuth.ts: request-password-reset generates a random 32-byte token, stores it with the normalized account email and 30-minute expiry, then emails the link. reset-password performs an unlocked valid-token SELECT, separately finds the resident, updates the password, deletes the token and creates a session. Concurrent readers both reach the mutation. routes/auth.ts has the same unlocked sequence for vendor/admin reset (without automatic session creation).

Use the existing db.transaction with SELECT ... FOR UPDATE on the token's primary key. Inside that same transaction, update only its bound account and delete the token. Return the successful account only after commit. Preserve existing session behavior: resident winner creates one session after commit; vendor/admin reset creates none. No schema or hashing change. Apply to both reset handlers; do not change HC-QA-002 signup behavior. Expired/unknown/consumed tokens retain the existing safe 400 response. Adjacent tests will check winner password, loser cookie/state, replay, invalid/expired and independent tokens.

Affected resource: resident credentials and sessions. Endpoint: POST /api/guest/reset-password. Required role: unauthenticated caller **possessing a valid recovery token**. Victim: synthetic password resident.

## Safe reproduction

Run `npm run qa:authorization -- --grep HC-QA-003` against the guarded disposable QA environment. The regression creates a random synthetic account, requests recovery, retrieves the token through the guarded QA connection (simulating inbox possession), and submits two concurrent requests with different generated passwords. No actual email, customer identity or external service is involved.

Expected: exactly one credential change and one successful authenticated response; the second consumption is rejected.

Actual: HTTP 200 twice; two sessions in guest_sessions; both independent request contexts resolve to the same synthetic resident. Token count is zero afterwards. The final hash matches one submitted password and differs from the original. No hashes, tokens or passwords are stored in evidence.

Database evidence: `.qa-data/<run>/evidence/hc-qa-003.json` contains statuses and boolean/count invariants only. Fixture identity, tokens and sessions are removed by independently guarded exact-email cleanup.

## Impact and cause

Single-use recovery semantics fail under concurrency. Both readers can SELECT the same unexpired token before either DELETE; password changes and session creation are not atomically bound to successful token consumption. A party possessing the token can retain a session even if the competing reset supplies the eventual password. This is not evidence of guessing a token or bypassing inbox possession, so it is not classified P0.

The vendor/admin reset route has a similar SELECT/update/delete shape, but concurrent execution there is NOT demonstrated by this regression.

Recommended remediation: transactionally lock and consume the token with the bound credential change; only the winning request may create a session. Review session invalidation policy separately. Do not simply move an unchecked DELETE earlier.

Regression preserved: YES, `tests/integration/specs/authorization-recovery.spec.ts`, intentionally failing until approved remediation. Parallel timing is scheduler-dependent; the recorded two-success run confirms impact, while any later single-success run alone does not prove a fix.
