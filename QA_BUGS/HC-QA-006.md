# HC-QA-006 — Staff invitation credential disclosure

Severity: P1 (secret disclosure; privilege escalation NOT confirmed).
Status: FIXED LOCALLY — NOT DEPLOYED (disclosure boundary only).

## Latest defensive follow-up — audit records

New invitation audit records no longer contain the bearer credential: creation
uses the existing SHA-256 management ID and adds org ID to safe metadata. Revocation
records only matched management IDs; legacy/unmatched caller input is not persisted.
GET disclosure fix and its regression remain unchanged. Audit regression failed
before and passes after; no historical data/backups modified. Historical audit
credential retention still requires a separately approved operational plan.

Own-recipient existing-account regression returns 409 with full user/session/invite
invariants unchanged and no new cookie. No other person's invitation used, no
successful acceptance or escalation. Acceptance binding/concurrency are deferred
design review items, not fixed or proven exploited. See
QA_INVITATION_SECURITY_REVIEW.md. Older code-review-only statements below describe
the previous checkpoint; current safe coverage adds only existing-self rejection.

## Follow-up audit hardening plan

Creation uses the token as audit object identity even though redemption and audit
identity need not be the same. Replace it with the same SHA-256 management ID
already used by the safe owner response; include org ID, actor, recipient and role
as metadata. Revoke must audit only a matched safe management ID, not unmatched
caller input. No historical audit rows will be rewritten automatically. Add a real
DB regression before changing production code. Keep GET disclosure fix untouched.

## Root cause and affected endpoint

`GET /api/vendor/org` requires an approved vendor but returns pending invitation
tokens to every staff role. The query selects raw `token`, email, intended role
and creation date. It filters pending/unexpired records but does not return expiry
or status. No invitation URL is constructed in this response. Owners, invited
centre/facility managers and read-only analysts receive the same invitation data.
Residents/guests fail the vendor middleware (401).

## Proposed minimal fix

Only owners have invitation-management authority in the current implementation.
Return no pending invitations to invited staff. For owners return email, role,
status, created/expiry dates and a non-redeemable SHA-256 identifier derived from
the 256-bit random token. Revoke by that identifier, still owner/org scoped.
Update the owner UI contract. Do not change creation or acceptance logic.

## Acceptance review — code only

`POST /api/auth/accept-invite` looks up a pending, unexpired bearer token. Recipient
email, organisation and role come from its DB row, not the request body. It does
not compare the current authenticated principal to the recipient or independently
verify inbox ownership. An existing account with that email produces 409; there
is no existing-account role upgrade/linking flow. A new approved vendor/staff user
is created with the invitation's org/role, and a session is issued.

Consumption is marked accepted in the creation transaction. Sequential reuse is
rejected by the pending filter. Validation occurs outside the transaction, without
an atomic conditional consumption/row lock: concurrency is a residual code-review
risk, NOT reproduced here. No invitation redemption or escalation probe is allowed.

## Regression strategy

Real QA API/DB tests: owner creation, staff/manager/resident/guest read boundaries,
no raw token or secret URL in responses, DB unchanged by reads, owner metadata and
revocation by safe ID. Acceptance remains code-reviewed only per the explicit
no-redemption instruction. No acceptance runtime compatibility claim.

## Before / after and fix

Before fix the real API/isolated DB regression failed on the read-only analyst's
raw-token exposure assertion. After fix that same assertion passes. Managers also
receive an empty invitation list. Resident/guest receive 401. Owner metadata has
exactly id/email/platformRole/status/createdAt/expiresAt, no raw token or secret URL.
Reads preserve the entire invite row; owner creation returns 201 and revocation
updates the synthetic invite. Staff revocation is denied; management IDs fail
public token lookup. No invitation was redeemed and no role escalation attempted.

Changed production files: `server/src/routes/org.ts`, `packages/types/src/index.ts`,
`client/src/components/VendorOrg.tsx`, `client/src/api/vendor.ts`. Test:
`tests/integration/specs/invitation-disclosure.spec.ts` via
`npm run qa:authorization -- --grep INVITATION-DISCLOSURE`.

## Residual risks / deployment

- Privilege escalation is NOT confirmed. Acceptance is code-review-only.
- Historical invitation audit records may contain raw tokens. New creation and
  revocation records are hardened in the latest follow-up; no history was rewritten.
- Sequential token reuse is rejected; concurrent acceptance has not been verified.
- IDs hash 32 cryptographically random bytes, not user input, and are not bearer
  credentials. Owner/org checks still apply. No schema migration required.
- Deploy matching server/client together: cached older clients use the removed
  token field for revocation. No deployment occurred.
- No broad Stage B or production-security sign-off is implied.

## Final validation

Safety 91 PASS; client 81 PASS; test typechecking/build PASS; real authentication
and existing HC-QA-002 regressions 20 PASS; authorization/remediation 29 PASS
(including this focused case and HC-QA-003/004/005). Mocked smoke 13 PASS / 1 known
HC-QA-001 failure, unchanged. No invitation-browser or real SMTP integration run.

## Security impact and remediation boundary

Confirmed source-level disclosure of a bearer credential to non-managing staff.
Potential downstream abuse is not claimed as demonstrated privilege escalation.
No development/production access or deployment; unrelated findings untouched.
