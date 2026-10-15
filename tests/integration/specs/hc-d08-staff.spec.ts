import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, env } from "../fixtures";
import { evidence } from "../authorization-fixture";
import { test, withActors, rows } from "../lifecycle-fixture";
import { bookingBody, guest, irelandDate } from "../booking-fixture";
import { mailTo } from "../product-fixture";
import { loginAs, seedCentre, syntheticOrg } from "../org-fixture";

// D-08 (approved for local implementation 2026-10-15) — owner-managed staff
// role changes and removal. Real server, real sessions, isolated database.
// Logins (real limiter of 10 per IP): owner, manager, finance, other org's
// owner, QA_ADMIN, removed member's re-login, two invite acceptances = 8.

test("D08-STAFF: role changes and removal take effect on the next request, are protected against stale screens and other organisations, and keep attribution", async ({ playwright }) => {
  test.setTimeout(150_000);
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN"], async (f) => {
      const org = await syntheticOrg(playwright, f, opened, ["centre_manager", "finance"], ["owner", 0, 1]);
      const other = await syntheticOrg(playwright, f, opened, [], ["owner"]);
      const [owner, manager, finance] = [org.owner, org.staff[0], org.staff[1]];
      const staffOf = async () => ((await (await owner.ctx!.get("/api/vendor/org")).json()).staff as { id: string; rowVersion: number; invitedStaff: boolean; platformRole: string }[]);
      const versionOf = async (id: string) => (await staffOf()).find((m) => m.id === id)!.rowVersion;

      const centre = await seedCentre(f, manager.id, { payment: "cash" }); // created by the manager
      const couponCode = `QAD08${randomUUID().slice(0, 6).toUpperCase()}`;
      // A coupon with real terms and some use, to prove removal changes only who holds it.
      await f.connection.execute(
        "INSERT INTO coupons (code, kind, amount, max_uses, used_count, expires_at, active, created_by_vendor_id, eligible_listing_type, eligible_listing_id, funding, min_spend_cents, per_customer_limit) VALUES (?, 'percent', 15, 20, 3, '2031-01-01', 1, ?, 'centre', ?, 'partner', 1000, 2)",
        [couponCode, manager.id, centre.id]
      );
      f.track("coupons", "code", couponCode);
      expect((await manager.ctx!.put(`/api/vendor/centres/${centre.id}`, { data: { blurb: "Edited by the manager" } })).status()).toBe(200);
      const staff = await staffOf();
      expect(staff.find((m) => m.id === owner.id)?.invitedStaff).toBe(false);
      expect(typeof staff.find((m) => m.id === manager.id)?.rowVersion).toBe("number");

      // --- who can change whom -----------------------------------------------------
      const v0 = await versionOf(manager.id);
      expect((await finance.ctx!.put(`/api/vendor/org/staff/${manager.id}`, { data: { platformRole: "finance", rowVersion: v0 } })).status(), "staff can't change staff").toBe(403);
      expect((await owner.ctx!.put(`/api/vendor/org/staff/${owner.id}`, { data: { platformRole: "finance", rowVersion: 0 } })).status(), "owner can't change themselves").toBe(403);
      expect((await other.owner.ctx!.put(`/api/vendor/org/staff/${manager.id}`, { data: { platformRole: "finance", rowVersion: v0 } })).status(), "another organisation").toBe(404);
      expect((await other.owner.ctx!.delete(`/api/vendor/org/staff/${manager.id}`, { data: { rowVersion: v0 } })).status()).toBe(404);
      // No ownership change through the API: extra fields are ignored.
      expect((await owner.ctx!.put(`/api/vendor/org/staff/${manager.id}`, { data: { platformRole: "centre_manager", rowVersion: v0, invitedStaff: false, orgId: other.id } })).status()).toBe(200);
      expect((await rows(f, "SELECT invited_staff, org_id FROM users WHERE id = ?", [manager.id]))[0]).toEqual({ invited_staff: 1, org_id: org.id });

      // --- role change: next request on the same session --------------------------
      const v1 = await versionOf(manager.id);
      const changed = await owner.ctx!.put(`/api/vendor/org/staff/${manager.id}`, { data: { platformRole: "read_only_analyst", rowVersion: v1 } });
      expect(changed.status()).toBe(200);
      expect((await manager.ctx!.put(`/api/vendor/centres/${centre.id}`, { data: { blurb: "Not any more" } })).status(), "no re-login needed").toBe(403);
      // Stale screen.
      expect((await owner.ctx!.put(`/api/vendor/org/staff/${manager.id}`, { data: { platformRole: "finance", rowVersion: v1 } })).status()).toBe(409);
      // Two tabs at once: one wins.
      const v2 = await versionOf(manager.id);
      const tabs = await Promise.all(["finance", "communications"].map((r) => owner.ctx!.put(`/api/vendor/org/staff/${manager.id}`, { data: { platformRole: r, rowVersion: v2 } })));
      expect(tabs.map((r) => r.status()).sort()).toEqual([200, 409]);
      const [roleAudit] = await rows(f, "SELECT actor_user_id, previous_value, new_value FROM audit_log WHERE object_id = ? AND action = 'org.staff_role_changed' ORDER BY id LIMIT 1 OFFSET 0", [manager.id]);
      expect(roleAudit.actor_user_id).toBe(owner.id);
      expect(JSON.parse(roleAudit.new_value)).toMatchObject({ orgId: org.id });

      // --- suspension blocks staff management (and joining) -------------------------
      const token = randomBytes(32).toString("hex"), inviteEmail = `qa_d08_invitee_${randomUUID().slice(0, 8)}@example.test`;
      await f.connection.execute("INSERT INTO org_invites (token, org_id, email, platform_role, expires_at) VALUES (?, ?, ?, 'finance', DATE_ADD(NOW(), INTERVAL 7 DAY))", [token, org.id, inviteEmail]);
      f.track("org_invites", "token", token);
      const suspension = { status: "suspended", reasonCategory: "terms_breach", explanation: "Repeated breach of the partner terms on bookings." };
      expect((await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.id}/status`, { data: suspension })).status()).toBe(200);
      const v3 = await versionOf(finance.id).catch(() => 0);
      expect((await owner.ctx!.put(`/api/vendor/org/staff/${finance.id}`, { data: { platformRole: "communications", rowVersion: v3 } })).status()).toBe(403);
      expect((await owner.ctx!.delete(`/api/vendor/org/staff/${finance.id}`, { data: { rowVersion: v3 } })).status()).toBe(403);
      const joiner = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
      opened.push(joiner);
      const pw = randomBytes(16).toString("hex");
      expect((await joiner.post("/api/auth/accept-invite", { data: { token, name: "QA invitee", password: pw, termsAccepted: true } })).status(), "can't join a suspended organisation").toBe(409);
      expect((await rows(f, "SELECT status FROM org_invites WHERE token = ?", [token]))[0].status).toBe("pending");
      expect((await f.actors.QA_ADMIN.put(`/api/admin/organisations/${org.id}/status`, { data: { status: "active" } })).status()).toBe(200);
      const joined = await joiner.post("/api/auth/accept-invite", { data: { token, name: "QA invitee", password: pw, termsAccepted: true } });
      expect(joined.status()).toBe(201);
      const invitee = (await joined.json()).user.id as string;
      for (const [t, c] of [["users", "id"], ["sessions", "user_id"], ["audit_log", "object_id"], ["consent_records", "subject_id"]]) f.track(t, c, invitee);

      // --- removal ---------------------------------------------------------------
      const snapshot = async () => ({
        coupon: (await rows(f, "SELECT * FROM coupons WHERE code = ?", [couponCode]))[0],
        centre: (await rows(f, "SELECT * FROM centres WHERE id = ?", [centre.id]))[0],
      });
      const beforeRemoval = await snapshot();
      const v4 = await versionOf(manager.id);
      expect((await owner.ctx!.delete(`/api/vendor/org/staff/${manager.id}`, { data: { rowVersion: v4 - 1 } })).status(), "stale removal").toBe(409);
      expect((await owner.ctx!.delete(`/api/vendor/org/staff/${manager.id}`, { data: { rowVersion: v4 } })).status()).toBe(200);
      // The old session no longer works; the account itself still exists and can sign in, with no workspace.
      expect([401, 403]).toContain((await manager.ctx!.get("/api/vendor/listings")).status());
      const relogin = await loginAs(playwright, manager.email, manager.password, opened);
      const denied = await relogin.get("/api/vendor/listings");
      expect(denied.status()).toBe(403);
      expect((await denied.json()).removedFromOrg).toBe(true);
      expect((await relogin.get("/api/vendor/obligations")).status()).toBe(403);
      // The listing and coupon stay with the organisation; the creator is still recorded.
      expect((await rows(f, "SELECT vendor_id, created_by_user_id FROM centres WHERE id = ?", [centre.id]))[0]).toEqual({ vendor_id: owner.id, created_by_user_id: manager.id });
      expect((await rows(f, "SELECT created_by_vendor_id FROM coupons WHERE code = ?", [couponCode]))[0].created_by_vendor_id).toBe(owner.id);
      // Only the holder fields changed; terms, usage, limits, eligibility and every other column are identical.
      const afterRemoval = await snapshot();
      const without = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
      expect(without(afterRemoval.coupon, ["created_by_vendor_id"])).toEqual(without(beforeRemoval.coupon, ["created_by_vendor_id"]));
      expect(without(afterRemoval.centre, ["vendor_id", "created_by_user_id"])).toEqual(without(beforeRemoval.centre, ["vendor_id", "created_by_user_id"]));
      // The new holder is in the same organisation.
      expect((await rows(f, "SELECT org_id FROM users WHERE id = ?", [afterRemoval.coupon.created_by_vendor_id]))[0].org_id).toBe(org.id);
      expect((await owner.ctx!.put(`/api/vendor/centres/${centre.id}`, { data: { blurb: "Owner can still edit it" } })).status()).toBe(200);
      const g = await guest(playwright, opened);
      const sale = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { date: irelandDate(18) }) });
      expect(sale.status(), "still sellable").toBe(201);
      f.track("bookings", "ref", (await sale.json()).ref);
      const [removedAudit] = await rows(f, "SELECT actor_user_id, previous_value, new_value FROM audit_log WHERE object_id = ? AND action = 'org.staff_removed'", [manager.id]);
      expect(removedAudit.actor_user_id).toBe(owner.id);
      expect(JSON.parse(removedAudit.previous_value)).toMatchObject({ orgId: org.id, membership: "member" });
      expect(JSON.parse(removedAudit.new_value)).toMatchObject({ orgId: null, membership: "removed", movedToOwner: { ownerId: owner.id, previousHolder: manager.id, centres: [centre.id] } });
      // Earlier history is untouched (the role-change audit still names the manager).
      expect(Number((await rows(f, "SELECT COUNT(*) AS n FROM audit_log WHERE object_id = ? AND action = 'org.staff_role_changed'", [manager.id]))[0].n)).toBeGreaterThan(0);
      const subjects = (await mailTo(f.actors.QA_ADMIN, manager.email)).map((m) => m.subject);
      expect(subjects).toContain("Your role on HelloCircle has changed");
      expect(subjects).toContain("You've been removed from an organisation on HelloCircle");
      // Unrelated membership unaffected.
      expect((await other.owner.ctx!.get("/api/vendor/listings")).status()).toBe(200);
      expect((await finance.ctx!.get("/api/vendor/listings")).status()).toBe(200);

      await evidence("d08-staff", { roleChangeNextRequest: 403, staleWrites: 409, concurrentTabs: tabs.map((r) => r.status()).sort().join("+"), removedOldSession: "401/403", crossOrg: 404 });
    });
  } finally {
    for (const c of opened) await c.dispose();
  }
});
