import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { test, expect, env, personas, manifest } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import type { Scope } from "../stage-b-fixture";

// D-02 (approved for local implementation 2026-10-14) — admin permissions,
// deny by default, against the real server and the isolated QA database.
// Logins in this batch (real limiter of 10 per IP): QA_ADMIN + QA_VENDOR,
// three sub-admins + a no-role and an unknown-role admin, one extra super = 8.

// Smallest valid PNG (1×1), for the upload checks.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function adminLogin(playwright: PlaywrightWorkerArgs["playwright"], f: Scope, adminRole: string | null, opened: APIRequestContext[]) {
  const id = randomUUID(), password = randomBytes(32).toString("hex"), email = `qa_admin_${adminRole ?? "none"}_${id}@example.test`;
  await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, ?, 'admin', 'approved', 'QA D-02 admin', ?)", [id, email, bcrypt.hashSync(password, 10), adminRole]);
  f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id); f.track("audit_log", "object_id", id);
  const context = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
  opened.push(context);
  expect((await context.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  return { id, context };
}

const REASON = { reasonCategory: "incomplete", explanation: "Opening hours and a description are still missing." };

test("D02-MATRIX: each admin role gets exactly its permissions; denied writes change nothing; 401 vs 403", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN", "QA_VENDOR"], async (f) => {
      const ctx: Record<string, APIRequestContext> = { super: f.actors.QA_ADMIN };
      const ids: Record<string, string> = {};
      for (const role of ["finance", "support", "legal"]) {
        const a = await adminLogin(playwright, f, role, opened);
        ctx[role] = a.context; ids[role] = a.id;
      }
      const noRole = (await adminLogin(playwright, f, null, opened)).context;
      const unknownRole = (await adminLogin(playwright, f, "owner", opened)).context;

      // The permission list the UI mirrors comes from the server table.
      const perms: Record<string, string[]> = {};
      for (const role of ["super", "finance", "support", "legal"]) {
        const r = await ctx[role].get("/api/admin/permissions");
        expect(r.status(), role).toBe(200);
        const body = await r.json();
        expect(body.role).toBe(role);
        perms[role] = body.permissions;
      }
      expect(perms.super).toContain("partners.suspend");
      for (const role of ["finance", "support", "legal"]) expect(perms[role], role).not.toContain("partners.suspend");
      expect(perms.support).toEqual(expect.arrayContaining(["listings.moderate", "partners.approve", "queues.decide"]));
      expect(perms.finance).not.toContain("listings.moderate");
      expect(perms.legal).toEqual(expect.arrayContaining(["policies.manage", "traders.verify", "complaints.handle"]));

      // Reads.
      const reads: [string, Record<string, number>][] = [
        ["/api/admin/stats", { super: 200, finance: 200, support: 200, legal: 200 }],
        ["/api/admin/audit", { super: 200, finance: 200, support: 200, legal: 200 }],
        ["/api/admin/listings", { super: 200, finance: 200, support: 200, legal: 200 }],
        ["/api/admin/claims", { super: 200, finance: 403, support: 200, legal: 200 }],
        ["/api/admin/host-applications", { super: 200, finance: 403, support: 200, legal: 200 }],
        ["/api/admin/finance/refunds", { super: 200, finance: 200, support: 200, legal: 403 }],
        ["/api/admin/finance/webhooks", { super: 200, finance: 200, support: 403, legal: 403 }],
        ["/api/admin/coupons", { super: 200, finance: 200, support: 403, legal: 403 }],
        ["/api/admin/commerce/rules", { super: 200, finance: 200, support: 403, legal: 403 }],
        ["/api/admin/complaints", { super: 200, finance: 403, support: 200, legal: 200 }],
        ["/api/admin/policies", { super: 200, finance: 403, support: 403, legal: 200 }],
        ["/api/admin/notification-templates", { super: 200, finance: 403, support: 403, legal: 200 }],
        ["/api/admin/media/editorial", { super: 200, finance: 403, support: 200, legal: 403 }],
        ["/api/admin/admins", { super: 200, finance: 403, support: 403, legal: 403 }],
      ];
      for (const [path, byRole] of reads) {
        for (const [role, status] of Object.entries(byRole)) expect((await ctx[role].get(path)).status(), `${role} GET ${path}`).toBe(status);
        expect((await noRole.get(path)).status(), `no-role GET ${path}`).toBe(403);
        expect((await unknownRole.get(path)).status(), `unknown-role GET ${path}`).toBe(403);
      }
      expect((await noRole.get("/api/admin/permissions")).status(), "no-role permissions").toBe(403);
      expect((await unknownRole.get("/api/admin/permissions")).status(), "unknown-role permissions").toBe(403);

      // Synthetic write targets.
      const vendorId = randomUUID(), residentId = randomUUID(), centreId = randomUUID();
      await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'pending', 'QA D-02 target')", [vendorId, `qa_d02_${vendorId}@example.test`]);
      await f.connection.execute("INSERT INTO residents (id, email, name, host_status, host_applied_at) VALUES (?, ?, 'QA D-02 applicant', 'pending', NOW())", [residentId, `qa_d02_${residentId}@example.test`]);
      await f.connection.execute("INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, status, created_at) VALUES (?, 'QA D-02 centre', 'QA', 'Dublin', 0, 0, 0, 0, '', '', '', 'QA', 'pending', NOW())", [centreId]);
      for (const [t, c, id] of [["users", "id", vendorId], ["residents", "id", residentId], ["centres", "id", centreId], ["audit_log", "object_id", vendorId], ["audit_log", "object_id", residentId], ["audit_log", "object_id", centreId], ["moderation_decisions", "object_id", vendorId], ["moderation_decisions", "object_id", residentId], ["moderation_decisions", "object_id", centreId], ["notifications", "recipient_id", vendorId], ["notifications", "resident_id", residentId]] as const) f.track(t, c, id);
      const invariants = await Promise.all([
        f.snapshot("SELECT * FROM users WHERE id = ?", [vendorId]),
        f.snapshot("SELECT * FROM residents WHERE id = ?", [residentId]),
        f.snapshot("SELECT * FROM centres WHERE id = ?", [centreId]),
        f.snapshot("SELECT COUNT(*) AS n FROM moderation_decisions", []),
        f.snapshot("SELECT COUNT(*) AS n FROM audit_log", []),
        f.snapshot("SELECT COUNT(*) AS n FROM coupons", []),
        f.snapshot("SELECT id, admin_role FROM users WHERE role = 'admin' ORDER BY id", []),
      ]);
      const suspend = { status: "suspended", reasonCategory: "terms_breach", explanation: "QA D-02: this request must be refused." };
      const denied: [string, () => ReturnType<APIRequestContext["put"]>][] = [];
      const add = (label: string, roles: string[], call: (X: APIRequestContext) => ReturnType<APIRequestContext["put"]>) => {
        for (const role of roles) denied.push([`${role} ${label}`, () => call(ctx[role])]);
        denied.push([`no-role ${label}`, () => call(noRole)]);
        denied.push([`unknown-role ${label}`, () => call(unknownRole)]);
      };
      add("suspend partner", ["finance", "support", "legal"], (X) => X.put(`/api/admin/vendors/${vendorId}/status`, { data: suspend }));
      add("approve partner", ["finance", "legal"], (X) => X.put(`/api/admin/vendors/${vendorId}/status`, { data: { status: "approved" } }));
      add("reject listing", ["finance", "legal"], (X) => X.put(`/api/admin/centres/${centreId}/status`, { data: { status: "rejected", ...REASON } }));
      add("delete listing", ["finance", "support", "legal"], (X) => X.delete(`/api/admin/centres/${centreId}`));
      add("decide host application", ["finance", "legal"], (X) => X.put(`/api/admin/host-applications/${residentId}/status`, { data: { status: "verified" } }));
      add("provider tier", ["finance", "support", "legal"], (X) => X.put(`/api/admin/vendors/${vendorId}/provider-tier`, { data: { providerTier: "featured" } }));
      add("create coupon", ["support", "legal"], (X) => X.post("/api/admin/coupons", { data: { code: `QAD02${randomUUID().slice(0, 6)}`, kind: "percent", value: 10, reason: "QA D-02 refused" } }));
      add("change admin role", ["finance", "support", "legal"], (X) => X.put(`/api/admin/admins/${personas.QA_ADMIN.id}/role`, { data: { adminRole: "finance", reason: "QA D-02 refused" } }));
      add("maps switch", ["finance", "support", "legal"], (X) => X.put("/api/admin/config/maps-enabled", { data: { enabled: true } }));
      for (const [label, call] of denied) {
        expect((await call()).status(), label).toBe(403);
        for (const unchanged of invariants) await unchanged();
      }

      // 401 without a partner/admin session; 403 for a signed-in partner.
      const anon = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
      opened.push(anon);
      for (const [path, method] of [["/api/admin/permissions", "get"], ["/api/admin/stats", "get"], [`/api/admin/vendors/${vendorId}/status`, "put"]] as const) {
        const call = (X: APIRequestContext) => (method === "get" ? X.get(path) : X.put(path, { data: suspend }));
        expect((await call(anon)).status(), `anonymous ${path}`).toBe(401);
        expect((await call(f.actors.QA_VENDOR)).status(), `vendor ${path}`).toBe(403);
      }
      for (const unchanged of invariants) await unchanged();

      // Image uploads (POST /api/uploads): an admin needs listings.edit or media.editorial.
      const upload = (X: APIRequestContext) => X.post("/api/uploads", { multipart: { file: { name: "qa.png", mimeType: "image/png", buffer: PNG } } });
      const uploads: Record<string, number> = {};
      const uploadDir = path.join(manifest.dataDir, "uploads");
      const fileCount = () => (existsSync(uploadDir) ? readdirSync(uploadDir).length : 0);
      for (const [label, X, want] of [["super", ctx.super, 201], ["support", ctx.support, 201], ["finance", ctx.finance, 403], ["legal", ctx.legal, 403], ["no-role", noRole, 403], ["unknown-role", unknownRole, 403], ["vendor", f.actors.QA_VENDOR, 201], ["anonymous", anon, 401]] as [string, APIRequestContext, number][]) {
        const before = fileCount();
        uploads[label] = (await upload(X)).status();
        expect(uploads[label], `upload as ${label}`).toBe(want);
        // A refused upload writes nothing; an allowed one writes exactly one file.
        expect(fileCount(), `files after upload as ${label}`).toBe(before + (want === 201 ? 1 : 0));
      }

      // A role change applies to an existing session on its next request — no
      // fresh login — and a stale copy of the old permissions in the browser
      // can't authorise anything: the server decides every request.
      const staleList = (await (await ctx.support.get("/api/admin/permissions")).json()).permissions as string[];
      expect(staleList).toContain("partners.approve");
      expect((await ctx.super.put(`/api/admin/admins/${ids.support}/role`, { data: { adminRole: "legal", reason: "QA D-02 live role change" } })).status()).toBe(200);
      expect((await (await ctx.support.get("/api/admin/permissions")).json()).role).toBe("legal");
      expect((await ctx.support.put(`/api/admin/vendors/${vendorId}/status`, { data: { status: "approved" } })).status(), "approve after demotion, same session").toBe(403);
      for (const unchanged of invariants.slice(0, 3)) await unchanged();
      expect((await ctx.super.put(`/api/admin/admins/${ids.support}/role`, { data: { adminRole: "support", reason: "QA D-02 restore role" } })).status()).toBe(200);

      // Positive controls: support approves the partner and rejects the listing with a reason.
      expect((await ctx.support.put(`/api/admin/vendors/${vendorId}/status`, { data: { status: "approved" } })).status()).toBe(200);
      expect((await ctx.support.put(`/api/admin/centres/${centreId}/status`, { data: { status: "rejected", ...REASON } })).status()).toBe(200);
      const [[centre]] = await f.connection.query<any[]>("SELECT status FROM centres WHERE id = ?", [centreId]);
      expect(centre.status).toBe("rejected");
      await evidence("d02-matrix", { readRows: reads.length, deniedWrites: denied.length, supportCanApprove: 200, supportCanSuspend: 403, uploadsAllowed: Object.values(uploads).filter((s) => s === 201).length, liveRoleChangeDenied: 403 });
    });
  } finally { for (const c of opened) await c.dispose(); }
});

