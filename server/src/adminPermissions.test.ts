import type { NextFunction, Request, Response, Router } from "express";
import { describe, expect, it } from "vitest";
import { ADMIN_ROLES, type AuthedUser } from "./auth.js";
import { ADMIN_PERMISSIONS, adminCan, isAdminPermission, permissionsOf, requireAdminPermission, type AdminPermission } from "./adminPermissions.js";
import { adminRouter } from "./routes/admin.js";
import { adminMediaRouter } from "./routes/adminMedia.js";
import { reviewsRouter } from "./routes/reviews.js";

// D-02 — admin permissions. The inventory walks the real Express routers
// (including mounted sub-routers), so a route added without an explicit
// permission declaration fails here.

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: { adminPermission?: string } }[] };
  name?: string;
  handle: { stack?: Layer[]; adminPermission?: string };
  regexp?: RegExp;
};

function inventory(router: Router, prefix: string): { route: string; permission: string | undefined }[] {
  const out: { route: string; permission: string | undefined }[] = [];
  for (const layer of (router as unknown as { stack: Layer[] }).stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route!.methods[m]).map((m) => m.toUpperCase());
      // The permission guard must be the first route-level handler.
      const permission = layer.route.stack[0]?.handle.adminPermission;
      for (const m of methods) out.push({ route: `${m} ${prefix}${layer.route.path}`, permission });
    } else if (layer.name === "router" && layer.handle.stack) {
      // Mounted sub-router: recover its mount path from the layer regexp.
      const src = layer.regexp?.source ?? "";
      const mount = src.replace(/^\^\\\//, "/").replace(/\\\/\?\(\?=\\\/\|\$\)$/i, "").replace(/\\\//g, "/");
      out.push(...inventory(layer.handle as unknown as Router, `${prefix}${mount}`));
    }
  }
  return out;
}

const admin = (adminRole: string | null): AuthedUser => ({ id: "u", email: "a@example.test", role: "admin", status: "approved", adminRole } as unknown as AuthedUser);

function run(handler: (req: Request, res: Response, next: NextFunction) => void, user: AuthedUser | undefined) {
  let status = 0;
  let nextCalled = false;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } } as unknown as Response;
  handler({ user } as Request, res, () => { nextCalled = true; });
  return nextCalled ? 200 : status;
}

describe("admin route inventory", () => {
  const routes = [
    ...inventory(adminRouter, "/api/admin"),
    ...inventory(adminMediaRouter, "/api/admin/media"),
    ...inventory(reviewsRouter, "/api/reviews").filter((r) => r.route === "DELETE /api/reviews/:id"),
  ];

  it("finds the admin routes, including the mounted finance, commerce, policy, complaints and traders routers", () => {
    expect(routes.length).toBeGreaterThan(130);
    for (const mount of ["/api/admin/finance/", "/api/admin/commerce/", "/api/admin/policies", "/api/admin/complaints", "/api/admin/traders", "/api/admin/help/", "/api/admin/media/"]) {
      expect(routes.some((r) => r.route.includes(mount)), mount).toBe(true);
    }
  });

  it("every admin route declares exactly one known permission as its first handler", () => {
    const missing = routes.filter((r) => !r.permission || !isAdminPermission(r.permission));
    expect(missing, `routes without a declared permission:\n${missing.map((r) => r.route).join("\n")}`).toEqual([]);
  });

  it("reports a route that has no permission (the check can fail)", async () => {
    const { Router } = await import("express");
    const probe = Router();
    const sub = Router();
    probe.get("/tagged", requireAdminPermission("workspace.view"), (_q, r) => r.end());
    sub.post("/untagged", (_q, r) => r.end());
    probe.use("/nested", sub);
    const found = inventory(probe, "/x");
    expect(found.find((r) => r.route === "GET /x/tagged")?.permission).toBe("workspace.view");
    expect(found.find((r) => r.route === "POST /x/nested/untagged")?.permission).toBeUndefined();
  });

  it("the admin-only review DELETE (which only hides) is review moderation", () => {
    expect(routes.find((r) => r.route === "DELETE /api/reviews/:id")?.permission).toBe("reviews.moderate");
  });
});

