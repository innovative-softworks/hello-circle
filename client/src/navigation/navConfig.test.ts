import { describe, expect, it } from "vitest";
import { EXPLORE_LEARN, EXPLORE_PLACES, EXPLORE_PLACES_SOON, EXPLORE_THINGS, START_GROUPS, START_ITEMS, START_PATHS, EXPLORE_PATHS, accountItemKeys, isUnder, visibleItems, type AccountContext, type NavContext } from "./navConfig";

const ctx = (over: Partial<NavContext> = {}): NavContext => ({ venuesPublic: false, openBooking: false, isVendor: false, ...over });
const keys = (items: { key: string }[]) => items.map((i) => i.key);

const base: AccountContext = { resident: false, role: null, vendorApproved: false, vendorLinkedResident: false, linkedVendor: null, hasHosted: false, organisedCircles: 0 };

describe("Explore menu", () => {
  it("keeps every existing item, with additions around them", () => {
    // Navigation audit 2026-10-22: Circles is top-level only; programmes and
    // volunteering are their own group.
    expect(keys(EXPLORE_THINGS)).toEqual(["all", "activities", "adventures", "experiences", "events"]);
    expect(keys(EXPLORE_LEARN)).toEqual(["programmes", "volunteer"]);
  });

  it("sends Explore everything and Events to the search page", () => {
    const to = Object.fromEntries(EXPLORE_THINGS.map((i) => [i.key, i.to]));
    expect(to.all).toBe("/explore");
    expect(to.events).toBe("/explore?when=weekend");
    expect(to.activities).toBe("/games");
  });

  it("hides venue destinations while venue pages are not public", () => {
    expect(visibleItems(EXPLORE_PLACES, ctx())).toEqual([]);
    expect(keys(visibleItems(EXPLORE_PLACES, ctx({ venuesPublic: true })))).toEqual(["centres", "clubs"]);
    // Owner 2026-10-22: while venues are gated, both show as "Soon" and go to
    // the coming-soon page, never to the gated routes.
    expect(visibleItems(EXPLORE_PLACES_SOON, ctx()).map((i) => [i.key, i.to, i.soon])).toEqual([
      ["centres-soon", "/coming-soon", true],
      ["clubs-soon", "/coming-soon", true],
    ]);
    expect(visibleItems(EXPLORE_PLACES_SOON, ctx({ venuesPublic: true }))).toEqual([]);
  });
});

describe("Start menu", () => {
  it("shows Make It Happen only when its switch is on", () => {
    expect(keys(visibleItems(START_ITEMS, ctx()))).not.toContain("make-it-happen");
    expect(keys(visibleItems(START_ITEMS, ctx({ openBooking: null })))).not.toContain("make-it-happen");
    expect(keys(visibleItems(START_ITEMS, ctx({ openBooking: true })))).toContain("make-it-happen");
  });

  it("doesn't offer List your venue to a vendor account", () => {
    expect(keys(visibleItems(START_ITEMS, ctx()))).toContain("list-venue");
    expect(keys(visibleItems(START_ITEMS, ctx({ isVendor: true })))).not.toContain("list-venue");
  });

  it("only links to creation flows that exist", () => {
    expect(START_ITEMS.map((i) => i.to)).toEqual(["/games/host", "/make-it-happen", "/circles/start", "/become-a-host", "/for-venues"]);
    expect(START_GROUPS.map((g) => g.label)).toEqual(["Organise something", "Build a community", "Host or list with us"]);
  });
});

describe("active section", () => {
  it("treats create flows as Start, not Explore or Circles", () => {
    expect(isUnder("/games/host", START_PATHS)).toBe(true);
    expect(isUnder("/circles/start", START_PATHS)).toBe(true);
    expect(isUnder("/games/abc", START_PATHS)).toBe(false);
    expect(isUnder("/games/abc", EXPLORE_PATHS)).toBe(true);
  });

  it("matches whole path segments only", () => {
    expect(isUnder("/gamesx", EXPLORE_PATHS)).toBe(false);
    expect(isUnder("/centres/c1", EXPLORE_PATHS)).toBe(true);
  });
});

describe("account menu by role", () => {
  it("gives a guest nothing", () => {
    expect(accountItemKeys(base)).toEqual([]);
  });

  it("gives a resident their personal items only", () => {
    expect(accountItemKeys({ ...base, resident: true })).toEqual(["profile", "my-life", "my-bookings", "my-circles", "saved", "notifications", "messages", "become-host", "settings", "payments", "help"]);
  });

  it("adds Manage for hosts and organisers", () => {
    expect(accountItemKeys({ ...base, resident: true, hasHosted: true })).toContain("manage-hosting");
    const organiser = accountItemKeys({ ...base, resident: true, organisedCircles: 2 });
    expect(organiser).toContain("manage-hosting");
    expect(organiser).toContain("manage-circles");
    expect(organiser).not.toContain("become-host");
  });

  it("never gives an admin-only session resident items", () => {
    const admin = accountItemKeys({ ...base, role: "admin" });
    expect(admin).toEqual(["admin-dashboard", "admin-pending"]);
    expect(admin).not.toContain("my-life");
  });

  it("names a vendor's listing work separately and only when approved", () => {
    expect(accountItemKeys({ ...base, role: "vendor", vendorApproved: true })).toEqual(["messages", "vendor-dashboard", "vendor-listings"]);
    expect(accountItemKeys({ ...base, role: "vendor" })).not.toContain("vendor-listings");
  });

  it("offers workspace switches only to linked accounts", () => {
    expect(accountItemKeys({ ...base, role: "vendor", vendorLinkedResident: true })).toContain("switch-to-personal");
    expect(accountItemKeys({ ...base, role: "vendor" })).not.toContain("switch-to-personal");
    expect(accountItemKeys({ ...base, resident: true, linkedVendor: "approved" })).toContain("switch-to-vendor");
    expect(accountItemKeys({ ...base, resident: true, linkedVendor: "pending" })).toEqual(expect.arrayContaining(["vendor-pending"]));
    expect(accountItemKeys({ ...base, resident: true, linkedVendor: "pending" })).not.toContain("switch-to-vendor");
  });
});
