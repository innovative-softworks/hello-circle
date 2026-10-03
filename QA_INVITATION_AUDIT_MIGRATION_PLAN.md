# Historical invitation credentials — production PLAN ONLY

No production/development connection, inventory or mutation has been performed.
Production record counts and exposure are UNKNOWN. QA verification uses four exact
synthetic audit IDs with run-specific markers, not a general-purpose migration.

## Approval and inventory

1. Obtain security/operations approval, retention requirements and a maintenance
   window. Deploy the local invitation fixes before reopening acceptance. Pause
   acceptance/revocation during remediation if the deployment cannot guarantee
   coordination. Backups containing credentials remain sensitive; restrict access.
2. Use a least-privileged approved migration identity, not application/root access.
   Verify database/server/environment identity independently. Produce counts only,
   not raw credentials, URLs, SQL parameter dumps or unrestricted exports.
3. Inventory `org_invite` audit events for historical object IDs and embedded
   credentials/URLs in previous/new payloads. Match known credentials against
   operational org_invites, distinguishing raw IDs from safe SHA-256 IDs.
4. Classify pending-unexpired (active), pending-expired, accepted, revoked, missing
   and ambiguous. Missing/ambiguous credentials require manual review; absence of a
   DB match does NOT prove a logged credential harmless. Search replicas/backups/
   downstream audit exports through an approved retention process.

## Transactional remediation, bounded reviewed IDs

1. Lock the selected audit record and matched operational invitation in a consistent
   order. Recheck status/expiry under the lock; do not trust an earlier inventory.
2. Revoke any still-active exposed credential first. Do not delete memberships or
   existing user accounts. Already accepted/revoked/expired records need no account
   mutation. If evidence suggests historical misuse, initiate a separate incident
   investigation rather than inferring compromise from token presence alone.
3. Replace raw audit object identity with the non-redeemable SHA-256 management ID.
   Redact matching credential material from structured payloads and secret URLs,
   preserving actor, organisation, recipient identifier as permitted, intended role,
   timestamp and event type. Never delete the audit history wholesale.
4. Record a separate secret-free migration event/status and commit the bounded
   batch. Abort and roll back on an unknown format or failed invariant. Rerun must
   be idempotent. Avoid outputting old/new field contents during verification.
5. Verify active credential rejection, audit row counts and retained metadata,
   absence of raw secrets, and unchanged users/memberships/roles. Reissue new
   invitations through authorized owner workflow where needed; never reactivate
   exposed credentials as a rollback strategy.

## QA verification / limitations

`tests/integration/invitation-history.ts` independently invokes connected QA safety
checks, requires exact numeric audit IDs and this run's synthetic marker, and
executes a transaction. It refuses unknown historical credentials. Test covers
active/expired/accepted/revoked states, invalidates active credentials, retains audit
history, removes exact raw-token material, and verifies repeat execution is a no-op.

This is not production-ready migration tooling: review actual production formats,
scale, retention policy, encoded URL variants and exporters before implementation.
Historical credential sanitation is operationally OPEN until separately approved
and verified in the relevant environment. No global token-storage migration.
