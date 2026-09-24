import { describe, expect, it } from "vitest";
import {
  canBook,
  canDiscover,
  canIndex,
  getEffectiveAvailability,
  getEffectiveLifecycle,
  getPublicLifecycleLabel,
  LIFECYCLE_BY_ENTITY,
  validateLifecycleTransition,
} from "./lifecycle.js";

// Publishing/Lifecycle system, Phase B — the shared policy every entity
// route is meant to call into instead of re-deriving this logic inline.
// Brief §78-79: test valid/invalid transitions and schedule boundaries with
// a fixed, injected clock (never real system time), to avoid flaky tests.

describe("validateLifecycleTransition — §28 explicit transition rules", () => {
  it("allows the documented happy-path progression", () => {
    expect(validateLifecycleTransition("activity", "draft", "coming_soon").ok).toBe(true);
    expect(validateLifecycleTransition("activity", "draft", "active").ok).toBe(true);
    expect(validateLifecycleTransition("activity", "coming_soon", "active").ok).toBe(true);
    expect(validateLifecycleTransition("activity", "active", "paused").ok).toBe(true);
    expect(validateLifecycleTransition("activity", "paused", "active").ok).toBe(true);
    expect(validateLifecycleTransition("activity", "active", "completed").ok).toBe(true);
    expect(validateLifecycleTransition("activity", "active", "cancelled").ok).toBe(true);
    expect(validateLifecycleTransition("activity", "completed", "archived").ok).toBe(true);
  });

  it("rejects the brief's own explicit invalid-transition examples", () => {
    expect(validateLifecycleTransition("activity", "cancelled", "active").ok).toBe(false);
    expect(validateLifecycleTransition("activity", "archived", "coming_soon").ok).toBe(false);
    expect(validateLifecycleTransition("activity", "completed", "draft").ok).toBe(false);
  });

  it("a same-state transition is always a no-op success", () => {
    expect(validateLifecycleTransition("activity", "active", "active")).toEqual({ ok: true });
  });

  it("rejects a state that isn't in that entity kind's own allow-list even if the base graph would permit it", () => {
    // Circle never supports 'completed' at all (§19 — circles don't have a
    // dated end, unlike Activities/Programs).
    expect(LIFECYCLE_BY_ENTITY.circle).not.toContain("completed");
    const result = validateLifecycleTransition("circle", "active", "completed");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not a valid state for circle/);
  });

  it("terminal states (archived) have no forward transitions", () => {
    expect(validateLifecycleTransition("activity", "archived", "active").ok).toBe(false);
    expect(validateLifecycleTransition("activity", "archived", "draft").ok).toBe(false);
  });
});

describe("getEffectiveLifecycle — §25-26 scheduled transitions derived at read time, no cron job", () => {
  const now = new Date("2027-04-15T09:00:00.000Z");

  it("§25: a future start_date does NOT automatically mean coming_soon — stored lifecycle wins when no schedule fields are set", () => {
    expect(getEffectiveLifecycle({ lifecycle: "active" }, now)).toBe("active");
  });

  it("coming_soon becomes active exactly at (and after) bookingOpenAt", () => {
    expect(getEffectiveLifecycle({ lifecycle: "coming_soon", bookingOpenAt: "2027-04-15T09:00:00.000Z" }, now)).toBe("active");
    expect(getEffectiveLifecycle({ lifecycle: "coming_soon", bookingOpenAt: "2027-04-15T09:00:01.000Z" }, now)).toBe("coming_soon");
    expect(getEffectiveLifecycle({ lifecycle: "coming_soon", bookingOpenAt: "2027-04-14T09:00:00.000Z" }, now)).toBe("active");
  });

  it("active becomes paused exactly at (and after) bookingCloseAt", () => {
    expect(getEffectiveLifecycle({ lifecycle: "active", bookingCloseAt: "2027-04-15T09:00:00.000Z" }, now)).toBe("paused");
    expect(getEffectiveLifecycle({ lifecycle: "active", bookingCloseAt: "2027-04-15T09:00:01.000Z" }, now)).toBe("active");
  });

  it("a publishAt in the future overrides everything to draft, regardless of the stored lifecycle value", () => {
    expect(getEffectiveLifecycle({ lifecycle: "active", publishAt: "2027-04-16T00:00:00.000Z" }, now)).toBe("draft");
    expect(getEffectiveLifecycle({ lifecycle: "coming_soon", publishAt: "2027-04-16T00:00:00.000Z" }, now)).toBe("draft");
  });

  it("a publishAt in the past has no effect — real lifecycle applies", () => {
    expect(getEffectiveLifecycle({ lifecycle: "active", publishAt: "2027-04-14T00:00:00.000Z" }, now)).toBe("active");
  });

  it("manual override always reflected: stored lifecycle is never mutated by this function (pure, no side effects)", () => {
    const schedule = { lifecycle: "coming_soon" as const, bookingOpenAt: "2020-01-01T00:00:00.000Z" };
    getEffectiveLifecycle(schedule, now);
    expect(schedule.lifecycle).toBe("coming_soon");
  });
});

