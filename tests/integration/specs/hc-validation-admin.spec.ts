import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { test, expect, env } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { staffLogin, type Scope } from "../stage-b-fixture";

// Full validation 2026-10-14 — admin sub-roles, listing approval lifecycle
// and vendor suspension, against the real server and isolated database.
// Logins per batch (real limiter of 10): 4 + 2 + 2 = 8.

async function subAdminLogin(playwright: PlaywrightWorkerArgs["playwright"], f: Scope, adminRole: string, opened: APIRequestContext[]) {
  const id = randomUUID(), password = randomBytes(32).toString("hex"), email = `qa_admin_${adminRole}_${id}@example.test`;
  await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, ?, 'admin', 'approved', 'QA sub-admin', ?)", [id, email, bcrypt.hashSync(password, 10), adminRole]);
  f.track("users", "id", id); f.track("sessions", "user_id", id); f.track("audit_log", "actor_user_id", id);
  const context = await playwright.request.newContext({ baseURL: env.E2E_BASE_URL });
  opened.push(context);
  expect((await context.post("/api/auth/login", { data: { email, password } })).status()).toBe(200);
  return context;
}

test("VAL-ADMIN-SUBROLES: finance, support and legal are confined to their gated tools; super-only role admin", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN"], async (f) => {
      const expectations: [string, Record<string, number>][] = [
        // D-02: support has read-only refund and payment state (matrix: "V, refunds and payment state only").
        ["/api/admin/finance/refunds", { super: 200, finance: 200, support: 200, legal: 403 }],
        ["/api/admin/finance/webhooks", { super: 200, finance: 200, support: 403, legal: 403 }],
        ["/api/admin/coupons", { super: 200, finance: 200, support: 403, legal: 403 }],
        ["/api/admin/commerce/rules", { super: 200, finance: 200, support: 403, legal: 403 }],
        ["/api/admin/complaints", { super: 200, finance: 403, support: 200, legal: 200 }],
        ["/api/admin/policies", { super: 200, finance: 403, support: 403, legal: 200 }],
        ["/api/admin/traders", { super: 200, finance: 403, support: 200, legal: 200 }],
        ["/api/admin/admins", { super: 200, finance: 403, support: 403, legal: 403 }],
        ["/api/admin/stats", { super: 200, finance: 200, support: 200, legal: 200 }],
      ];
      const contexts: Record<string, APIRequestContext> = { super: f.actors.QA_ADMIN };
      for (const role of ["finance", "support", "legal"]) contexts[role] = await subAdminLogin(playwright, f, role, opened);
      for (const [path, byRole] of expectations) {
        for (const [role, status] of Object.entries(byRole)) {
          expect((await contexts[role].get(path)).status(), `${role} GET ${path}`).toBe(status);
        }
      }
      // A sub-admin can't change admin roles (super-only), including their own.
      const self = await (await contexts.finance.get("/api/auth/me")).json();
      expect((await contexts.finance.put(`/api/admin/admins/${self.user.id}/role`, { data: { adminRole: "super", reason: "Validation attempt" } })).status()).toBe(403);

      // D-02: partner approval is super + support only; legal and finance are refused.
      const target = randomUUID();
      await f.connection.execute("INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'pending', 'QA moderation target')", [target, `qa_mod_${target}@example.test`]);
      f.track("users", "id", target); f.track("audit_log", "object_id", target); f.track("moderation_decisions", "object_id", target);
      expect((await contexts.legal.put(`/api/admin/vendors/${target}/status`, { data: { status: "approved" } })).status()).toBe(403);
      expect((await contexts.finance.put(`/api/admin/vendors/${target}/status`, { data: { status: "approved" } })).status()).toBe(403);
      expect((await f.connection.query<any[]>("SELECT status FROM users WHERE id = ?", [target]))[0][0].status).toBe("pending");
      await evidence("val-admin-subroles", { matrixRows: expectations.length, legalCanApproveVendor: 403 });
    });
  } finally { for (const c of opened) await c.dispose(); }
});

