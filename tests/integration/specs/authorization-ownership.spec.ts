import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withActors } from "../authorization-fixture";

test("IDOR-HOST: another host cannot read draft management, edit or publish; media ownership", async ({ playwright }) => {
  await withActors(playwright, ["QA_HOST", "QA_HOST_B", "GUEST"], async ({ actors, snapshot, track }) => {
    const input = { activityLabel: `QA ownership ${randomUUID()}`, date: "2030-06-20", time: "12:00", capacity: 5, locationText: "Synthetic QA venue", lifecycle: "draft", priceCents: 0 };
    const created = await actors.QA_HOST.post("/api/games", { data: input });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    track("games", "id", id);
    track("game_participants", "game_id", id);
    track("game_updates", "game_id", id);
    track("listing_attributes", "listing_id", id);
    const unchanged = await snapshot("SELECT * FROM games WHERE id = ?", [id]);
    expect((await actors.QA_HOST.get(`/api/games/${id}`)).status()).toBe(200);
    for (const role of ["GUEST", "QA_HOST_B"]) {
      const actor = actors[role];
      expect((await actor.get(`/api/games/${id}`)).status()).toBe(404);
      expect([401, 403]).toContain((await actor.get(`/api/games/${id}/participants/manage`)).status());
      expect([401, 403]).toContain((await actor.put(`/api/games/${id}`, { data: { ...input, hostResidentId: personas.QA_HOST_B.id, host_resident_id: personas.QA_HOST_B.id } })).status());
      await unchanged();
      expect([401, 403]).toContain((await actor.post(`/api/games/${id}/lifecycle`, { data: { lifecycle: "active" } })).status());
      await unchanged();
      for (const action of ["authorize", "finalize", "release"]) {
        expect([401, 403]).toContain((await actor.post(`/api/media/${action}`, { data: { entityType: "activity-cover", entityId: id, contentType: "image/png", objectKey: "qa-only", url: "/uploads/qa-nonexistent.png" } })).status());
        await unchanged();
      }
    }
  });
});

test("IDOR-CIRCLE: invite-only content and organiser operations reject non-members", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "GUEST"], async ({ actors, track, snapshot }) => {
    const created = await actors.QA_USER.post("/api/circles", { data: { name: `QA private ${randomUUID()}`, joinMode: "invite", about: "Synthetic teaser", whatWeDo: "QA members-only detail" } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    track("circles", "id", id);
    track("circle_members", "circle_id", id);
    track("circle_invites", "circle_id", id);
    const unchanged = await snapshot("SELECT * FROM circles WHERE id = ?", [id]);
    const membersUnchanged = await snapshot("SELECT * FROM circle_members WHERE circle_id = ? ORDER BY id", [id]);
    expect((await actors.QA_USER.get(`/api/circles/${id}/members`)).status()).toBe(200);
    for (const role of ["GUEST", "QA_USER_B"]) {
      const actor = actors[role];
      for (const suffix of ["members", "plan-ideas", "polls", "upcoming", "recent-activity", "moments", "activity"]) {
        expect((await actor.get(`/api/circles/${id}/${suffix}`)).status(), `Private Circle ${suffix}`).toBe(403);
      }
      expect([401, 403]).toContain((await actor.put(`/api/circles/${id}`, { data: { name: "Unauthorized change", joinMode: "open" } })).status());
      await unchanged();
      expect([401, 403]).toContain((await actor.post(`/api/circles/${id}/join`)).status());
      for (const action of ["remove", "promote", "demote"]) {
        expect([401, 403]).toContain((await actor.post(`/api/circles/${id}/members/${personas.QA_USER.id}/${action}`)).status());
        await membersUnchanged();
      }
      expect([401, 403]).toContain((await actor.post("/api/media/authorize", { data: { entityType: "circle-cover", entityId: id, contentType: "image/png" } })).status());
    }
  });
});

