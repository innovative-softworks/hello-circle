# Stage B final security closure — 2026-10-01

## Scope and safety

Only the four remaining review gaps: activity invitations, non-Circle chat,
account-link confirmation, and post-revocation authorization. Guarded disposable
Docker MySQL, restricted runtime identity, real API/backend, synthetic identities.
No development/production access, deployment, external service, Stripe, actual
payment, historical cleanup, broad lifecycle/booking E2E or HC-QA-001 modification.
Existing regressions retained; new regressions failed before their respective fixes.

## Activity invitation lifecycle

Creation is authenticated. For games it now requires canonical loadViewableGame,
not merely getShareData (which can return a private teaser). Eligible people may
share according to the existing product flow; no new owner-only sharing policy.
Each invite is bound to a resident ID, or normalized email for a future account.
Random tokens are raw operational credentials in invitations, not audit metadata.
Duplicate creation reissues a token and resets expiry/pending state. Delivery to an
unknown recipient uses an email CTA; known residents receive notifications. No
external delivery was performed. Ordinary creation/mine/token-lookup response
representations do not return the credential. Email fallback protections remain in
the HC-QA-004 gate; invitation analytics contain entity IDs, not tokens. HTTP URLs
containing credentials must continue to be redacted by any deployment access logging.

Resident-bound responses require that exact authenticated ID. Email-only responses
now require the authenticated account's normalized email; uppercase/whitespace
comparison tested. Wrong identity returns 403 without invitation, participant,
notification, resident/credential or session changes. Correct recipient can accept;
then the resident-ID relationship grants the intended visibility. Token possession
alone no longer overrides a conflicting authenticated identity.

| Actual state / condition | VIEW via invitation | JOIN / WAITLIST eligibility | Respond |
|---|---|---|---|
| pending, unexpired, correct resident binding | Yes | Yes, subject to lifecycle/capacity | Once |
| accepted, unexpired | Yes | Yes, subject to lifecycle/capacity | No replay |
| maybe, unexpired | Yes | Yes, subject to lifecycle/capacity | No replay |
| declined | No | No | No replay |
| expired (derived from expires_at, any stored state) | No | No | Rejected |
| invitation removed | No | No | 404 |

These rules describe the invitation as the only entitlement. An independently
established participant, host or Circle membership remains a separate authorization
relationship; expiring an invite does not silently remove an existing participant.
No activity revoke endpoint or persisted revoked state exists. Revocation tests
remove only the synthetic invitation relationship in QA, then verify all surfaces.
No new revoke UI/API or production cleanup was invented.

Detail, participant list, updates, join and waitlist all use the canonical policy.
Expired/declined invitations previously authorized them: HC-QA-017. Email-token
misbinding: HC-QA-018. Unauthorized invitation creation through private teaser:
HC-QA-019. All three failing-before regressions pass after minimal boundary fixes.

Response consumption now uses one conditional UPDATE (same ID/token, pending,
unexpired). A reissued/removed/consumed credential cannot satisfy it. Only the winner
notifies/logs success. HC-QA-021 before: concurrent responses 200/200, two notifications;
after: 200/409, one notification, sequential replay rejected. Both ID and token
response routes covered with legitimate synthetic recipients. Tokens were not printed.

## Chat runtime

| Scope | Authorized read/write | Unrelated / guest | Child isolation | Revoked participant |
|---|---|---|---|---|
| Circle | Role/child runtime coverage rerun in current full suite | Runtime denials PASS | Child/report checks PASS | Membership checks PASS |
| Game | Joined resident + host | 403 / 401 | Foreign message report denied using actual message parent | Cancelled participant denied |
| Experience session | Synthetic paid-status zero-value booking + owner/manager | 403 / 401 | Foreign message report denied | Cancelled booking denied |
| Programme | Synthetic paid-status zero-value enrollment + owner/manager | 403 / 401 | Foreign message report denied | Cancelled enrollment denied |
| Club | Synthetic paid-status zero-value registration + owner/manager | 403 / 401 | Foreign message report denied | Cancelled registration denied |

No paid flow was run: qualifying records were directly seeded only in QA with zero
amount and no provider session. Owner/vendor pairs are synthetic. Messages, read
markers and report rows remain unchanged on denied operations. Message reporting
derives scope from the message ID, ignoring a supplied alternative parent. Legitimate
member reporting succeeds. No chat edit/delete/moderation mutation endpoint exists
in this router; these were not invented. Game chat neither grants participation nor
changes a hidden activity's 404. Posting-window controls are respected using dynamic
Ireland-local session times; no timing sleeps or clock bypasses.

