import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { centreFor, staffLogin } from "../stage-b-fixture";

// Server authorization is authoritative; no UI is involved. Every non-admin
// role (including invited read-only and manager staff) is denied high-risk
// admin mutations with every targeted row unchanged; admin is the positive
// control and has no implicit resident/vendor powers.

test("STAGE-B-ADMIN: guest, user, host, vendor, read-only staff and manager cannot perform admin mutations", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["GUEST", "QA_USER", "QA_HOST", "QA_VENDOR", "QA_ADMIN"], async (f) => {
      const analyst = await staffLogin(playwright, f, "QA_VENDOR", "read_only_analyst", opened);
      const manager = await staffLogin(playwright, f, "QA_VENDOR", "centre_manager", opened);
      // Synthetic targets only: pending vendor, pending host applicant, org, centre.
      const vendorId = randomUUID(), residentId = randomUUID(), orgId = randomUUID();
      await f.connection.execute("INSERT INTO organisations (id, name, kind) VALUES (?, 'QA admin target org', 'vendor')", [orgId]);
      await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'pending', 'QA admin target', ?)", [vendorId, `qa_admin_target_${vendorId}@example.test`, orgId]);
      await f.connection.execute("INSERT INTO residents (id, email, name, host_status, host_applied_at) VALUES (?, ?, 'QA host applicant', 'pending', NOW())", [residentId, `qa_admin_applicant_${residentId}@example.test`]);
      for (const [table, column, id] of [["organisations", "id", orgId], ["users", "id", vendorId], ["residents", "id", residentId], ["feature_flags", "org_id", orgId], ["audit_log", "object_id", vendorId], ["audit_log", "object_id", residentId], ["audit_log", "object_id", orgId]]) f.track(table, column, id);
      const centre = await centreFor(f, "QA_VENDOR");
      f.track("audit_log", "object_id", analyst.id);
      const invariants = await Promise.all([
        f.snapshot("SELECT * FROM users WHERE id IN (?,?,?) ORDER BY id", [vendorId, analyst.id, manager.id]),
        f.snapshot("SELECT * FROM residents WHERE id = ?", [residentId]),
        f.snapshot("SELECT * FROM centres WHERE id = ?", [centre.id]),
        f.snapshot("SELECT * FROM organisations WHERE id = ?", [orgId]),
        f.snapshot("SELECT * FROM feature_flags WHERE org_id = ? ORDER BY flag_key", [orgId]),
        f.snapshot("SELECT * FROM app_settings ORDER BY 1", []),
        f.snapshot("SELECT COUNT(*) AS n FROM organisations", []),
        f.snapshot("SELECT COUNT(*) AS n FROM audit_log", []),
      ]);
      const mutations = (X: APIRequestContext): [() => ReturnType<APIRequestContext["put"]>, string][] => [
        [() => X.put(`/api/admin/vendors/${vendorId}/status`, { data: { status: "approved" } }), "vendor approval"],
        [() => X.put(`/api/admin/vendors/${analyst.id}/platform-role`, { data: { platformRole: "finance" } }), "staff role assignment"],
        [() => X.put(`/api/admin/vendors/${vendorId}/provider-tier`, { data: { providerTier: "featured" } }), "provider tier"],
        [() => X.put(`/api/admin/host-applications/${residentId}/status`, { data: { status: "verified" } }), "host verification"],
        [() => X.put(`/api/admin/centres/${centre.id}/status`, { data: { status: "approved" } }), "listing approval"],
        [() => X.put(`/api/admin/centres/${centre.id}/organisation`, { data: { organisationId: orgId } }), "ownership change"],
        [() => X.put(`/api/admin/centres/${centre.id}/featured`, { data: { featured: true } }), "featured flag"],
        [() => X.delete(`/api/admin/centres/${centre.id}`), "listing delete"],
        [() => X.post("/api/admin/organisations", { data: { name: "QA forbidden org" } }), "organisation create"],
        [() => X.put(`/api/admin/organisations/${orgId}/flags/programs`, { data: { enabled: false } }), "feature flag"],
        [() => X.put("/api/admin/config/maps-enabled", { data: { enabled: true } }), "global config"],
        [() => X.put("/api/admin/media/config/uploads-enabled", { data: { enabled: true } }), "media config"],
        [() => X.get("/api/admin/audit"), "audit read"],
        [() => X.get("/api/admin/host-applications"), "applicant PII read"],
        [() => X.get(`/api/admin/support/search?q=${encodeURIComponent("qa")}`), "support search"],
      ];
      const results: Record<string, number[]> = {};
      for (const [role, actor] of [["GUEST", f.actors.GUEST], ["QA_USER", f.actors.QA_USER], ["QA_HOST", f.actors.QA_HOST], ["QA_VENDOR", f.actors.QA_VENDOR], ["READ_ONLY_STAFF", analyst.context], ["MANAGER", manager.context]] as [string, APIRequestContext][]) {
        results[role] = [];
        for (const [call, label] of mutations(actor)) {
          const status = (await call()).status();
          results[role].push(status);
          expect(status, `${role} ${label}`).toBe(401);
          for (const unchanged of invariants) await unchanged();
        }
      }
      // Admin has no implicit resident/vendor powers.
      for (const [call, label] of [
        [() => f.actors.QA_ADMIN.get("/api/vendor/listings"), "vendor workspace"],
        [() => f.actors.QA_ADMIN.put(`/api/vendor/centres/${centre.id}`, { data: { name: "Admin via vendor API" } }), "vendor mutation"],
        [() => f.actors.QA_ADMIN.post("/api/circles", { data: { name: "Admin circle" } }), "resident Circle"],
        [() => f.actors.QA_ADMIN.get("/api/residents/me/receipts"), "resident receipts"],
      ] as [() => ReturnType<APIRequestContext["get"]>, string][]) {
        expect((await call()).status(), `admin ${label}`).toBe(401);
        for (const unchanged of invariants) await unchanged();
      }
      // Admin positive control on synthetic targets only.
      expect((await f.actors.QA_ADMIN.put(`/api/admin/vendors/${analyst.id}/platform-role`, { data: { platformRole: "finance" } })).status()).toBe(200);
      expect((await f.actors.QA_ADMIN.put(`/api/admin/host-applications/${residentId}/status`, { data: { status: "verified" } })).status()).toBe(200);
      const [role] = await f.connection.query<any[]>("SELECT platform_role FROM users WHERE id = ?", [analyst.id]);
      const [host] = await f.connection.query<any[]>("SELECT host_status FROM residents WHERE id = ?", [residentId]);
      expect(role[0].platform_role === "finance" && host[0].host_status === "verified").toBe(true);
      await evidence("stage-b-admin", results);
      expect(personas.QA_ADMIN.role).toBe("admin");
    });
  } finally { for (const context of opened) await context.dispose(); }
});
