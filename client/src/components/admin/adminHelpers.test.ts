import { describe, expect, it } from "vitest";
import { ADMIN_ITEMS, ADMIN_NAV, canUse, isAdminTab, navItem } from "./adminNav";
import { describeAuditAction, describeObject, shortValue } from "./auditFormat";

describe("admin navigation", () => {
  it("keeps every pre-redesign tab key reachable", () => {
    const legacy = ["overview", "vendors", "pending", "listings", "claims", "hostApplications", "placeSuggestions", "reviews", "coupons", "commerce", "finance", "policies", "organisations", "demand", "marketplaceHealth", "audit", "support", "notificationTemplates", "media"];
    for (const key of legacy) expect(isAdminTab(key)).toBe(true);
    expect(isAdminTab("settings")).toBe(true);
    expect(isAdminTab("bogus")).toBe(false);
    expect(isAdminTab(null)).toBe(false);
  });

  it("uses the four requested groups, each tool exactly once", () => {
    expect(ADMIN_NAV.map((g) => g.label)).toEqual(["Admin", "Marketplace", "Business", "Trust & Platform"]);
    const keys = ADMIN_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(20);
  });

  it("locks an item unless the admin holds one of its permissions (D-02)", () => {
    const can = (held: string[]) => (...wanted: string[]) => wanted.some((p) => held.includes(p));
    expect(canUse(can(["finance.operate"]), navItem("finance"))).toBe(true);
    expect(canUse(can(["finance.payment_state.view"]), navItem("finance"))).toBe(true);
    expect(canUse(can(["coupons.manage"]), navItem("coupons"))).toBe(true);
    expect(canUse(can(["listings.moderate"]), navItem("coupons"))).toBe(false);
    expect(canUse(can(["complaints.handle"]), navItem("policies"))).toBe(true);
    expect(canUse(can([]), navItem("overview"))).toBe(false);
  });

  it("every nav item names at least one permission, and every name exists in the server's table", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const serverTable = readFileSync(fileURLToPath(new URL("../../../../server/src/adminPermissions.ts", import.meta.url)), "utf8");
    const known = new Set([...serverTable.matchAll(/^\s+"([a-z_]+\.[a-z_.]+)":/gm)].map((m) => m[1]));
    expect(known.size).toBeGreaterThan(30);
    for (const item of ADMIN_ITEMS) {
      expect(item.permissions.length, item.key).toBeGreaterThan(0);
      for (const p of item.permissions) expect(known.has(p), `${item.key}: ${p}`).toBe(true);
    }
  });
});

describe("audit wording", () => {
  it("translates known codes", () => {
    expect(describeAuditAction("vendor.status_changed")).toBe("Changed a partner account's status");
    expect(describeAuditAction("feature")).toBe("Featured a listing");
  });

  it("falls back to readable words for unknown codes", () => {
    expect(describeAuditAction("widget.colour_changed")).toBe("Colour changed · widget");
    expect(describeAuditAction("something_new")).toBe("Something new");
    expect(describeObject("resident_host_application")).toBe("host application");
    expect(describeObject("mystery_thing")).toBe("mystery thing");
  });

  it("shows short scalar values only", () => {
    expect(shortValue('"approved"')).toBe("approved");
    expect(shortValue("true")).toBe("true");
    expect(shortValue('{"adminRole":"super"}')).toBeNull();
    expect(shortValue(null)).toBeNull();
  });
});
