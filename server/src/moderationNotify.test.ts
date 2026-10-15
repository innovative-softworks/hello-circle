import crypto from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { NEXT_STEPS, notifyPartner } from "./moderationNotify.js";

// D-03 — the partner's workspace notice is really written (notifications has
// NOT NULL listing columns), carries the explanation, and never the internal note.

const vendorId = `test-vendor-${crypto.randomUUID()}`;
afterAll(async () => {
  await db.prepare(`DELETE FROM notifications WHERE recipient_id = ?`).run(vendorId);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendorId);
});

describe("partner moderation notices", () => {
  it("writes account-level and listing notices with the explanation only", async () => {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'suspended', 'QA notice partner')`).run(vendorId, `${vendorId}@example.test`);
    const reason = { category: "terms_breach", explanation: "Repeated no-shows reported by residents this month.", internalNote: "INTERNAL-ONLY-MARKER" };
    await notifyPartner(vendorId, { title: "Your HelloCircle partner account has been suspended", intro: "Your account is suspended.", kind: "suspension", reason, nextSteps: NEXT_STEPS.suspension });
    await notifyPartner(vendorId, { title: "Your listing wasn't approved", intro: "Not approved.", kind: "listing_rejection", reason: { ...reason, category: "incomplete" }, nextSteps: NEXT_STEPS.listing, listingType: "centre", listingId: "c-1" });
    const rows = (await db.prepare(`SELECT kind, listing_type, listing_id, ref, body FROM notifications WHERE recipient_id = ? ORDER BY id`).all(vendorId)) as { kind: string; listing_type: string; listing_id: string; ref: string; body: string }[];
    expect(rows.map((r) => [r.kind, r.listing_type, r.listing_id, r.ref])).toEqual([
      ["moderation", "account", vendorId, ""],
      ["moderation", "centre", "c-1", ""],
    ]);
    expect(rows[0].body).toContain(reason.explanation);
    for (const r of rows) expect(r.body).not.toContain("INTERNAL-ONLY-MARKER");
  });
});
