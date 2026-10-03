import { test, expect, personas } from "../fixtures";
import { withActors } from "../authorization-fixture";

test("RBAC-001: non-admin roles cannot read or mutate admin resources; admin positive control", async ({ playwright }) => {
  await withActors(playwright, ["GUEST", "QA_USER", "QA_HOST", "QA_VENDOR", "QA_ADMIN"], async ({ actors, snapshot }) => {
    const unchanged = await snapshot("SELECT * FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
    for (const role of ["GUEST", "QA_USER", "QA_HOST", "QA_VENDOR"]) {
      const actor = actors[role];
      expect((await actor.get("/api/admin/vendors")).status()).toBe(401);
      expect((await actor.put(`/api/admin/vendors/${personas.QA_VENDOR.id}/status`, { data: { status: "suspended" } })).status()).toBe(401);
      await unchanged();
    }
    expect((await actors.QA_ADMIN.get("/api/admin/vendors")).status()).toBe(200);
    for (const role of ["GUEST", "QA_USER", "QA_HOST", "QA_ADMIN"]) {
      expect((await actors[role].get("/api/vendor/listings")).status()).toBe(401);
    }
    expect((await actors.QA_VENDOR.get("/api/vendor/listings")).status()).toBe(200);
  });
});

test("RBAC-002: profile identity and privilege fields cannot be mass-assigned", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B"], async ({ actors, snapshot }) => {
    const unchanged = await snapshot("SELECT * FROM residents WHERE id IN (?, ?) ORDER BY id", [personas.QA_USER.id, personas.QA_USER_B.id]);
    expect((await actors.QA_USER_B.put("/api/residents/me", { data: {
      id: personas.QA_USER.id, residentId: personas.QA_USER.id, email: "attacker@example.test",
      role: "admin", host_status: "verified", hostStatus: "verified", google_uid: "qa-injected", password_hash: "qa-injected",
    } })).status()).toBe(200);
    await unchanged();
    const result = await (await actors.QA_USER_B.get(`/api/residents/me?residentId=${personas.QA_USER.id}`)).json();
    expect(result.resident.id === personas.QA_USER_B.id).toBe(true);
    expect((await actors.QA_USER_B.get("/api/admin/stats")).status()).toBe(401);
    expect((await actors.QA_USER_B.get("/api/vendor/listings")).status()).toBe(401);
  });
});

test("IDOR-PERSONAL: household child ownership and private reads", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B"], async ({ actors, track, snapshot }) => {
    const created = await actors.QA_USER.post("/api/household", { data: { firstName: "QA only", lastName: "Private", notes: "synthetic-private-note" } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    track("household_members", "id", id);
    const unchanged = await snapshot("SELECT * FROM household_members WHERE id = ?", [id]);
    const owner = await (await actors.QA_USER.get("/api/household")).json();
    expect(owner.some((row: { id: number }) => row.id === id)).toBe(true);
    const other = await (await actors.QA_USER_B.get(`/api/household?residentId=${personas.QA_USER.id}`)).json();
    expect(other.some((row: { id: number }) => row.id === id)).toBe(false);
    expect((await actors.QA_USER_B.put(`/api/household/${id}`, { data: { firstName: "Changed", resident_id: personas.QA_USER_B.id } })).status()).toBe(403);
    await unchanged();
    expect((await actors.QA_USER_B.delete(`/api/household/${id}`)).status()).toBe(403);
    await unchanged();
  });
});
