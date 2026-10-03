import { expect, personas } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, createActivity, joinedIds, rows } from "../lifecycle-fixture";

// Phase 8 — activity joins under contention. Visibility/paid-boundary and
// waitlist invariants are already gated (HC-QA-016, HC-QA-026); this covers
// competing users for the final place and leave/join churn.

test("BK-ACTIVITY-CONCURRENT: competing users for the final place and churn never exceed capacity", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B", "QA_HOST_B"], async f => {
    const { QA_USER: a, QA_USER_B: b, QA_HOST_B: c } = f.actors;
    const game = await createActivity(f, "QA_HOST", { capacity: 2 }); // host + 1 place
    const results = await Promise.all([a, b, c].map(actor => actor.post(`/api/games/${game.id}/join`, { data: {} })));
    expect(results.map(r => r.status()).sort()).toEqual([200, 409, 409]);
    expect((await joinedIds(f, game.id)).length).toBe(2);
    const winner = [a, b, c][results.findIndex(r => r.status() === 200)];
    // Churn: winner leaves while two others race to join.
    const churn = await Promise.all([winner.delete(`/api/games/${game.id}/join`), ...[a, b, c].filter(x => x !== winner).map(x => x.post(`/api/games/${game.id}/join`, { data: {} }))]);
    const [{ joined, capacity }] = await rows(f, "SELECT (SELECT COUNT(*) FROM game_participants WHERE game_id = g.id AND status IN ('joined','pending_payment')) AS joined, capacity FROM games g WHERE id = ?", [game.id]);
    expect(Number(joined)).toBeLessThanOrEqual(capacity);
    expect((await rows(f, "SELECT COUNT(*) AS n FROM game_participants WHERE game_id = ? AND resident_id = ?", [game.id, personas.QA_HOST.id]))[0].n).toBe(1);
    await evidence("bk-activity-concurrent", { finalPlace: results.map(r => r.status()).sort().join(","), churnStatuses: churn.map(r => r.status()).join(","), joinedAfterChurn: Number(joined), capacity });
  });
});
