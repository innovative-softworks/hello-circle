import { describe, expect, it } from "vitest";
import { isUpcomingProgramEnrollment } from "./participation";

// Resident Experience Polish — the eligibility predicate that decides
// whether a program enrollment contributes a real dated entry to My Life's
// Next Up timeline. Never true when there's nothing honest to show.

describe("isUpcomingProgramEnrollment", () => {
  const TODAY = "2026-09-22";

  it("is true when a future session exists", () => {
    expect(isUpcomingProgramEnrollment({ status: "confirmed", nextSessionDate: "2026-09-29" }, TODAY)).toBe(true);
  });

  it("is true when the next session is today", () => {
    expect(isUpcomingProgramEnrollment({ status: "confirmed", nextSessionDate: TODAY }, TODAY)).toBe(true);
  });

  it("is false when there is no future session (nextSessionDate is null)", () => {
    expect(isUpcomingProgramEnrollment({ status: "confirmed", nextSessionDate: null }, TODAY)).toBe(false);
  });

  it("is false when the only session on record is in the past", () => {
    expect(isUpcomingProgramEnrollment({ status: "confirmed", nextSessionDate: "2026-08-01" }, TODAY)).toBe(false);
  });

  it("is false when the enrollment is cancelled, even with a future session", () => {
    expect(isUpcomingProgramEnrollment({ status: "cancelled", nextSessionDate: "2026-09-29" }, TODAY)).toBe(false);
  });
});
