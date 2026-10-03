# HC-QA-002 — Signup takes over an existing passwordless resident

**Current status: FIXED and regression-verified in isolated local QA (2026-09-27). Historical severity remains P0. Not deployed to production by this checkpoint.**

## Remediation result

The minimal service change is `if (existing) return null` in `createResidentWithPassword`, replacing the credential/terms mutation branch. The existing route returns its generic 409 before session or verification-token creation. The client API comment was corrected; frontend behavior, routes, provider verification, password hashing and schema were not changed.

The original `SEC-REVIEW-001` spec is unchanged: **FAIL before fix, PASS after fix**. Latest evidence: signup 409; passwordAssigned=false; existingIdentityAccessible=false; googleLinkPreserved=true; protected endpoint 401. The original probe's `NOT CONFIRMED` label now describes the post-fix attack result, **not a downgrade of the originally confirmed defect**.

Full real suite: **20 passed** (8 existing authentication checks, the original security regression, 11 focused security cases). Four bounded batches run fresh backends to respect the existing shared rate limiter, with no retries or relaxed assertions. Sanitized current results: `.qa-data/qa_91c6dd08741f075d/evidence/auth-results-{core,collisions,flows,recovery}.json`. The unbatched result file is historical and is not the aggregate current report.

Focused coverage verifies direct API and real browser rejection; unchanged complete resident row (ID/email/hash/linkage/host role/profile/consent); zero attacker sessions/cookies/tokens/redirect; attacker password rejected; actual HelloCircle Google UID resolution remains correct. No live Google/Firebase authentication is claimed. New signup still creates exactly one account, its intended initial session and a 15-minute verification token; confirmation and serial replay rejection pass. Existing password login/logout and the original persistence/protected-route tests pass.

Normalization: case variants conflict; whitespace is rejected by existing API format validation, while the trimmed service call also refuses linking. Concurrent new signup returns one 201 and one 409, leaves one row and one session, and preserves the winner's password. `residents.email` remains uniquely constrained; no migration needed.

Recovery tests: passwordless reset request creates no token/session; invented-token reset fails without state change. Password-bearing accounts require the actual account-bound secret; expired tokens and serial replay are rejected. Tests retrieve synthetic tokens from QA MySQL to simulate inbox possession; they do not claim email delivery. The existing authenticated `/api/residents/me/password` path remains separate and session-gated; no new linking feature was implemented.

**Separate findings, not fixed here:** potential concurrent reset-token replay due to nontransactional SELECT/update/delete (source finding, not reproduced); existing non-SMTP mail-body logging includes secret links (deployment exposure not assessed). Neither is an observed email-string-only reset takeover. Track these independently; no authentication logs or provider details were added. Logout's retained empty cookie was verified non-authenticating and handled separately from the strict zero-cookie requirement for rejected signup.

HC-QA-001 remains OPEN. The repaired signup boundary is ready for a separately approved isolated authorization/IDOR checkpoint, not a claim that all authentication/security risks are resolved. Stop for review; review/deploy this fix before treating production as remediated.

## Root Cause

Public signup used a null password hash as permission to add credentials to an existing identity. `getResidentPasswordHash` finds residents by lowercased, trimmed email. Google-created and magic-link accounts legitimately have no password; they are not incomplete registrations. `createResidentWithPassword` nevertheless updated their password and sometimes terms metadata, returning the existing resident to the caller. Google linkage is separately recorded in `google_uid`; the unsafe branch did not inspect or require proof for any provider.

## Vulnerable Code Path

`client/src/components/AuthForms.tsx:SignupForm` → `client/src/api/resident.ts:signupWithPassword` → `POST /api/guest/signup` → production bcrypt hash → `createResidentWithPassword` → normalized email lookup → existing/null-hash branch → `setResidentPassword(existing.id, hash)` → return original resident → `createGuestSession` → session cookie → confirmation-email token created afterward. The UI invokes its success callback only on successful API response and already displays the generic API conflict error.

## Security Invariant Violated

An email string is not proof of ownership. Public signup must not mutate credentials, consent/profile state or provider linkage, nor issue a session, for any existing identity. A null password does not authorize account linking.

## Proposed Remediation

Return the existing-account conflict sentinel for **every** existing resident, regardless of password/provider state. Preserve the API's existing generic 409 response and the authoritative unique-email constraint / `ER_DUP_ENTRY` handling. No schema, OAuth, UI or hashing redesign is needed. New-email signup keeps its current verification/session behavior. Any future add-password feature must use a separately proven-ownership flow.

Recovery audit: resident reset requests only generate a token for password-bearing accounts; the response is generic. Reset requires a 256-bit random, account/email-bound, unexpired token. Email verification/magic-link tokens have 15-minute expiry and transactional consume/delete; reset tokens have 30-minute expiry and sequential delete after password update. The latter has a **separate potential concurrent replay race**, not an email-only takeover path; this checkpoint must not claim transactional reset replay protection. Google resolution remains UID-first, with explicit email-collision rejection. No provider-specific email canonicalization is proposed.

