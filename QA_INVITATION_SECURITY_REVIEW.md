# Focused defensive hardening — 2026-09-28

## Closure result — 2026-09-29 (supersedes deferred design below)

Recipient checks and atomic acceptance are now implemented locally in auth.ts.
The transaction locks the valid invite, rejects conflicting attached identities,
rejects existing vendor accounts, validates organisation existence, creates one new
staff account and consumes the invite. Session creation follows successful commit
only. Unique-email collisions return 409 after rollback. The HC-QA-006 organisation
response and audit-disclosure fixes are unchanged.

Recipient mismatch and dual-cookie regressions pass without mutations. Intended
resident onboarding passes with normalized email and ignored role/org injection.
Concurrent intended-recipient acceptance: one 201, one 400, one account, one session;
loser remains anonymous, replay rejected. Existing same/conflicting role invitations
cannot upgrade a member. Expired/accepted/revoked invitations reject new accounts.
HC-QA-007 tracks the authenticated identity-binding defect separately from HC-QA-006.

Historical remediation is tested only on four synthetic QA records; production
handling is a PLAN in QA_INVITATION_AUDIT_MIGRATION_PLAN.md. Historical production
records are neither inspected nor claimed remediated. Raw operational token storage
remains intentionally unchanged. Older deferred-review sections are historical.

Closure validation: safety 91 PASS, client 81 PASS, typechecking/build PASS,
authentication/security 20 PASS, authorization/remediation 37 PASS (8 invitation
cases included), mocked smoke 13 PASS / 1 unchanged HC-QA-001 failure. All original
HC-QA-002 through 006 regressions pass. No confirmed high-risk local invitation
acceptance defect remains in the tested boundaries. Historical exposure outside QA
and generic exceptional-path logging remain operational/security review risks.
Controlled Stage B testing in isolated QA may resume after approval, not automatically.

## Invitation closure design — 2026-09-29

Before modification: `/auth/accept-invite` is public and accepts both signed-out
and signed-in requests. The UI collects name/password/terms, not an email; the
invitation record supplies recipient, organisation and role. Acceptance creates a
new approved vendor staff account and a vendor session. Existing vendor email is
rejected; it is not a membership-upgrade API. Resident and vendor identities are
separate and can coexist in one browser. No existing identity comparison is made.

Minimal planned boundary: inside the same transaction, lock a pending/unexpired
invite, compare ALL server-established vendor/resident/guest emails (normalized)
with its recipient, reject any conflict without changes, reject existing vendor
accounts, verify the organisation exists, create the intended new account and
consume the invitation. Only a committed successful result can create a session.
Logged-out legitimate onboarding remains supported. No client-provided identity,
role or organisation is authoritative. Unique-email races return a safe conflict.

Historical cleanup design: use only exact synthetic audit IDs in isolated QA;
lock each historical record and matching credential, classify active/expired/
accepted/revoked, revoke a still-active exposed invitation BEFORE replacing audit
credential fields with the safe identifier, retain event metadata. Unknown records
must abort for review. Production receives a plan, never execution.

Local QA only, no production/development access or deployment. No other person's
invitation was redeemed, no privilege escalation probe, no broad Stage B expansion.

## Status reconciliation

HC-QA-003/004/005 fixes were already present at the start of this checkpoint.
Fresh original regressions passed, not newly weakened/rewritten to claim fixes.
They are **FIXED LOCALLY — NOT DEPLOYED**, not currently open local regressions.
HC-QA-005 gained one narrow adjacent correction: saved club-session hydration
referenced `cl.status` while its SQL alias was `c`, causing a 500 even for public
sessions. The new test failed before the one-token alias correction and passes
after, including approved -> pending -> approved parent visibility and unchanged
saved relations. The existing activity/host-feed visibility test is unchanged.

## Invitation audit records

Root cause: `org.staff_invited` used the bearer token as audit `object_id`.
This was readable through admin audit history as well as direct DB access.
New audit records now use SHA-256(token), the existing non-redeemable management
ID, plus org ID, actor, recipient email, role and event/timestamp. No credential
is put in metadata. Owner revocation audits only matched safe IDs, never arbitrary
unmatched caller input. GET /vendor/org's HC-QA-006 disclosure fix is unchanged.

The real DB regression first failed on raw-token persistence. It now checks create
and revoke history and verifies that an old-style raw-token revocation request
does not mutate the invite or insert a credential-bearing audit record. These are
the owner's own synthetic fixtures, not redemption attempts. Historical audit rows
and backups are NOT scrubbed automatically. Before deployment, operators should
review retention/access, invalidate affected live invitations as appropriate, and
approve a scoped migration to replace historical audit credentials. No such action
was taken against development/production here.

## Recipient binding — design, not implementation

Current: global middleware populates vendor/admin `req.user`, resident and guest
identity before `/api/auth/accept-invite`. The handler ignores those identities,
selects a pending unexpired token, and takes email/org/role from the DB record.
The new account and session are therefore bound to token possession, not proof
that a currently authenticated principal is the intended recipient.

Minimal proposed design:

1. If a principal is signed in, compare its server-established canonical email
   with the invitation recipient. Reject mismatches before any mutation; do not
   silently replace an authenticated identity/session.
2. Account for BOTH vendor and resident cookies. Conflicting signed-in identities
   must fail closed rather than choosing whichever cookie grants access.
