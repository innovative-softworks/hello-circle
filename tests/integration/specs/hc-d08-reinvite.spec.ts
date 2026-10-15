import { randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { seedCentre, syntheticOrg } from "../org-fixture";

// D-08 follow-up — re-inviting a removed team member with the same email.
// A fresh invitation is required and must be accepted with the person's
// existing password; nothing reactivates by itself. Real server, real
// sessions, isolated database; invite tokens are read from the disposable
// database (the mail sink records no bodies).
// Limiter budget (10 per IP; accept-invite counts): 3 logins + 6 acceptances = 9.

test("D08-REINVITE: removed → re-invited → accepted with the same identity; old, replaced, expired and revoked links stay invalid", async ({ playwright }) => {
  test.setTimeout(150_000);
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN"], async (f) => {
      const org = await syntheticOrg(playwright, f, opened, ["centre_manager"], ["owner"]);
      const other = await syntheticOrg(playwright, f, opened, [], ["owner"]);
      const [owner, member] = [org.owner, org.staff[0]];
      const centre = await seedCentre(f, member.id, { payment: "cash" });
      const tokensFor = async (orgId: string) =>
        (await rows(f, "SELECT token, status FROM org_invites WHERE org_id = ? AND LOWER(email) = ? ORDER BY created_at, token", [orgId, member.email])) as { token: string; status: string }[];
      const anon = async () => {
        const c = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
        opened.push(c);
        return c;
      };
      const accept = (c: APIRequestContext, token: string, password: string) => c.post("/api/auth/accept-invite", { data: { token, name: "", password, termsAccepted: true } });

      // Someone already on the team can't be invited again.
      expect((await owner.ctx!.post("/api/vendor/org/staff/invite", { data: { email: member.email, platformRole: "finance" } })).status()).toBe(409);

      // Remove the member (D-08).
      const rv = Number((await rows(f, "SELECT row_version FROM users WHERE id = ?", [member.id]))[0].row_version);
      expect((await owner.ctx!.delete(`/api/vendor/org/staff/${member.id}`, { data: { rowVersion: rv } })).status()).toBe(200);
      expect((await rows(f, "SELECT org_id FROM users WHERE id = ?", [member.id]))[0].org_id).toBeNull();

      // Two invites at once (double click): only the newest link stays valid.
      const both = await Promise.all([1, 2].map(() => owner.ctx!.post("/api/vendor/org/staff/invite", { data: { email: member.email, platformRole: "finance" } })));
      expect(both.map((r) => r.status())).toEqual([201, 201]);
      let tokens = await tokensFor(org.id);
      for (const t of tokens) f.track("org_invites", "token", t.token);
      expect(tokens.filter((t) => t.status === "pending")).toHaveLength(1);
      expect(tokens.filter((t) => t.status === "replaced")).toHaveLength(1);
      const replaced = tokens.find((t) => t.status === "replaced")!.token;
      const pending = tokens.find((t) => t.status === "pending")!.token;

      // Invalid links: replaced (by lookup and by acceptance), expired and revoked (by lookup).
      const c1 = await anon();
      expect((await c1.get(`/api/invites/${replaced}`)).status()).toBe(404);
      expect((await accept(c1, replaced, member.password)).status(), "replaced link").toBe(400);
      const expired = randomBytes(32).toString("hex");
      await f.connection.execute("INSERT INTO org_invites (token, org_id, email, platform_role, expires_at) VALUES (?, ?, ?, 'finance', DATE_SUB(NOW(), INTERVAL 1 DAY))", [expired, org.id, member.email]);
      f.track("org_invites", "token", expired);
      expect((await c1.get(`/api/invites/${expired}`)).status()).toBe(404);
      const revoked = randomBytes(32).toString("hex");
      await f.connection.execute("INSERT INTO org_invites (token, org_id, email, platform_role, status, expires_at) VALUES (?, ?, ?, 'finance', 'revoked', DATE_ADD(NOW(), INTERVAL 7 DAY))", [revoked, org.id, member.email]);
      f.track("org_invites", "token", revoked);
      expect((await c1.get(`/api/invites/${revoked}`)).status()).toBe(404);

      // Another organisation also invites them; it can't revoke or see the first organisation's invite.
      expect((await other.owner.ctx!.post("/api/vendor/org/staff/invite", { data: { email: member.email, platformRole: "communications" } })).status()).toBe(201);
      const otherToken = (await tokensFor(other.id))[0].token;
      f.track("org_invites", "token", otherToken);
      const [ownHashRow] = await rows(f, "SELECT SHA2(token, 256) AS id FROM org_invites WHERE token = ?", [pending]);
      expect((await other.owner.ctx!.delete(`/api/vendor/org/staff/invite/${ownHashRow.id}`)).status()).toBe(200);
      expect((await rows(f, "SELECT status FROM org_invites WHERE token = ?", [pending]))[0].status, "another organisation can't revoke it").toBe("pending");

      // Suspended organisation: can't invite, can't be joined; the invite waits.
      expect((await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "suspended", reasonCategory: "other", explanation: "QA re-invite check while suspended." } })).status()).toBe(200);
      expect((await owner.ctx!.post("/api/vendor/org/staff/invite", { data: { email: "qa_nobody_reinvite@example.test", platformRole: "finance" } })).status()).toBe(403);
      const c2 = await anon();
      expect((await accept(c2, pending, member.password)).status()).toBe(409);
      expect((await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "active" } })).status()).toBe(200);

      // The lookup tells the page this is a rejoin; a wrong password doesn't rejoin.
      expect((await (await c2.get(`/api/invites/${pending}`)).json()).rejoin).toBe(true);
      expect((await accept(c2, pending, "not-the-password-123")).status()).toBe(401);
      expect((await rows(f, "SELECT org_id FROM users WHERE id = ?", [member.id]))[0].org_id).toBeNull();

      // Two acceptances at once: exactly one rejoins.
      const c3 = await anon();
      const c4 = await anon();
      const accepted = await Promise.all([accept(c3, pending, member.password), accept(c4, pending, member.password)]);
      expect(accepted.map((r) => r.status()).sort()).toEqual([201, 400]);
      const winner = accepted[0].status() === 201 ? c3 : c4;
      const [after] = await rows(f, "SELECT id, email, org_id, platform_role, invited_staff FROM users WHERE id = ?", [member.id]);
      expect(after).toEqual({ id: member.id, email: member.email, org_id: org.id, platform_role: "finance", invited_staff: 1 }); // same identity
      expect((await rows(f, "SELECT status FROM org_invites WHERE token = ?", [pending]))[0].status).toBe("accepted");
      expect((await winner.get("/api/vendor/listings")).status(), "workspace access after rejoining").toBe(200);
      // Attribution from before the removal is untouched (the listing stays with the owner, creator recorded).
      expect((await rows(f, "SELECT vendor_id, created_by_user_id FROM centres WHERE id = ?", [centre.id]))[0]).toEqual({ vendor_id: owner.id, created_by_user_id: member.id });
      const [audit] = await rows(f, "SELECT actor_user_id, previous_value, new_value FROM audit_log WHERE object_id = ? AND action = 'org.staff_rejoined'", [member.id]);
      expect(JSON.parse(audit.new_value)).toMatchObject({ orgId: org.id, membership: "member", platformRole: "finance", via: "invitation" });

      // The other organisation's invite can't pull them across now.
      expect((await accept(c3, otherToken, member.password)).status()).toBe(409);
      expect((await rows(f, "SELECT org_id FROM users WHERE id = ?", [member.id]))[0].org_id).toBe(org.id);
      // And the accepted link can't be used again.
      expect((await winner.get(`/api/invites/${pending}`)).status()).toBe(404);

      await evidence("d08-reinvite", { concurrentInvites: "201+201 → 1 pending", concurrentAccepts: accepted.map((r) => r.status()).sort().join("+"), wrongPassword: 401, crossOrgAccept: 409, suspendedAccept: 409 });
    });
  } finally {
    for (const c of opened) await c.dispose();
  }
});