test("VAL-LISTING-LIFECYCLE: draft → pending → rejected → resubmitted → approved, with audit trail", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_ADMIN"], async (f) => {
    const vendor = f.actors.QA_VENDOR, admin = f.actors.QA_ADMIN;
    const created = await vendor.post("/api/vendor/centres", { data: { name: `QA lifecycle ${randomUUID()}`, paymentMethod: "cash" } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id as string;
    for (const [table, column] of [["centres", "id"], ["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"], ["moderation_decisions", "object_id"], ["notifications", "listing_id"]]) f.track(table, column, id);
    expect((await vendor.put(`/api/vendor/centres/${id}`, { data: { area: "Rathmines", county: "Dublin", blurb: "Validation centre" } })).status()).toBe(200);
    expect((await vendor.post(`/api/vendor/centres/${id}/publish`)).status()).toBe(200);
    const status = async () => ((await f.connection.query<any[]>("SELECT status FROM centres WHERE id = ?", [id]))[0][0].status as string);
    expect(await status()).toBe("pending");

    // A second submit of a pending listing is still refused.
    expect((await vendor.post(`/api/vendor/centres/${id}/publish`)).status()).toBe(400);

    // D-03: a rejection needs a reason; without one nothing changes.
    expect((await admin.put(`/api/admin/centres/${id}/status`, { data: { status: "rejected" } })).status()).toBe(400);
    expect(await status()).toBe("pending");
    expect((await admin.put(`/api/admin/centres/${id}/status`, { data: { status: "rejected", reasonCategory: "incomplete", explanation: "Opening hours and a description are missing." } })).status()).toBe(200);
    expect(await status()).toBe("rejected");
    // The vendor UI says a rejected listing "needs changes before it can go live":
    // the vendor must be able to edit and resubmit it for review.
    expect((await vendor.put(`/api/vendor/centres/${id}`, { data: { blurb: "Validation centre, updated after review" } })).status()).toBe(200);
    expect((await vendor.post(`/api/vendor/centres/${id}/publish`)).status(), "resubmit rejected listing").toBe(200);
    expect(await status()).toBe("pending");

    expect((await admin.put(`/api/admin/centres/${id}/status`, { data: { status: "approved" } })).status()).toBe(200);
    expect(await status()).toBe("approved");
    expect((await vendor.post(`/api/vendor/centres/${id}/publish`)).status(), "approved listing can't be resubmitted").toBe(400);

    // Every admin decision is in the audit log with before/after values.
    const [audit] = await f.connection.query<any[]>("SELECT action, previous_value, new_value FROM audit_log WHERE object_id = ? AND action = 'centre.status_changed' ORDER BY id", [id]);
    expect(audit.map((a) => JSON.parse(a.new_value).status)).toEqual(["rejected", "approved"]);
    const [resubmitted] = await f.connection.query<any[]>("SELECT COUNT(*) AS n FROM audit_log WHERE object_id = ? AND action = 'centre.published'", [id]);
    expect(Number(resubmitted[0].n)).toBe(2);
  });
});

test("VAL-SUSPENSION: suspended vendor is locked out; public visibility of their listings is recorded", async ({ playwright }) => {
  const opened: APIRequestContext[] = [];
  try {
    await withActors(playwright, ["QA_ADMIN"], async (f) => {
      const owner = await staffLogin(playwright, f, null, null, opened);
      const created = await owner.context.post("/api/vendor/centres", { data: { name: `QA suspension ${randomUUID()}`, paymentMethod: "cash" } });
      expect(created.status()).toBe(201);
      const id = (await created.json()).id as string;
      for (const [table, column] of [["centres", "id"], ["rooms", "centre_id"], ["centre_amenities", "centre_id"], ["centre_images", "centre_id"], ["audit_log", "object_id"]]) f.track(table, column, id);
      f.track("audit_log", "object_id", owner.id);
      await f.connection.execute("UPDATE centres SET status = 'approved', area = 'QA', county = 'Dublin', blurb = 'QA' WHERE id = ?", [id]);
      f.track("moderation_decisions", "object_id", owner.id);
      f.track("notifications", "recipient_id", owner.id);
      expect((await f.actors.QA_ADMIN.put(`/api/admin/vendors/${owner.id}/status`, { data: { status: "suspended", reasonCategory: "terms_breach", explanation: "QA validation: repeated breach of the partner terms." } })).status()).toBe(200);
      try {
        // Account restrictions are enforced on the existing session too.
        expect((await owner.context.get("/api/vendor/listings")).status()).toBe(403);
        expect((await owner.context.put(`/api/vendor/centres/${id}`, { data: { blurb: "x" } })).status()).toBe(403);
        const [audit] = await f.connection.query<any[]>("SELECT COUNT(*) AS n FROM audit_log WHERE object_id = ? AND action = 'vendor.status_changed'", [owner.id]);
        expect(Number(audit[0].n)).toBe(1);
        // Public visibility after suspension is an open business decision — recorded only.
        const publicDetail = (await playwright.request.newContext({ baseURL: env.E2E_BASE_URL }));
        opened.push(publicDetail);
        await evidence("val-suspension", { publicDetailStatus: (await publicDetail.get(`/api/centres/${id}`)).status() });
      } finally {
        expect((await f.actors.QA_ADMIN.put(`/api/admin/vendors/${owner.id}/status`, { data: { status: "approved" } })).status()).toBe(200);
      }
    });
  } finally { for (const c of opened) await c.dispose(); }
});
