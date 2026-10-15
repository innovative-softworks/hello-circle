import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { MembershipChangedError, assertCreatorStillMember } from "./orgStatus.js";

// D-08 — a listing or coupon created by a member while they are being removed
// can't end up belonging to no organisation. Removal holds an exclusive lock on
// the member's user row; creation re-reads the membership under a shared lock on
// the same row, so the two serialise. Deterministic: the removal transaction is
// held open, and other connections observe that the creation can't finish.

const run = crypto.randomUUID().slice(0, 8);
const orgId = `test-org-rm-${run}`;
const memberId = `test-member-rm-${run}`;

beforeAll(async () => {
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'Removal race org', 'vendor')`).run(orgId);
  await db
    .prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', 'Removal race member', ?, 1, 'centre_manager')`)
    .run(memberId, `${memberId}@example.test`, orgId);
});
afterAll(async () => {
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(memberId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(orgId);
});

describe("creation vs staff removal", () => {
  it("a creation can't complete while the removal is open, and is refused once it commits", async () => {
    const member = { id: memberId, orgId };
    let creationSettled: "pending" | "created" | "refused" = "pending";
    let creation: Promise<void> | null = null;
    await db.transaction(async (removal) => {
      // What the removal does first: lock the member row and clear the membership.
      await removal.prepare(`SELECT id FROM users WHERE id = ? FOR UPDATE`).get(memberId);
      await removal.prepare(`UPDATE users SET org_id = NULL, platform_role = NULL, row_version = row_version + 1 WHERE id = ?`).run(memberId);
      creation = db
        .transaction(async (tx) => {
          await assertCreatorStillMember(tx, member);
        })
        .then(
          () => void (creationSettled = "created"),
          (e) => void (creationSettled = e instanceof MembershipChangedError ? "refused" : "pending")
        );
      // Condition checks (DB round trips from another connection), not sleeps.
      for (let i = 0; i < 25; i++) {
        await db.prepare(`SELECT 1 AS ok`).get();
        expect(creationSettled, `creation finished while the removal was open (round trip ${i})`).toBe("pending");
      }
    });
    await creation;
    expect(creationSettled).toBe("refused");
  });

  it("a creation by a current member goes ahead", async () => {
    await db.prepare(`UPDATE users SET org_id = ? WHERE id = ?`).run(orgId, memberId);
    await expect(db.transaction((tx) => assertCreatorStillMember(tx, { id: memberId, orgId }))).resolves.toBeUndefined();
  });
});
