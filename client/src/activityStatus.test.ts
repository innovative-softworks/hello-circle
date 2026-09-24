import { describe, expect, it } from "vitest";
import { deriveActivityStatus } from "./activityStatus";

// Host Experience Polish — the derived-status priority order matters (a
// cancelled game must always read "Cancelled" regardless of date/spots,
// a past-but-not-cancelled game reads "Completed" before capacity is even
// considered, etc.), so each precedence rule gets its own case.

describe("deriveActivityStatus", () => {
  it("cancelled always wins, regardless of date or capacity", () => {
    expect(deriveActivityStatus({ status: "cancelled", date: "2099-01-01", spotsLeft: 5, capacity: 10, effectiveLifecycle: "cancelled" }).label).toBe("Cancelled");
    expect(deriveActivityStatus({ status: "cancelled", date: "2020-01-01", spotsLeft: 0, capacity: 10, effectiveLifecycle: "cancelled" }).label).toBe("Cancelled");
  });

  it("a past date reads Completed even if it was never filled", () => {
    expect(deriveActivityStatus({ status: "open", date: "2020-01-01", spotsLeft: 5, capacity: 10, effectiveLifecycle: "completed" }).label).toBe("Completed");
  });

  it("pending_participants reads Needs players while still upcoming", () => {
    expect(deriveActivityStatus({ status: "pending_participants", date: "2099-01-01", spotsLeft: 5, capacity: 10, effectiveLifecycle: "active" }).label).toBe("Needs players");
  });

  it("derives Full/Almost full/Open from spotsLeft for an upcoming open game", () => {
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 0, capacity: 10, effectiveLifecycle: "active" }).label).toBe("Full");
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 2, capacity: 10, effectiveLifecycle: "active" }).label).toBe("Almost full");
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 8, capacity: 10, effectiveLifecycle: "active" }).label).toBe("Open");
  });

  // Universal Publishing, Lifecycle & Availability System — effectiveLifecycle
  // takes priority over the capacity/date-derived labels below it (a draft/
  // coming_soon/paused activity's spotsLeft is meaningless to a viewer until
  // it's actually active).
  it("draft/coming_soon/paused/archived read their own label, ahead of capacity/date", () => {
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 0, capacity: 10, effectiveLifecycle: "draft" }).label).toBe("Draft");
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 0, capacity: 10, effectiveLifecycle: "coming_soon" }).label).toBe("Coming soon");
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 0, capacity: 10, effectiveLifecycle: "paused" }).label).toBe("Paused");
    expect(deriveActivityStatus({ status: "open", date: "2020-01-01", spotsLeft: 0, capacity: 10, effectiveLifecycle: "archived" }).label).toBe("Archived");
  });
});
