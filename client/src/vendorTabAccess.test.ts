import { describe, expect, it } from "vitest";
import { PLATFORM_ROLES } from "./types";
import { VENDOR_TAB_ROLES, vendorTabVisible, type VendorTabKey } from "./vendorTabAccess";

// Sitemap audit P2-03 — vendor tabs filtered by staff platform_role.

const TABS = Object.keys(VENDOR_TAB_ROLES) as VendorTabKey[];
const visibleFor = (platformRole: string | null) => TABS.filter((t) => vendorTabVisible(t, { invitedStaff: true, platformRole }));

describe("vendor tab access", () => {
  it("the organisation owner sees every tab", () => {
    expect(TABS.every((t) => vendorTabVisible(t, { invitedStaff: false, platformRole: null }))).toBe(true);
  });

  it("a read-only analyst sees no write tabs", () => {
    expect(visibleFor("read_only_analyst").sort()).toEqual(["demand", "org", "overview", "schedule"]);
  });

  it("each role sees the tabs it can act in", () => {
    expect(visibleFor("centre_manager").sort()).toEqual(["bookings", "experiences", "listings", "org", "overview", "programs", "schedule"]);
    expect(visibleFor("facility_manager").sort()).toEqual(["bookings", "experiences", "listings", "org", "overview", "programs", "schedule"]);
    expect(visibleFor("finance").sort()).toEqual(["bookings", "demand", "earnings", "offers", "org", "overview", "schedule"]);
    expect(visibleFor("communications").sort()).toEqual(["messages", "org", "overview", "reviews", "schedule"]);
  });

  it("staff with no role (or an unknown one) see only the read-only tabs", () => {
    expect(visibleFor(null).sort()).toEqual(["org", "overview", "schedule"]);
    expect(visibleFor("something_new").sort()).toEqual(["org", "overview", "schedule"]);
  });

  it("only names real platform roles", () => {
    for (const roles of Object.values(VENDOR_TAB_ROLES)) {
      if (roles === "all") continue;
      for (const r of roles) expect(PLATFORM_ROLES).toContain(r);
    }
  });
});