describe("canDiscover / canIndex — §41, §54-58", () => {
  it("draft is never discoverable or indexable", () => {
    expect(canDiscover("draft")).toBe(false);
    expect(canIndex("draft")).toBe(false);
  });

  it("coming_soon, active, and paused are all discoverable/indexable", () => {
    for (const l of ["coming_soon", "active", "paused"] as const) {
      expect(canDiscover(l)).toBe(true);
      expect(canIndex(l)).toBe(true);
    }
  });

  it("completed/cancelled/archived are excluded from normal discovery by default", () => {
    for (const l of ["completed", "cancelled", "archived"] as const) {
      expect(canDiscover(l)).toBe(false);
    }
  });
});

describe("canBook — §9-13, §48 server-side transaction gate", () => {
  it("only 'active' lifecycle ever permits booking, regardless of availability", () => {
    for (const l of ["draft", "coming_soon", "paused", "completed", "cancelled", "archived"] as const) {
      expect(canBook(l, "open")).toBe(false);
    }
  });

  it("active + open/limited/full/waitlist all permit initiating some transaction (full still allows joining the waitlist)", () => {
    expect(canBook("active", "open")).toBe(true);
    expect(canBook("active", "limited")).toBe(true);
    expect(canBook("active", "full")).toBe(true);
    expect(canBook("active", "waitlist")).toBe(true);
  });

  it("active + not_open/closed never permits booking", () => {
    expect(canBook("active", "not_open")).toBe(false);
    expect(canBook("active", "closed")).toBe(false);
  });
});

describe("getEffectiveAvailability — §50-51 derived, not stored", () => {
  it("draft/coming_soon always report not_open regardless of capacity", () => {
    expect(getEffectiveAvailability("draft", 10, 0, false)).toBe("not_open");
    expect(getEffectiveAvailability("coming_soon", 10, 0, false)).toBe("not_open");
  });

  it("paused/cancelled/completed/archived always report closed regardless of capacity", () => {
    for (const l of ["paused", "cancelled", "completed", "archived"] as const) {
      expect(getEffectiveAvailability(l, 10, 3, false)).toBe("closed");
    }
  });

  it("active: open/limited/full derived correctly from capacity vs confirmed", () => {
    expect(getEffectiveAvailability("active", 10, 3, false)).toBe("open");
    expect(getEffectiveAvailability("active", 10, 9, false)).toBe("limited"); // 1 spot left, <= default almostFullAt=2
    expect(getEffectiveAvailability("active", 10, 10, false)).toBe("full");
  });

  it("active + full + waitlist enabled reports waitlist instead of full", () => {
    expect(getEffectiveAvailability("active", 10, 10, true)).toBe("waitlist");
  });

  it("no capacity tracked at all (null) defaults to open, never crashes", () => {
    expect(getEffectiveAvailability("active", null, null, false)).toBe("open");
  });
});

describe("getPublicLifecycleLabel — §32-35 user-facing copy", () => {
  it("every lifecycle value has a real label, no technical enum values leak through", () => {
    for (const l of ["draft", "coming_soon", "active", "paused", "completed", "cancelled", "archived"] as const) {
      const label = getPublicLifecycleLabel(l, "open");
      expect(label).not.toBe(l);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("active's label varies by availability, not a bare 'Active' pill (§34: normal should look normal)", () => {
    expect(getPublicLifecycleLabel("active", "open")).toBe("Open");
    expect(getPublicLifecycleLabel("active", "full")).toBe("Full");
    expect(getPublicLifecycleLabel("active", "waitlist")).toBe("Waitlist");
    expect(getPublicLifecycleLabel("active", "limited")).toBe("Almost full");
  });
});