3. Preserve existing-email rejection; do not convert acceptance into membership
   upgrade or credential linking. Supporting existing accounts requires a separate,
   explicitly authorized flow and ownership proof.
4. Keep logged-out, new-recipient emailed-link registration as the current product
   flow unless a separate verification redesign is approved. Token possession
   remains security-sensitive; no client-supplied email/role/org is authoritative.

Deferred for review, not implemented. No mismatched-recipient test was attempted.
Safe integration coverage uses the authenticated synthetic owner as the intended
recipient of its OWN lower-role invitation: returns 409, no new cookie, complete
user/invite/session snapshots unchanged. No successful acceptance occurred.

## Concurrent acceptance — code review only

Pending/expiry SELECT and existing-email lookup occur before the transaction.
The transaction inserts the user and unconditionally updates invitation status;
session creation follows commit. Unlike HC-QA-003, there is no FOR UPDATE or
conditional single-use claim at validation. Concurrent callers may both validate.
The unique `users.email` constraint is an important backstop: two successful
accounts/sessions have NOT been demonstrated and must not be claimed.

Proposed narrow change, deferred: inside one transaction lock the valid invitation,
validate recipient and existing-account constraints, create the account, conditionally
consume the invitation; commit before session creation. Translate uniqueness races
into safe conflicts. Future safe test: two requests representing the SAME newly
invited synthetic recipient, exactly one acceptance/account/session and safe loser,
plus expiry/replay/rollback checks. This checkpoint does not execute that test.

## Narrow secret-storage inventory (source inspection)

Raw means no application-layer hashing/encryption found; infrastructure disk/backup
encryption was not assessed. Password hashes are bcrypt and are not bearer tokens.

| Secret | Application persistence | Logging / API behavior |
|---|---|---|
| Resident/vendor recovery | Raw in resident_password_reset_tokens / password_reset_tokens | Emailed URLs; request API does not return tokens. sendMail fallback/provider errors are constant diagnostics. Reset lock+delete is transactional. |
| Email verification / magic login | Raw guest_login_tokens; 15-minute expiry | Emailed URLs, not returned by request API; verification consumes with row lock. |
| Signup completion | Raw resident_signup_tokens; 15-minute expiry | Returned as completionToken after successful email-token verification; consumed with row lock. |
| Organisation invitation | Raw org_invites token; seven-day expiry | Emailed URL; general org read no token; owner management ID is SHA-256 only. New audit records no raw token; historical records may still contain it. Public lookup returns recipient email/role/org name only to token bearer. |
| Resident activity invitations | Raw invitations.token | Email link; /mine and token-preview responses project metadata, not token. No mutation testing in this review. |
| Account-link magic token | Raw manage_link_tokens | Emailed link; no request API token response; existing audit metadata uses account IDs. Consumption design not part of this remediation. |
| Vendor/admin sessions | Raw sessions.token | HttpOnly session cookie, not ordinary user JSON. |
| Resident sessions | Raw guest_sessions.token | HttpOnly cookie; native authentication branches intentionally return bearer token in JSON. Not general profile data. |

No hashing/encryption migration was performed. Hashing high-entropy bearer tokens
at rest would reduce DB-read compromise impact, but needs a separately scoped
migration/compatibility plan. Secret-bearing URLs can also reach infrastructure
access logs/history; those systems were not accessed or certified.

The narrow logging review also found `googleAuth.ts` prints provider exception
messages, `audit.ts` prints raw DB errors, and the global handler in `index.ts`
prints request paths and error objects (while returning a generic 500). A path
containing an invitation credential or a DB error containing bound SQL may therefore
reach logs on exceptional paths. No live exception-triggered disclosure was
reproduced here; these paths need separately scoped redaction/negative tests.
HC-QA-004's email fallback and SMTP exception logging are already constant-only,
verified with synthetic canaries and fake transports (not real SMTP delivery).

## Closely related aggregation review

- Detail, favourites and host-follow feed share canViewGame; original and state
  transition regressions pass, including public -> private/draft and relation retention.
- Public archived/cancelled activity remains readable when canonical detail permits
  it; deleted/inaccessible items are omitted, not identifiable placeholders.
- Host public-profile game query filters status/visibility/date but not effective
  draft lifecycle. Circle upcoming/next-plan queries lack per-game visibility gates.
  These are unresolved source-level candidates, NOT newly reproduced defects here.
- Upcoming/discovery DB queries filter visibility and discoverable lifecycle, but
  scheduled publish-time equivalence with canonical detail requires verification.

No blanket aggregation security claim. No unrelated routes were actively probed.
These candidates remain queued for separately approved, scoped defensive validation.

## Final validation / decision

Safety 91 PASS, client 81 PASS, test typechecking/build PASS, real authentication/
security 20 PASS, authorization/remediation 32 PASS. Original HC-QA-002 through
006 regressions PASS. Mocked smoke 13 PASS / 1 unchanged HC-QA-001 failure.
No live SMTP/OAuth/cloud/payment test. HC-QA-003/004/005/006 remain local-only fixes.

Known named recovery/authentication and targeted disclosure defects are locally
remediated. Invitation binding/atomicity and historical audit retention still need
review; related aggregation candidates prevent blanket authorization sign-off.
Recommendation: review those items before approving broad Stage B resumption.
No automatic continuation and no production readiness claim.
