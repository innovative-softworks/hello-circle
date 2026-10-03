import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";

// Candidate found while mapping canonical visibility consumers (Stage B
// remediation, Part 1). Joining makes the caller a participant, which
// canViewGame() then treats as authorized — so join must not exceed detail.

test("HC-QA-016: joining must not bypass invite-only visibility", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER_B"], async ({ actors, track, snapshot }) => {
    const created = await actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA join ${randomUUID()}`, date: "2030-06-20", time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0, visibility: "invite", lifecycle: "active" } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["waitlist_entries", "listing_id"], ["listing_attributes", "listing_id"], ["notifications", "listing_id"]]) track(table, column, id);
    const participants = await snapshot("SELECT * FROM game_participants WHERE game_id = ? ORDER BY id", [id]);
    const canonical = (await actors.QA_USER_B.get(`/api/games/${id}`)).status();
    const join = await actors.QA_USER_B.post(`/api/games/${id}/join`, { data: {} });
    const detailAfter = (await actors.QA_USER_B.get(`/api/games/${id}`)).status();
    await evidence("hc-qa-016-join", { canonicalBefore: canonical, joinStatus: join.status(), detailAfterJoin: detailAfter, invited: false, paymentUsed: false });
    expect(canonical).toBe(404);
    expect(join.status(), "Uninvited caller cannot join an invite-only activity").toBe(404);
    await participants();
    expect(detailAfter).toBe(404);
    expect(personas.QA_USER_B.id).toBeTruthy();
  });
});
