import crypto from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "./db/index.js";
import { EXPLANATION_MIN, decisionHistory, latestPublicDecision, parseDecisionReason, recordDecision } from "./moderationDecisions.js";

// D-03 — reasons, note privacy and append-only history (real isolated DB).

const objects: string[] = [];
afterAll(async () => {
  for (const id of objects) await db.prepare(`DELETE FROM moderation_decisions WHERE object_id = ?`).run(id);
});

const good = { reasonCategory: "misleading", explanation: "The photos show a different building to the one listed.", internalNote: "Reported twice by residents; see report #12." };

describe("reason validation", () => {
  it("requires a known category and an explanation of at least the minimum length when required", () => {
    expect(parseDecisionReason({}, "listing_rejection", true).ok).toBe(false);
    expect(parseDecisionReason({ ...good, reasonCategory: "made_up" }, "listing_rejection", true).ok).toBe(false);
    expect(parseDecisionReason({ ...good, explanation: "too short" }, "listing_rejection", true).ok).toBe(false);
    expect(parseDecisionReason({ ...good, explanation: "x".repeat(EXPLANATION_MIN) }, "listing_rejection", true).ok).toBe(true);
    // A suspension category isn't valid for a listing rejection, and vice versa.
    expect(parseDecisionReason({ ...good, reasonCategory: "payment_risk" }, "listing_rejection", true).ok).toBe(false);
    expect(parseDecisionReason({ ...good, reasonCategory: "payment_risk" }, "suspension", true).ok).toBe(true);
  });

  it("keeps the internal note separate and optional", () => {
    const r = parseDecisionReason(good, "listing_rejection", true);
    expect(r.ok && r.reason).toEqual({ category: "misleading", explanation: good.explanation, internalNote: good.internalNote });
    const noNote = parseDecisionReason({ reasonCategory: "other", explanation: good.explanation }, "listing_rejection", true);
    expect(noNote.ok && noNote.reason?.internalNote).toBe(null);
    expect(parseDecisionReason({ ...good, internalNote: "n".repeat(4001) }, "listing_rejection", true).ok).toBe(false);
  });

  it("not required: nothing given is fine; a partial reason is still validated", () => {
    expect(parseDecisionReason({}, "suspension", false)).toEqual({ ok: true, reason: null });
    expect(parseDecisionReason({ reasonCategory: "safety" }, "suspension", false).ok).toBe(false);
  });
});

describe("history and privacy", () => {
  it("partner view never includes the internal note; admin view only when allowed; earlier decisions are kept", async () => {
    const id = `test-listing-${crypto.randomUUID()}`;
    objects.push(id);
    const first = parseDecisionReason(good, "listing_rejection", true);
    if (!first.ok) throw new Error("setup");
    await recordDecision(db, { objectType: "centre", objectId: id, action: "listing.rejected", previousState: "pending", newState: "rejected", reason: first.reason, actorUserId: "admin-1" });
    await recordDecision(db, { objectType: "centre", objectId: id, action: "listing.pending", previousState: "rejected", newState: "pending", reason: null, actorUserId: "admin-1" });
    const second = parseDecisionReason({ reasonCategory: "incomplete", explanation: "Opening hours and a description are still missing." }, "listing_rejection", true);
    if (!second.ok) throw new Error("setup");
    await recordDecision(db, { objectType: "centre", objectId: id, action: "listing.rejected", previousState: "pending", newState: "rejected", reason: second.reason, actorUserId: "admin-2" });

    const latest = await latestPublicDecision("centre", id, ["listing.rejected"]);
    expect(latest?.category).toBe("incomplete");
    expect(latest?.categoryLabel).toBe("Incomplete details");
    expect(JSON.stringify(latest)).not.toContain("Reported twice");
    expect(latest).not.toHaveProperty("internalNote");

    const withNotes = await decisionHistory("centre", id, true);
    expect(withNotes.map((d) => d.action)).toEqual(["listing.rejected", "listing.pending", "listing.rejected"]);
    expect(withNotes[2]).toMatchObject({ explanation: good.explanation, internalNote: good.internalNote }); // the first explanation is unchanged
    const withoutNotes = await decisionHistory("centre", id, false);
    expect(JSON.stringify(withoutNotes)).not.toContain("Reported twice");
    expect(withoutNotes[0]).not.toHaveProperty("internalNote");
  });

  it("an object decided before reasons existed has no decision (shown as 'No reason recorded')", async () => {
    expect(await latestPublicDecision("centre", `never-${crypto.randomUUID()}`)).toBeNull();
  });
});
