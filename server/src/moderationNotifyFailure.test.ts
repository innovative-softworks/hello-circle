import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

// D-03 — a failed email never erases or misreports a decision: the decision is
// committed before any notice is attempted, the workspace notice is still
// written, and the notifier resolves instead of throwing into the request.
vi.mock("./email.js", () => ({ sendMail: vi.fn(async () => { throw new Error("SMTP down (test)"); }) }));

const { db } = await import("./db/index.js");
const { recordDecision, decisionHistory } = await import("./moderationDecisions.js");
const { NEXT_STEPS, notifyPartner } = await import("./moderationNotify.js");

const vendorId = `test-vendor-fail-${crypto.randomUUID()}`;
afterAll(async () => {
  await db.prepare(`DELETE FROM notifications WHERE recipient_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM moderation_decisions WHERE object_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("notice delivery failure", () => {
  it("keeps the decision and the workspace notice when the email fails", async () => {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'suspended', 'QA failure partner')`).run(vendorId, `${vendorId}@example.test`);
    const reason = { category: "safety", explanation: "Repeated safety complaints from session participants.", internalNote: null };
    await recordDecision(db, { objectType: "vendor", objectId: vendorId, action: "partner.suspended", previousState: "approved", newState: "suspended", reason, actorUserId: "admin-test" });
    await expect(notifyPartner(vendorId, { title: "Suspended", intro: "x", kind: "suspension", reason, nextSteps: NEXT_STEPS.suspension })).resolves.toBeUndefined();
    const history = await decisionHistory("vendor", vendorId, false);
    expect(history.map((d) => [d.action, d.explanation])).toEqual([["partner.suspended", reason.explanation]]);
    const [row] = (await db.prepare(`SELECT kind FROM notifications WHERE recipient_id = ?`).all(vendorId)) as { kind: string }[];
    expect(row?.kind).toBe("moderation");
  });
});
