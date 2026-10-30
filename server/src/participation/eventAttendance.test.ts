import { describe, expect, it } from "vitest";
import { classifyEventBooking } from "./eventAttendance.js";

// Pilot remediation (final-validation/14) — the per-booking rule, without a database.
describe("classifyEventBooking", () => {
  it("one person, checked in: the booking and the person attended", () => {
    expect(classifyEventBooking([1], new Set([1]), "present")).toEqual({ state: "attended", people: { expected: 1, attended: 1, noShow: 0, notRecorded: 0, markedPresentNotRecorded: 0 } });
  });

  it("partly checked-in group: attended booking; the others are not recorded, never no-shows", () => {
    expect(classifyEventBooking([1, 2, 4], new Set([1]), "present")).toEqual({ state: "attended", people: { expected: 3, attended: 1, noShow: 0, notRecorded: 2, markedPresentNotRecorded: 0 } });
  });

  it("a check-in of someone no longer on the booking doesn't count", () => {
    expect(classifyEventBooking([1, 2], new Set([3]), null).people.attended).toBe(0);
  });

  it("marked didn't come: a no-show booking and every person on it a no-show", () => {
    expect(classifyEventBooking([1, 2], new Set(), "no_show")).toEqual({ state: "no_show", people: { expected: 2, attended: 0, noShow: 2, notRecorded: 0, markedPresentNotRecorded: 0 } });
  });

  it("a door check-in outranks a didn't-come mark", () => {
    expect(classifyEventBooking([1, 2], new Set([2]), "no_show")).toEqual({ state: "attended", people: { expected: 2, attended: 1, noShow: 0, notRecorded: 1, markedPresentNotRecorded: 0 } });
  });

  it("marked present without per-person check-ins: attended booking, people not recorded", () => {
    expect(classifyEventBooking([1, 2], new Set(), "present")).toEqual({ state: "attended", people: { expected: 2, attended: 0, noShow: 0, notRecorded: 2, markedPresentNotRecorded: 2 } });
  });

  it("nothing recorded: unknown, not a no-show", () => {
    expect(classifyEventBooking([1], new Set(), null)).toEqual({ state: "not_recorded", people: { expected: 1, attended: 0, noShow: 0, notRecorded: 1, markedPresentNotRecorded: 0 } });
  });
});
