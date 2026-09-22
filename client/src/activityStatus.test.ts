import { describe, expect, it } from "vitest";
import { deriveActivityStatus } from "./activityStatus";

// Host Experience Polish — the derived-status priority order matters (a
// cancelled game must always read "Cancelled" regardless of date/spots,
// a past-but-not-cancelled game reads "Completed" before capacity is even
// considered, etc.), so each precedence rule gets its own case.

describe("deriveActivityStatus", () => {
  it("cancelled always wins, regardless of date or capacity", () => {
    expect(deriveActivityStatus({ status: "cancelled", date: "2099-01-01", spotsLeft: 5, capacity: 10 }).label).toBe("Cancelled");
    expect(deriveActivityStatus({ status: "cancelled", date: "2020-01-01", spotsLeft: 0, capacity: 10 }).label).toBe("Cancelled");
  });

  it("a past date reads Completed even if it was never filled", () => {
    expect(deriveActivityStatus({ status: "open", date: "2020-01-01", spotsLeft: 5, capacity: 10 }).label).toBe("Completed");
  });

  it("pending_participants reads Needs players while still upcoming", () => {
    expect(deriveActivityStatus({ status: "pending_participants", date: "2099-01-01", spotsLeft: 5, capacity: 10 }).label).toBe("Needs players");
  });

  it("derives Full/Almost full/Open from spotsLeft for an upcoming open game", () => {
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 0, capacity: 10 }).label).toBe("Full");
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 2, capacity: 10 }).label).toBe("Almost full");
    expect(deriveActivityStatus({ status: "open", date: "2099-01-01", spotsLeft: 8, capacity: 10 }).label).toBe("Open");
  });
});