test("D02-LAST-SUPER: two concurrent demotions can't remove the last super admin", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN"], async (f) => {
      const [[{ n }]] = await f.connection.query<any[]>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND admin_role = 'super'");
      test.skip(Number(n) !== 1, "needs QA_ADMIN to be the only super admin in this isolated database");
      const other = await adminLogin(playwright, f, "super", opened);
      try {
        const [a, b] = await Promise.all([
          f.actors.QA_ADMIN.put(`/api/admin/admins/${other.id}/role`, { data: { adminRole: "finance", reason: "QA concurrent demotion" } }),
          other.context.put(`/api/admin/admins/${personas.QA_ADMIN.id}/role`, { data: { adminRole: "finance", reason: "QA concurrent demotion" } }),
        ]);
        expect([a.status(), b.status()].sort()).toEqual([200, 409]);
        const [[{ supers }]] = await f.connection.query<any[]>("SELECT COUNT(*) AS supers FROM users WHERE role = 'admin' AND admin_role = 'super'");
        expect(Number(supers)).toBe(1);
        await evidence("d02-last-super", { statuses: [a.status(), b.status()].sort(), supersAfter: Number(supers) });
      } finally {
        // Never leave the QA persona demoted, whatever happened above.
        await f.connection.execute("UPDATE users SET admin_role = 'super' WHERE id = ? AND role = 'admin'", [personas.QA_ADMIN.id]);
      }
    });
  } finally { for (const c of opened) await c.dispose(); }
});
