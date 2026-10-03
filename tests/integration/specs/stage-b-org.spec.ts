import { createHash, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas, env } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { centreFor, staffLogin } from "../stage-b-fixture";

test("STAGE-B-ORG: staff/manager boundaries, cross-organisation invite management and owner mass assignment", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async (f) => {
      const [owners] = await f.connection.query<any[]>("SELECT id, org_id FROM users WHERE id IN (?,?) ORDER BY id", [personas.QA_VENDOR.id, personas.QA_VENDOR_B.id]);
      const orgA = owners.find((row) => row.id === personas.QA_VENDOR.id).org_id, orgB = owners.find((row) => row.id === personas.QA_VENDOR_B.id).org_id;
      expect(orgA && orgB && orgA !== orgB).toBeTruthy();
      const manager = await staffLogin(playwright, f, "QA_VENDOR", "centre_manager", opened);
      const inviteEmail = `qa_stageb_invite_${randomUUID()}@example.test`;
      f.track("org_invites", "email", inviteEmail);
      expect((await f.actors.QA_VENDOR.post("/api/vendor/org/staff/invite", { data: { email: inviteEmail, platformRole: "finance" } })).status()).toBe(201);
      const [invite] = await f.connection.query<any[]>("SELECT token FROM org_invites WHERE email = ?", [inviteEmail]);
      const managementId = createHash("sha256").update(invite[0].token).digest("hex");
      f.track("audit_log", "object_id", managementId);
      const centre = await centreFor(f, "QA_VENDOR");
      const invariants = await Promise.all([
        f.snapshot("SELECT * FROM organisations WHERE id IN (?,?) ORDER BY id", [orgA, orgB]),
        f.snapshot("SELECT id, role, status, org_id, platform_role, invited_staff, resident_id, logo FROM users WHERE org_id IN (?,?) ORDER BY id", [orgA, orgB]),
        f.snapshot("SELECT * FROM org_invites WHERE email = ?", [inviteEmail]),
        f.snapshot("SELECT * FROM org_policies WHERE org_id IN (?,?) ORDER BY org_id", [orgA, orgB]),
      ]);
      const M = manager.context;
      const cases: [() => ReturnType<APIRequestContext["get"]>, number, string][] = [
        [() => M.put("/api/vendor/org", { data: { name: "Forbidden", kind: "platform" } }), 403, "manager org profile"],
        [() => M.put("/api/vendor/org/policies", { data: { cancellationHours: 0 } }), 403, "manager policies"],
        [() => M.put("/api/vendor/org/logo", { data: { logo: "/uploads/qa.png" } }), 403, "manager logo"],
        [() => M.post("/api/vendor/org/staff/invite", { data: { email: `qa_forbidden_${randomUUID()}@example.test`, platformRole: "finance" } }), 403, "manager invites staff"],
        [() => M.delete(`/api/vendor/org/staff/invite/${managementId}`), 403, "manager revokes invite"],
        [() => M.get("/api/admin/vendors"), 401, "manager admin read"],
        [() => M.put(`/api/admin/vendors/${manager.id}/platform-role`, { data: { platformRole: "finance" } }), 401, "manager self role change"],
        // Org-scoped UPDATE: a foreign owner's revoke is a 200 no-op; the
        // snapshot invariants below (invite still pending) are the assertion.
        [() => f.actors.QA_VENDOR_B.delete(`/api/vendor/org/staff/invite/${managementId}`), 200, "foreign owner revokes invite (scoped no-op)"],
        [() => f.actors.QA_VENDOR_B.get(`/api/vendor/centres/${centre.id}`), 403, "foreign owner staff-owned listing"],
      ];
      for (const [response, status, label] of cases) {
        expect((await response()).status(), label).toBe(status);
        for (const unchanged of invariants) await unchanged();
      }
      // Staff data isolation: B's organisation view never includes A's staff or invites.
      const bView = await (await f.actors.QA_VENDOR_B.get("/api/vendor/org")).text();
      expect(bView.includes(manager.email) || bView.includes(inviteEmail) || bView.includes(managementId)).toBe(false);
      // Manager is authorized for listing writes, but ownership/approval fields stay server-derived.
      const listing = await f.snapshot("SELECT vendor_id, status, org_id, featured FROM centres WHERE id = ?", [centre.id]);
      expect((await M.put(`/api/vendor/centres/${centre.id}`, { data: { name: "QA manager rename", vendorId: personas.QA_VENDOR_B.id, vendor_id: personas.QA_VENDOR_B.id, status: "approved", featured: 1, orgId: orgB } })).status()).toBe(200);
      await listing();
      // Owner mass assignment: identity/role/organisation fields in the body are ignored.
      const [before] = await f.connection.query<any[]>("SELECT name, kind FROM organisations WHERE id = ?", [orgA]);
      const identity = await f.snapshot("SELECT id, role, status, org_id, platform_role, invited_staff FROM users WHERE id = ?", [personas.QA_VENDOR.id]);
      const orgBUnchanged = await f.snapshot("SELECT * FROM organisations WHERE id = ?", [orgB]);
      try {
        expect((await f.actors.QA_VENDOR.put("/api/vendor/org", { data: { name: "QA owner rename", orgId: orgB, org_id: orgB, id: orgB, role: "admin", invitedStaff: true, platformRole: "finance", status: "approved" } })).status()).toBe(200);
        const [after] = await f.connection.query<any[]>("SELECT name FROM organisations WHERE id = ?", [orgA]);
        expect(after[0].name).toBe("QA owner rename");
        await identity(); await orgBUnchanged();
      } finally {
        await f.connection.execute("UPDATE organisations SET name = ?, kind = ? WHERE id = ?", [before[0].name, before[0].kind, orgA]);
      }
      await evidence("stage-b-org", { managerDenials: cases.length, foreignInviteRevocationDenied: true, ownerMassAssignmentIgnored: true });
    });
  } finally { for (const context of opened) await context.dispose(); }
});