test("IDOR-VENDOR: cross-organisation listing and substituted child IDs are denied", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async ({ actors, connection, track, snapshot }) => {
    const [users] = await connection.query<any[]>("SELECT org_id FROM users WHERE id IN (?, ?)", [personas.QA_VENDOR.id, personas.QA_VENDOR_B.id]);
    expect(users.length === 2 && users.every((row) => !!row.org_id) && users[0].org_id !== users[1].org_id, "Distinct vendor organisations required").toBe(true);
    const ids: string[] = [];
    for (const role of ["QA_VENDOR", "QA_VENDOR_B"]) {
      const response = await actors[role].post("/api/vendor/centres", { data: { name: `QA centre ${randomUUID()}`, paymentMethod: "cash" } });
      expect(response.status()).toBe(201);
      const { id } = await response.json();
      ids.push(id);
      track("centres", "id", id);
      for (const [table, column] of [["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"]]) track(table, column, id);
    }
    const [a, b] = ids;
    const ownerRooms = await actors.QA_VENDOR.get(`/api/vendor/centres/${a}/rooms`);
    expect(ownerRooms.status()).toBe(200);
    const roomId = (await ownerRooms.json())[0].id;
    const unchanged = await snapshot("SELECT * FROM centres WHERE id IN (?, ?) ORDER BY id", ids);
    const roomUnchanged = await snapshot("SELECT * FROM rooms WHERE centre_id IN (?, ?) ORDER BY id", ids);
    const other = actors.QA_VENDOR_B;
    expect((await other.get(`/api/vendor/centres/${a}`)).status()).toBe(403);
    expect((await other.get(`/api/vendor/centres/${a}/rooms`)).status()).toBe(403);
    expect((await other.put(`/api/vendor/centres/${a}`, { data: { name: "Unauthorized", vendorId: personas.QA_VENDOR_B.id, status: "approved" } })).status()).toBe(403);
    await unchanged();
    expect((await other.delete(`/api/vendor/centres/${a}`)).status()).toBe(403);
    await unchanged();
    expect((await other.put(`/api/vendor/centres/${b}/rooms/${roomId}`, { data: { name: "Unauthorized child" } })).status()).toBe(404);
    await roomUnchanged();
    await unchanged();
    expect((await other.post("/api/media/release", { data: { entityType: "centre-gallery", entityId: a, url: "/uploads/qa-nonexistent.png" } })).status()).toBe(403);
    await unchanged();
    const programs: string[] = [];
    for (const [index, role] of ["QA_VENDOR", "QA_VENDOR_B"].entries()) {
      const result = await actors[role].post("/api/vendor/programs", { data: { listingType: "centre", listingId: ids[index], title: "QA child isolation", description: "Synthetic program" } });
      expect(result.status()).toBe(201);
      const program = (await result.json()).id;
      programs.push(program);
      track("programs", "id", program);
      track("program_sessions", "program_id", program);
    }
    const session = await actors.QA_VENDOR.post(`/api/vendor/programs/${programs[0]}/sessions`, { data: { date: "2030-06-20", time: "12:00" } });
    expect(session.status()).toBe(201);
    const sessionId = (await session.json()).id;
    const sessionUnchanged = await snapshot("SELECT * FROM program_sessions WHERE id = ?", [sessionId]);
    expect((await other.get(`/api/vendor/programs/${programs[0]}`)).status()).toBe(403);
    expect((await other.post(`/api/vendor/programs/${programs[0]}/sessions`, { data: { date: "2030-06-21", time: "12:00" } })).status()).toBe(403);
    // This API intentionally returns 200 for a scoped no-op: DB invariants, not
    // a preferred HTTP status, determine whether foreign child mutation occurred.
    expect((await other.delete(`/api/vendor/programs/${programs[1]}/sessions/${sessionId}`)).status()).toBe(200);
    await sessionUnchanged();
  });
});

test("IDOR-CIRCLE-MODES: public/member visibility and private cover authorization", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "GUEST"], async ({ actors, connection, track, snapshot }) => {
    for (const joinMode of ["open", "approval", "invite"]) {
      const result = await actors.QA_USER.post("/api/circles", { data: { name: `QA visibility ${randomUUID()}`, joinMode, whatWeDo: "Synthetic member detail" } });
      expect(result.status()).toBe(201);
      const { id } = await result.json();
      track("circles", "id", id);
      track("circle_members", "circle_id", id);
      await connection.execute("UPDATE circles SET image_url = '/uploads/qa-synthetic-cover.png' WHERE id = ?", [id]);
      const unchanged = await snapshot("SELECT * FROM circles WHERE id = ?", [id]);
      expect((await actors.GUEST.get(`/api/circles/${id}/members`)).status()).toBe(joinMode === "open" ? 200 : 403);
      if (joinMode !== "open") {
        const teaser = await (await actors.QA_USER_B.get(`/api/circles/${id}`)).json();
        expect(teaser.restricted === true && teaser.whatWeDo === null && teaser.imageUrl === null).toBe(true);
        expect((await actors.QA_USER_B.get(`/api/media/circles/${id}/cover`)).status()).toBe(403);
      }
      // Member is a seeded relationship, not a bypassed public join workflow.
      await connection.execute("INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')", [id, personas.QA_USER_B.id]);
      expect((await actors.QA_USER_B.get(`/api/circles/${id}/members`)).status()).toBe(200);
      const detail = await (await actors.QA_USER_B.get(`/api/circles/${id}`)).json();
      expect(detail.whatWeDo === "Synthetic member detail").toBe(true);
      expect((await actors.QA_USER_B.put(`/api/circles/${id}`, { data: { name: "Forbidden member edit" } })).status()).toBe(403);
      await unchanged();
    }
  });
});
