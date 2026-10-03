# HC-QA-096 — Circle invitation accept / join-shortcut used unconditional updates (race with revoke or a second response)

Severity: P3. Category: CONCURRENCY / AUTHORIZATION. Status: FIXED LOCALLY — NOT DEPLOYED (Phase 11B, 2026-10-03). Found during the Phase 11B Circle-revocation design review (adjacent).

- **Where:**
  - `POST /api/circles/invitations/:id/respond` (`server/src/routes/circles.ts`);
  - the organiser-invite shortcut inside `POST /api/circles/:id/join`.
- **Problem:** Both read the invite as `pending`, then ran `UPDATE circle_invites SET status = ? WHERE id = ?` (respond) or `… WHERE circle_id = ? AND resident_id = ?` (join), with no `status = 'pending'` guard, and then inserted membership. A concurrent revoke (or a second, opposite response) between the read and the write could be overwritten. For example, an invite revoked a moment earlier could still be accepted, and membership granted.
- **Fix:** Both updates are now conditional (`AND status = 'pending'`, plus `initiated_by = 'organiser'` for the shortcut). Membership is inserted, and the organiser notified, only by the request whose update changed the row. The loser gets 409 (respond) or falls through to the normal join-mode rules (join).
- **Regression:** `product-gaps-circle.spec.ts` HC-GAP-CIRCLE-2 races revoke against accept 4 times; every outcome is consistent: either revoked and not a member, or accepted and a member.
