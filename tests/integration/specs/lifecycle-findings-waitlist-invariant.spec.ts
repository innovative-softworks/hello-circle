import { randomUUID } from "node:crypto";
import { expect, personas, env } from "../fixtures";
import { centreFor, clubFor, programFor } from "../stage-b-fixture";
import { evidence } from "../authorization-fixture";
import { test, withActors } from "../lifecycle-fixture";
import { createActivity, createCircle, rows, joinedIds, waitlist, notificationsFor, trackGame } from "../lifecycle-fixture";
import { uiActor } from "../lifecycle-ui-fixture";

// Phase 7 finding gate HC-QA-022..033. The original failing-before regressions
// are kept unchanged (red before remediation, green after); the *-INVARIANT /
// *-SEMANTICS / *-CROSS-SCOPE cases extend them. Free synthetic data only.

test("HC-QA-026-INVARIANT: confirmed + active held offers never exceed capacity through waitlist, offer, claim, expiry and leave", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_USER", "QA_USER_B", "QA_HOST_B"], async f => {
    const { QA_HOST: host, QA_USER: a, QA_USER_B: b, QA_HOST_B: c } = f.actors;
    const game = await createActivity(f, "QA_HOST", { capacity: 3 });
    const check = async (label: string) => {
      const [r] = await rows(f, `SELECT g.capacity,
          (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status IN ('joined','pending_payment')) AS taken,
          (SELECT COUNT(*) FROM waitlist_entries w WHERE w.listing_type = 'game' AND w.listing_id = g.id AND w.status = 'offered' AND w.offer_expires_at > NOW()) AS held,
          (SELECT COUNT(*) FROM waitlist_entries w JOIN game_participants gp ON gp.game_id = w.listing_id AND gp.resident_id = w.resident_id AND gp.status = 'joined'
             WHERE w.listing_type = 'game' AND w.listing_id = g.id AND w.status IN ('waiting','offered')) AS stale
        FROM games g WHERE g.id = ?`, [game.id]);
      expect(Number(r.taken) + Number(r.held), `${label}: taken + held <= capacity`).toBeLessThanOrEqual(r.capacity);
      expect(Number(r.stale), `${label}: no waiting/offered entry for a joined resident`).toBe(0);
      return { taken: Number(r.taken), held: Number(r.held) };
    };
    const entry = async (resident: string | null, extra = "") => (await rows(f, `SELECT id, status FROM waitlist_entries WHERE listing_id = ? AND ${resident ? "resident_id = ?" : "resident_id IS NULL"} ${extra}`, resident ? [game.id, resident] : [game.id]))[0];
    for (const actor of [a, c]) expect((await actor.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect(await check("full")).toEqual({ taken: 3, held: 0 });
    // Waitlist: one entry per resident, none for participants; multiple waiting (synthetic guest entry queued after B).
    expect((await b.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201);
    expect((await b.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(409);
    expect((await a.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(409);
    await f.connection.execute("INSERT INTO waitlist_entries (listing_type, listing_id, client_id, name, email) VALUES ('game', ?, ?, 'QA guest waiting', 'qa_waitlist_guest@example.test')", [game.id, randomUUID()]);
    // Manual offer while full is refused.
    expect((await host.post(`/api/games/${game.id}/waitlist/${(await entry(personas.QA_USER_B.id)).id}/offer`, { data: {} })).status()).toBe(409);
    expect((await entry(personas.QA_USER_B.id)).status).toBe("waiting");
    // A real spot opens → exactly one offer, to the first in line.
    expect((await a.delete(`/api/games/${game.id}/join`)).status()).toBe(200);
    await expect.poll(async () => (await entry(personas.QA_USER_B.id)).status).toBe("offered");
    expect((await entry(null)).status).toBe("waiting");
    expect(await check("offered")).toEqual({ taken: 2, held: 1 });
    expect((await a.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(409); // held spot
    // Claim.
    expect((await b.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200);
    expect((await entry(personas.QA_USER_B.id)).status).toBe("claimed");
    expect(await check("claimed")).toEqual({ taken: 3, held: 0 });
    // Leave → next waiting (guest) offered; then that offer expires (safe control: this row only).
    expect((await c.delete(`/api/games/${game.id}/join`)).status()).toBe(200);
    await expect.poll(async () => (await entry(null)).status).toBe("offered");
    expect(await check("guest offered")).toEqual({ taken: 2, held: 1 });
    await f.connection.execute("UPDATE waitlist_entries SET offer_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?", [(await entry(null)).id]);
    expect(await check("expired")).toEqual({ taken: 2, held: 0 });
    expect((await a.post(`/api/games/${game.id}/join`, { data: {} })).status()).toBe(200); // expired offer no longer holds capacity
    expect(await check("after expiry join")).toEqual({ taken: 3, held: 0 });
    // Manual offer to a resident who meanwhile joined is refused.
    expect((await c.post(`/api/games/${game.id}/waitlist`, { data: {} })).status()).toBe(201);
    expect((await host.post(`/api/games/${game.id}/waitlist/${(await entry(personas.QA_HOST_B.id, "AND status = 'waiting'")).id}/offer`, { data: {} })).status()).toBe(409);
    await check("final");
  });
});
