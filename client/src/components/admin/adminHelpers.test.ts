import { describe, expect, it } from "vitest";
import { ADMIN_ITEMS, ADMIN_NAV, canUse, groupOf, isAdminTab, navItem } from "./adminNav";
import { describeAuditAction, describeObject, shortValue } from "./auditFormat";
import { dueLabel, sortQueue, waitingLabel } from "./AdminOverview";
import { listingChecks, similarListings } from "./listingReview";

describe("admin navigation", () => {
  it("keeps every pre-redesign tab key reachable", () => {
    const legacy = ["overview", "vendors", "pending", "listings", "claims", "hostApplications", "placeSuggestions", "reviews", "coupons", "commerce", "finance", "policies", "organisations", "demand", "marketplaceHealth", "audit", "support", "notificationTemplates", "media"];
    for (const key of legacy) expect(isAdminTab(key)).toBe(true);
    expect(isAdminTab("settings")).toBe(true);
    expect(isAdminTab("bogus")).toBe(false);
    expect(isAdminTab(null)).toBe(false);
  });

  it("uses the requested groups (plus Operations, OG-14), each tool exactly once", () => {
    expect(ADMIN_NAV.map((g) => g.label)).toEqual(["Admin", "Operations", "Marketplace", "Business", "Trust & Platform"]);
    const keys = ADMIN_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(29); // + Privacy requests (OG-29), + Categories (2026-10-22)
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
    expect(shortValue('{"adminRole":"super"}')).toBe("super");
    expect(shortValue('{"status":"approved","decisionId":1}')).toBe("approved");
    expect(shortValue('{"decisionId":1}')).toBeNull();
    expect(shortValue('[1,2]')).toBeNull();
    expect(shortValue(null)).toBeNull();
  });
});

describe("overview queue", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  it("labels waiting time and deadlines", () => {
    expect(waitingLabel("2026-10-13T12:00:00Z", now)).toBe("Waiting 3 days");
    expect(waitingLabel("2026-10-16T11:30:00Z", now)).toBe("Waiting 30 min");
    expect(waitingLabel(null, now)).toBeNull();
    expect(dueLabel("2026-10-16T16:00:00Z", now)).toBe("4 h left");
    expect(dueLabel("2026-10-16T10:00:00Z", now)).toBe("Overdue by 2 h");
  });
  it("puts deadlines first, then the oldest", () => {
    const items = [
      { id: "new", urgency: "normal" as const, since: "2026-10-15T00:00:00Z" },
      { id: "old", urgency: "normal" as const, since: "2026-10-01T00:00:00Z" },
      { id: "undated", urgency: "normal" as const, since: null },
      { id: "late", urgency: "urgent" as const, since: "2026-10-16T00:00:00Z", due: "2026-10-18T00:00:00Z" },
      { id: "soon", urgency: "urgent" as const, since: "2026-10-16T00:00:00Z", due: "2026-10-16T14:00:00Z" },
      { id: "nodue", urgency: "urgent" as const, since: "2026-10-10T00:00:00Z", due: null },
    ];
    expect(sortQueue(items).map((i) => i.id)).toEqual(["soon", "late", "nodue", "old", "new", "undated"]);
  });
});

describe("listing review checks", () => {
  const base = { id: "c1", name: "alex", status: "pending", area: "Naas", county: "Kildare", ph: "", image: "", blurb: "", vendorId: "v1", vendorEmail: "a@b.ie", vendorStatus: "approved" as const, featured: 0 };
  it("flags garbled descriptions, missing photos and unusable rooms", () => {
    const checks = listingChecks({ ...base, blurb: "This uis gggdgfdbhfghjgfjghjhgjhgjghj" }, {
      type: "centre",
      images: [],
      description: "This uis gggdgfdbhfghjgfjghjhgjhgjghj",
      centre: { rooms: [{ name: "Main Room", capacity: 0, rate: 0, description: "", paymentMethod: "online", active: 1 }], hours: [], opensAt: "09:00", closesAt: "21:00", amenities: [] },
    });
    const state = Object.fromEntries(checks.map((c) => [c.key, c.state]));
    expect(state).toMatchObject({ photo: "warn", description: "warn", location: "pass", bookable: "warn", partner: "pass" });
  });
  it("blocks only on an unapproved partner", () => {
    const checks = listingChecks({ ...base, vendorStatus: "pending" }, null);
    expect(checks.filter((c) => c.state === "fail").map((c) => c.key)).toEqual(["partner"]);
  });
  it("finds similar names in the same county only", () => {
    const rows = [
      { item: { id: "a", name: "Ballincollig Community Centre", county: "Cork" } },
      { item: { id: "b", name: "Ballincollig GAA", county: "Cork" } },
      { item: { id: "c", name: "Ballincollig Hall", county: "Kerry" } },
      { item: { id: "d", name: "Douglas Community Centre", county: "Cork" } },
    ];
    expect(similarListings({ id: "x", name: "Ballincollig Centre", county: "Cork" }, rows).map((r) => r.item.id)).toEqual(["a", "b"]);
  });
});

describe("Insights merge", () => {
  it("keeps ?tab=demand working as a hidden alias of Insights", () => {
    expect(isAdminTab("demand")).toBe(true);
    expect(navItem("demand").hidden).toBe(true);
    expect(navItem("demand").aliasOf).toBe("marketplaceHealth");
    expect(navItem("marketplaceHealth").label).toBe("Insights");
    expect(ADMIN_ITEMS.filter((i) => !i.hidden)).toHaveLength(28);
  });
});

describe("Finance split", () => {
  it("has Finance (old key) and Plans & credit pages", () => {
    expect(navItem("finance").label).toBe("Finance");
    expect(navItem("plansCredit").label).toBe("Plans & credit");
    expect(navItem("plansCredit").permissions).toEqual(["finance.operate"]);
    expect(groupOf("plansCredit")).toBe("Business");
  });
});