test("STAGE-B-MANAGE: linking and workspace switching cannot cross into unlinked identities", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_VENDOR_B", "QA_USER", "QA_USER_B"], async (f) => {
      const [preexisting] = await f.connection.query<any[]>("SELECT COUNT(*) AS n FROM users WHERE resident_id IN (?,?)", [personas.QA_USER.id, personas.QA_USER_B.id]);
      expect(Number(preexisting[0].n), "Personas must start unlinked").toBe(0);
      const residents = await f.snapshot("SELECT * FROM residents WHERE id IN (?,?) ORDER BY id", [personas.QA_USER.id, personas.QA_USER_B.id]);
      const vendorB = await f.snapshot("SELECT id, role, status, org_id, resident_id FROM users WHERE id = ?", [personas.QA_VENDOR_B.id]);
      const userCount = await f.snapshot("SELECT COUNT(*) AS n FROM users", []);
      const noCookie = (response: Awaited<ReturnType<APIRequestContext["post"]>>) => expect(response.headers()["set-cookie"] === undefined, "No session minted").toBe(true);
      let response = await f.actors.QA_VENDOR_B.post("/api/manage/switch", { data: { to: "resident", residentId: personas.QA_USER.id } });
      expect(response.status()).toBe(404); noCookie(response);
      response = await f.actors.QA_USER.post("/api/manage/switch", { data: { to: "vendor", userId: personas.QA_VENDOR_B.id } });
      expect(response.status()).toBe(404); noCookie(response);
      response = await f.actors.QA_USER.post("/api/manage/become-provider", { data: { password: "qa-password-123", vendorType: "community", businessName: "QA", address: "QA", county: "Dublin", mobile: "0", description: "QA", termsAccepted: true } });
      expect(response.status(), "Unverified resident cannot self-provision a provider").toBe(403); noCookie(response);
      response = await f.actors.QA_USER.post("/api/manage/link/confirm", { data: { token: randomUUID().replace(/-/g, "") } });
      expect(response.status()).toBe(400);
      await residents(); await vendorB(); await userCount();
      // Legitimate link for a synthetic vendor, confirmed by the resident's own session.
      const synthetic = await staffLogin(playwright, f, null, null, opened);
      f.track("manage_link_tokens", "user_id", synthetic.id);
      expect((await synthetic.context.post("/api/manage/link/request", { data: { residentEmail: env.QA_USER_B_EMAIL } })).status()).toBe(200);
      const [tokens] = await f.connection.query<any[]>("SELECT token FROM manage_link_tokens WHERE user_id = ?", [synthetic.id]);
      expect(tokens.length).toBe(1);
      // Another vendor cannot request a competing link once it is linked.
      expect((await f.actors.QA_USER_B.post("/api/manage/link/confirm", { data: { token: tokens[0].token } })).status()).toBe(200);
      expect((await f.actors.QA_VENDOR_B.post("/api/manage/link/request", { data: { residentEmail: env.QA_USER_B_EMAIL } })).status()).toBe(409);
      expect((await f.actors.QA_USER_B.post("/api/manage/link/confirm", { data: { token: tokens[0].token } })).status(), "Link token single use").toBe(400);
      // Linked resident switches into exactly the linked vendor; others remain unable.
      const switched = await f.actors.QA_USER_B.post("/api/manage/switch", { data: { to: "vendor", userId: personas.QA_VENDOR_B.id } });
      expect(switched.status()).toBe(200);
      expect((await (await f.actors.QA_USER_B.get("/api/auth/me")).json()).user.id).toBe(synthetic.id);
      response = await f.actors.QA_USER.post("/api/manage/switch", { data: { to: "vendor" } });
      expect(response.status()).toBe(404); noCookie(response);
      response = await f.actors.QA_VENDOR_B.post("/api/manage/switch", { data: { to: "resident" } });
      expect(response.status()).toBe(404); noCookie(response);
      await residents(); await vendorB();
      await f.actors.QA_USER_B.post("/api/auth/logout");
      await evidence("stage-b-manage", { unlinkedSwitchDenied: true, competingLinkDenied: true, tokenSingleUse: true, legitimateSwitchScoped: true });
    });
  } finally { for (const context of opened) await context.dispose(); }
});