describe("deny by default", () => {
  it("refuses unknown permission names, empty roles, unknown roles and non-admins", () => {
    expect(adminCan(admin("super"), "listings.everything")).toBe(false);
    expect(adminCan(admin(null), "workspace.view")).toBe(false);
    expect(adminCan(admin(""), "workspace.view")).toBe(false);
    expect(adminCan(admin("owner"), "workspace.view")).toBe(false);
    expect(adminCan({ ...admin("super"), role: "vendor" } as AuthedUser, "workspace.view")).toBe(false);
    expect(adminCan(undefined, "workspace.view")).toBe(false);
  });

  it("refuses to build a guard for a permission that isn't in the table", () => {
    expect(() => requireAdminPermission("not.a.permission" as AdminPermission)).toThrow(/Unknown admin permission/);
  });

  it("guard: no session 401, non-admin 403, admin without the permission 403, admin with it passes", () => {
    const guard = requireAdminPermission("partners.suspend");
    expect(run(guard, undefined)).toBe(401);
    expect(run(guard, { ...admin("super"), role: "vendor" } as AuthedUser)).toBe(403);
    expect(run(guard, admin("support"))).toBe(403);
    expect(run(guard, admin(null))).toBe(403);
    expect(run(guard, admin("super"))).toBe(200);
  });

  it("no environment variable changes a decision", () => {
    const before = ADMIN_ROLES.map((r) => permissionsOf(admin(r)).join(","));
    for (const key of ["ADMIN_RBAC_ENFORCE", "ADMIN_RBAC_MODE", "ADMIN_PERMISSIONS_BYPASS", "ADMIN_RBAC_LOG_ONLY"]) {
      for (const value of ["log", "off", "false", "0", "bypass", "all"]) {
        process.env[key] = value;
        expect(ADMIN_ROLES.map((r) => permissionsOf(admin(r)).join(","))).toEqual(before);
        delete process.env[key];
      }
    }
  });
});

describe("the approved matrix", () => {
  const holders = (p: AdminPermission) => ADMIN_PERMISSIONS[p] as readonly string[];

  it("every permission names at least super and only known roles", () => {
    for (const [name, roles] of Object.entries(ADMIN_PERMISSIONS)) {
      expect(roles, name).toContain("super");
      for (const r of roles) expect(ADMIN_ROLES as readonly string[], `${name}: ${r}`).toContain(r);
    }
  });

  it("partner suspension, reinstatement and destructive actions are super-only", () => {
    for (const p of ["partners.suspend", "listings.delete", "commerce.governance_switches", "coupons.delete", "templates.delete", "media.delete", "admins.manage", "orgs.manage", "partners.tier", "partners.platform_role", "platform.settings"] as AdminPermission[]) {
      expect(holders(p), p).toEqual(["super"]);
    }
  });

  it("support holds the moderation permissions", () => {
    for (const p of ["listings.moderate", "listings.edit", "listings.feature", "partners.approve", "queues.decide", "reports.moderate", "reviews.moderate", "complaints.handle", "demand.notify"] as AdminPermission[]) {
      expect(holders(p), p).toContain("support");
    }
    expect(holders("finance.payment_state.view")).toContain("support");
    expect(holders("finance.operate")).not.toContain("support");
  });

  it("finance keeps its money tools and gets no moderation", () => {
    for (const p of ["finance.operate", "commerce.operate", "coupons.manage", "finance.payment_state.view"] as AdminPermission[]) expect(holders(p), p).toContain("finance");
    for (const p of ["listings.moderate", "partners.approve", "queues.decide", "reports.moderate", "decisions.internal_notes.view"] as AdminPermission[]) expect(holders(p), p).not.toContain("finance");
  });

  it("legal keeps policy, help, templates, trader verification, complaints and report decisions", () => {
    for (const p of ["policies.manage", "help.edit", "templates.edit", "traders.verify", "complaints.handle", "reports.moderate", "decisions.internal_notes.view"] as AdminPermission[]) expect(holders(p), p).toContain("legal");
    for (const p of ["listings.moderate", "partners.approve", "queues.decide", "finance.operate"] as AdminPermission[]) expect(holders(p), p).not.toContain("legal");
  });
});