Logging audit: no new credential/request logging is needed. Existing `email.ts` non-SMTP fallback logs mail bodies containing verification/reset links; QA suppresses this already. This is separate hardening debt, not introduced by the fix. Signup/login already share a 10-attempt/15-minute IP limiter; reset-link requests share the tighter magic-link limiter.

## Regression Strategy

Re-run the original unchanged failing regression before and after the service fix. Add direct API and real signup-UI tests covering Google-linked/passwordless and password-bearing collisions, normalized email variants, repeated attempts, rejected attacker login, no session/token issuance and unchanged DB identity/credentials/linkage/profile/roles. Exercise original HelloCircle Google account resolution without pretending to test Google UI/Firebase verification. Verify legitimate new signup and confirmation, existing login/session/logout, unique-email races, and recovery-token rejection/expiry/single-use behavior in isolated QA only. Keep all secret values/hashes/tokens out of diagnostics.

## Historical reproduction (before remediation)

Original status: **CONFIRMED SECURITY DEFECT — OPEN**. Severity / priority: **P0, release blocker**. Current fixed status is recorded above.

Area: resident authentication and credential linking. Affected endpoint: `POST /api/guest/signup`.

## Environment and preconditions

Reproduced only on the real local QA backend and disposable MySQL run `qa_91c6dd08741f075d` on 2026-09-27. No production, shared development, Firebase, email provider or real customer account was used.

The synthetic resident had a unique `@example.test` email, a null `password_hash`, a synthetic `google_uid`, an existing profile name and a populated `email_verified_at`. This models an existing Google-linked passwordless resident; it does not claim a real Google/Firebase login was tested. The requester began without cookies or identity proof.

## Exact safe reproduction

Use only the guarded disposable environment described in `QA_ENVIRONMENT.md`. `npm run qa:auth -- --grep SEC-REVIEW-001` runs the preserved regression after independent database/container verification.

1. Insert the isolated fixture through the verified restricted QA connection using the application's actual resident schema.
2. Confirm the existing row has no password hash and the requester has no session.
3. Submit `/api/guest/signup` with the existing synthetic email, a newly generated password, an unrelated requester name and terms acceptance. Supply no email-verification token, Google token or authenticated session.
4. Read `/api/residents/me` and `/api/residents/me/receipts` using the resulting request context.
5. Check the original row's password hash and Google UID through the verified database connection.
6. Independently recheck isolation, then delete only the probe's exact session/token/email and resident-ID/Google-UID tuple. No blanket cleanup.

## Expected versus actual

Expected: reject credential assignment/account access until ownership is proven; preserve the existing passwordless identity unchanged. A duplicate-account conflict or explicit ownership-verification flow is appropriate.

Actual, observed together:

- Signup returned **201**.
- The original row's password hash matched the newly submitted password using bcrypt.
- The unauthenticated requester received access to **the original resident ID and profile name**, not a new account.
- The existing synthetic Google link was preserved.
- The protected receipts endpoint returned **200** with that session.
- No identity proof was provided. Sending a later confirmation email did not prevent immediate access.

Security impact: demonstrated takeover of a passwordless resident identity, including password assignment and authenticated access. Real customer data access, production exploitability, vendor/admin takeover and further privilege escalation were **not tested**.

## Evidence

Sanitized machine evidence path: `.qa-data/qa_91c6dd08741f075d/evidence/passwordless-signup.json`; this file now contains the latest **post-fix** rerun. The before-fix observations are preserved in this historical report and execution record.
Original Phase 3 suite result: 8 passed, 1 failed. The original focused regression was also re-run and failed before editing the service in this remediation checkpoint.
Regression: `tests/integration/specs/passwordless-security.spec.ts` (`SEC-REVIEW-001`). It retains secure expectations and is neither skipped nor marked as an expected failure.

No passwords, hashes, cookies, tokens or real addresses are included in this report. Screenshot/video/trace: deliberately disabled for real authentication to avoid credential/session artifacts. Console: raw application logs suppressed; sanitized status evidence retained. Network: the decisive responses were signup 201 and protected API 200; no external request was necessary.

## Likely source and recommended investigation

`server/src/residents.ts:createResidentWithPassword` finds an existing email with a null password and calls `setResidentPassword` without proof of ownership. `server/src/routes/guestAuth.ts` then creates a guest session before its confirmation-email step. This matches the observed password and session state.

Smallest originally proposed remediation (now implemented as described above): treat every existing resident email as a signup conflict regardless of password presence. Let passwordless users establish a password only through an authenticated credential-change flow or a single-use, expiring email-proof flow bound to that account. Verify the existing flows actually enforce ownership before relying on them. Address lookup/insert races without introducing email-only account linking.

Regression tests required: **YES**. Keep this real regression, add focused passwordless/Google/magic-link collision cases and concurrent attempts, and confirm valid new signup and verified password-setting still work. Review session issuance and invalidation separately. No broad authentication refactor is proposed.

Phase 3 stopped at confirmation. The subsequently approved remediation is implemented and verified above; further integration expansion still requires review.
