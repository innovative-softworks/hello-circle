import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas, env } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";

// USER_B must not read or mutate USER_A's private resident data by
// identifier substitution. Self-scoped routes (/me/*) ignore body/query IDs.

test("STAGE-B-PERSONAL: routines, alerts, blocks, follows, favourites, invitations, reports and host reviews are resident-scoped", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "GUEST"], async (f) => {
    const A = f.actors.QA_USER, B = f.actors.QA_USER_B;
    const a = personas.QA_USER.id, b = personas.QA_USER_B.id;
    const routine = await A.post("/api/residents/me/routines", { data: { activityLabel: "QA private routine", dayOfWeek: 3, time: "07:00" } });
    expect(routine.status()).toBe(201);
    const routineId = (await routine.json()).id;
    f.track("routines", "id", routineId);
    expect((await A.post("/api/residents/me/search-alerts", { data: { county: "Dublin", keywords: "QA private alert" } })).status()).toBe(201);
    const [alert] = await f.connection.query<any[]>("SELECT id FROM search_alerts WHERE resident_id = ? AND keywords = 'QA private alert'", [a]);
    f.track("search_alerts", "id", alert[0].id);
    const [pre] = await f.connection.query<any[]>("SELECT (SELECT COUNT(*) FROM blocked_residents WHERE blocker_resident_id = ? AND blocked_resident_id = ?) + (SELECT COUNT(*) FROM follows WHERE resident_id = ? AND followed_id = ?) AS n", [a, personas.QA_HOST.id, a, personas.QA_HOST.id]);
    expect(Number(pre[0].n), "Synthetic block/follow must not pre-exist").toBe(0);
    const [bBefore] = await f.connection.query<any[]>("SELECT name FROM residents WHERE id = ?", [b]);
    await f.connection.execute("INSERT INTO blocked_residents (blocker_resident_id, blocked_resident_id) VALUES (?, ?)", [a, personas.QA_HOST.id]);
    await f.connection.execute("INSERT INTO follows (resident_id, followed_type, followed_id) VALUES (?, 'host', ?)", [a, personas.QA_HOST.id]);
    const inviteId = randomUUID(), token = randomBytes(24).toString("base64url");
    await f.connection.execute("INSERT INTO invitations (id, token, entity_type, entity_id, inviter_resident_id, invitee_resident_id, expires_at) VALUES (?, ?, 'game', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))", [inviteId, token, randomUUID(), personas.QA_HOST.id, a]);
    f.track("invitations", "id", inviteId);
    const [review] = await f.connection.execute<any>("INSERT INTO reviews (listing_type, listing_id, client_id, name, rating, comment) VALUES ('host', ?, ?, 'QA reviewer', 5, 'Synthetic')", [a, randomUUID()]);
    f.track("reviews", "id", Number(review.insertId));
    const clientA = randomUUID(), clientB = randomUUID();
    const [report] = await f.connection.execute<any>("INSERT INTO reports (target_type, target_id, reporter_client_id, reason) VALUES ('game', ?, ?, 'QA private report reason')", [randomUUID(), clientA]);
    f.track("reports", "id", Number(report.insertId));
    const cleanupPairs: [string, string][] = [["blocked_residents", "blocker_resident_id"], ["follows", "resident_id"]];
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM routines WHERE resident_id = ? ORDER BY id", [a]),
      f.snapshot("SELECT * FROM search_alerts WHERE resident_id = ? ORDER BY id", [a]),
      f.snapshot("SELECT * FROM blocked_residents WHERE blocker_resident_id = ? ORDER BY blocked_resident_id", [a]),
      f.snapshot("SELECT * FROM follows WHERE resident_id = ? ORDER BY followed_id", [a]),
      f.snapshot("SELECT * FROM invitations WHERE id = ?", [inviteId]),
      f.snapshot("SELECT * FROM reviews WHERE id = ?", [Number(review.insertId)]),
      f.snapshot("SELECT * FROM residents WHERE id IN (?,?) ORDER BY id", [a, b]),
    ]);
    const cases: [() => ReturnType<APIRequestContext["put"]>, number, string][] = [
      [() => B.put(`/api/residents/me/routines/${routineId}`, { data: { status: "cancelled" } }), 404, "routine"],
      [() => B.put(`/api/residents/me/search-alerts/${alert[0].id}`, { data: { active: false } }), 404, "search alert update"],
      [() => B.delete(`/api/residents/me/search-alerts/${alert[0].id}`), 404, "search alert delete"],
      [() => B.delete(`/api/residents/me/blocked/${personas.QA_HOST.id}`), 200, "unblock is self-scoped no-op"],
      [() => B.delete("/api/follows", { data: { followedType: "host", followedId: personas.QA_HOST.id, residentId: a } }), 200, "unfollow is self-scoped no-op"],
      [() => B.post(`/api/invitations/${inviteId}/respond`, { data: { response: "declined" } }), 404, "invitation by id"],
      [() => B.post(`/api/invitations/token/${token}/respond`, { data: { response: "declined" } }), 403, "invitation by token"],
      [() => B.post(`/api/residents/host-reviews/${Number(review.insertId)}/reply`, { data: { reply: "Forbidden" } }), 404, "host review reply"],
      [() => B.put("/api/residents/me", { data: { name: bBefore[0].name, id: a, residentId: a, email: env.QA_USER_EMAIL, role: "admin", hostStatus: "verified" } }), 200, "profile update ignores foreign identity"],
      [() => f.actors.GUEST.get(`/api/residents/me/routines`), 401, "guest"],
    ];
    try {
      for (const [call, status, label] of cases) {
        expect((await call()).status(), label).toBe(status);
        for (const unchanged of invariants) await unchanged();
      }
    } finally {
      for (const [table, column] of cleanupPairs) await f.connection.execute(`DELETE FROM ${table} WHERE ${column} = ? AND ${table === "follows" ? "followed_id" : "blocked_resident_id"} = ?`, [a, personas.QA_HOST.id]);
    }
    // Private reads never include A's data.
    const markers = ["QA private routine", "QA private alert", "QA private report reason", env.QA_USER_EMAIL, routineId, inviteId];
    const leaks: Record<string, boolean> = {};
    for (const [label, call] of [
      ["routines", () => B.get("/api/residents/me/routines")],
      ["alerts", () => B.get("/api/residents/me/search-alerts")],
      ["blocked", () => B.get("/api/residents/me/blocked")],
      ["follows", () => B.get("/api/follows")],
      ["invitations", () => B.get("/api/invitations/mine")],
      ["reports", () => B.get("/api/reports/mine", { headers: { "X-Client-Id": clientB } })],
      ["export", () => B.get(`/api/residents/me/export?residentId=${a}`)],
      ["search", () => B.get(`/api/residents/search?q=${encodeURIComponent("QA")}`)],
      ["hostProfile", () => f.actors.GUEST.get(`/api/residents/${personas.QA_HOST.id}/host-profile`)],
    ] as [string, () => ReturnType<APIRequestContext["get"]>][]) {
      const text = await (await call()).text();
      leaks[label] = markers.some((marker) => text.includes(marker)) || text.includes(env.QA_HOST_EMAIL) || /"(email|phone|host_phone|hostPhone|password_hash)"\s*:/.test(label === "export" ? "" : text);
    }
    await evidence("stage-b-personal", leaks);
    for (const [label, leaked] of Object.entries(leaks)) expect(leaked, `${label} must not disclose another resident's private data`).toBe(false);
  });
});