## Account linking

Initiation: approved vendor requests resident email, checks existing resident link,
stores a 15-minute token and sends a confirmation link. Confirmation intentionally
supports anonymous token possession as inbox proof; it binds the token's vendor and
resident, not an arbitrary body ID. It creates no login cookie. Workspace switching
is a separate privilege-bearing operation and was not used for an exploitation probe.

HC-QA-020: two tokens issued before either link existed could both confirm afterward,
creating two linked vendors. Confirmation now transactionally locks token, resident
and vendor, verifies current vendor approval and both link directions, and consumes
the token only with the successful association. Stale second link/replacement 409;
replay 400. Two competing legitimate confirmations give 200/409 and one association.
Resident credentials/provider data, vendor roles and sessions remain unchanged on
denial. No schema migration or historical duplicate cleanup was performed. The
runtime proof covers these confirmation paths, not a universal DB uniqueness claim
for every other/future identity writer.

One initial combined test batch hit the real five-request email-link limiter. This
was a TEST SETUP issue; split into fresh backend batches, retaining all assertions
and the actual limiter. No artificial retry/delay/limiter bypass was introduced.

## Entitlement / revocation

The exact pending question was game action eligibility derived from invitation or
Circle membership. Authorization queries current DB relationships, not cached session
permissions. Concurrent waitlist vs removal may return 201 or 404 depending on
ordering; a request already authorized before revocation need not be cancelled.
After the revocation commit, detail/participants/updates/join/waitlist all deny,
including reuse of the same authenticated context. Game, participant, waitlist and
notification snapshots remain unchanged for those later requests. Chat also rejects
cancelled participation across all four non-Circle scopes. No stale post-revocation
authorization reproduced after HC-QA-017 remediation; no separate finding necessary.

## Findings and changes

| ID | Severity | Demonstrated issue | Minimal production change |
|---|---|---|---|
| HC-QA-017 | P1 | Expired/declined invitation grants private visibility | gameVisibility.ts status/expiry predicates |
| HC-QA-018 | P1 | Email-only invite claimed by wrong resident | invitations.ts normalized recipient check |
| HC-QA-019 | P1 | Private teaser permits unauthorized invitation creation | invitations.ts canonical game visibility guard |
| HC-QA-020 | P1 | Stale confirmation creates duplicate account link | manage.ts transactional current-state checks |
| HC-QA-021 | P2 | Concurrent invite response succeeds twice | invitations.ts conditional single-use UPDATE |

All changes local; nothing deployed. New fixture closure-fixture.ts and five spec
files provide eight scenarios; runner/reporter include them in both real suites.
No old assertion, HC-QA-014 policy, UI or external provider implementation changed.

## Validation / decision

Approved recovery is complete: a fresh disposable isolated database was provisioned
through the existing bootstrap, with new QA-only credentials and unchanged guards.
Missing-file cause remains UNKNOWN. See QA_ENVIRONMENT_RECOVERY.md.

Current complete runs: security gate 39 PASS (original 31 plus eight closure scenarios),
authentication/security 20 PASS, authorization/remediation 83 PASS. Safety 91 PASS;
client 81 PASS; typechecking/build PASS; mocked smoke 13 PASS / unchanged HC-QA-001
FAIL. All previously blocked validation completed. Connected preflight and repeat
persona verification passed afterward; private configuration retained.

Stage B is SECURITY-COMPLETE LOCALLY for the defined scope, not production-ready.
No confirmed backend P0/P1 remains open locally. Counts are scenarios, not exhaustive
endpoint coverage; overlapping suites are not additive. No next phase was started.

Remaining categories:

- SECURITY HARDENING (not a demonstrated open boundary defect): raw operational
  tokens at rest; database-wide identity uniqueness across additional writers.
- EXTERNAL INTEGRATION PENDING: Stripe test-mode/payment/refund completion, real
  email delivery, Google UI/provider behavior, isolated cloud media delivery/deletion.
- PRODUCTION MIGRATION/DEPLOYMENT PENDING: all local fixes, reviewed historical
  audit-token/attendance cleanup plans, assessment of pre-existing invalid links or
  invitation-created relationships. No historical records changed here.
- UI DEFECT: HC-QA-001 P1 remains OPEN.

No lifecycle, booking-integrity or Stripe testing starts automatically from this report.
