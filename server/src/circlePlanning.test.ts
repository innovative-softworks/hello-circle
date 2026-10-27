import { describe, expect, it } from "vitest";
import {
  aggregatePulse,
  cleanInterestLabel,
  cleanSlots,
  cleanTargetSize,
  dateOfDay,
  freeDays,
  isSelectableWeek,
  matchFreeTime,
  normaliseInterest,
  planIdeaExpiry,
  planStage,
  selectableWeeks,
  weekExpiry,
  weekStartOf,
  type AvailabilityRow,
  type PulseRow,
} from "./circlePlanning.js";

const W = "2026-10-26"; // a Monday; the clocks went back on Sunday 25 Oct 2026

const pulse = (residentId: string, interest: string, slots: string[] = [], weekStart = W): PulseRow => ({
  residentId,
  interest,
  interestKey: normaliseInterest(interest),
  weekStart,
  slots,
});
const free = (residentId: string, slots: string[], weekStart = W): AvailabilityRow => ({ residentId, weekStart, slots });

describe("weeks", () => {
  it("finds the Monday of an Ireland week", () => {
    expect(weekStartOf("2026-10-26")).toBe("2026-10-26");
    expect(weekStartOf("2026-10-28")).toBe("2026-10-26");
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26"); // Sunday belongs to the week before
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19"); // DST change day
    expect(weekStartOf("2027-01-01")).toBe("2026-12-28"); // across a year end
  });

  it("only offers this week and next week", () => {
    expect(selectableWeeks("2026-10-29")).toEqual(["2026-10-26", "2026-11-02"]);
    expect(isSelectableWeek("2026-11-02", "2026-10-29")).toBe(true);
    expect(isSelectableWeek("2026-11-09", "2026-10-29")).toBe(false);
    expect(isSelectableWeek("2026-10-19", "2026-10-29")).toBe(false);
  });

  it("expires at the end of Sunday, Ireland time, in winter and summer", () => {
    expect(weekExpiry("2026-10-26").toISOString()).toBe("2026-11-01T23:59:59.999Z"); // GMT
    expect(weekExpiry("2026-06-15").toISOString()).toBe("2026-06-21T22:59:59.999Z"); // IST = UTC+1
  });

  it("maps a day token to its date in the week", () => {
    expect(dateOfDay(W, "mon")).toBe("2026-10-26");
    expect(dateOfDay(W, "sun")).toBe("2026-11-01");
  });
});

describe("cleanSlots", () => {
  it("keeps valid tokens in calendar order and drops the rest", () => {
    expect(cleanSlots(["sun:evening", "sat:morning", "bogus", "sat:morning", 4])).toEqual(["sat:morning", "sun:evening"]);
    expect(cleanSlots("sat:afternoon,sun:noon")).toEqual(["sat:afternoon"]);
    expect(cleanSlots(undefined)).toEqual([]);
  });

  it("drops days already over in the chosen week", () => {
    expect(cleanSlots(["mon:morning", "thu:evening", "sat:morning"], W, "2026-10-29")).toEqual(["thu:evening", "sat:morning"]);
  });
});

describe("interest labels", () => {
  it("normalises for matching but keeps the shown label readable", () => {
    expect(normaliseInterest("  Sea   Swimming ")).toBe("sea swimming");
    expect(cleanInterestLabel("  Sea   Swimming ")).toBe("Sea Swimming");
    expect(cleanInterestLabel("x")).toBeNull();
    expect(cleanInterestLabel("a".repeat(61))).toBeNull();
    expect(cleanInterestLabel(42)).toBeNull();
  });
});

describe("aggregatePulse — privacy thresholds", () => {
  it("hides someone else's lone interest entirely", () => {
    expect(aggregatePulse([pulse("a", "Hiking")], "viewer")).toEqual([]);
    expect(aggregatePulse([pulse("a", "Hiking")], null)).toEqual([]);
  });

  it("shows your own lone interest without a count", () => {
    const [g] = aggregatePulse([pulse("me", "Hiking", ["sat:morning"])], "me");
    expect(g).toMatchObject({ interest: "Hiking", count: null, mine: true, topSlot: null, topSlotCount: null });
  });

  it("counts people, not rows, and never returns who", () => {
    const rows = [pulse("a", "Hiking", ["sat:morning"]), pulse("b", "hiking", ["sat:morning", "sun:morning"]), pulse("c", "Hiking ", ["sun:morning"])];
    const [g] = aggregatePulse(rows, "viewer");
    expect(g.count).toBe(3);
    expect(g.interest).toBe("Hiking");
    expect(g.mine).toBe(false);
    expect(g.topSlot).toBe("sat:morning"); // tie with sun:morning → earlier slot wins
    expect(g.topSlotCount).toBe(2);
    expect(JSON.stringify(g)).not.toMatch(/"a"|"b"|"c"/);
  });

  it("keeps different weeks apart", () => {
    const rows = [pulse("a", "Hiking"), pulse("b", "Hiking", [], "2026-11-02")];
    expect(aggregatePulse(rows, "viewer")).toEqual([]);
  });
});

describe("matchFreeTime", () => {
  it("claims nothing below the minimum group", () => {
    expect(matchFreeTime([pulse("a", "Walk", ["sun:afternoon"]), pulse("b", "Walk", ["sun:afternoon"])], [], "a")).toEqual([]);
    expect(matchFreeTime([], [free("a", ["sun:afternoon"]), free("b", ["sun:afternoon"])], "a")).toEqual([]);
  });

  it("combines Pulse slots with shared availability", () => {
    const pulses = [pulse("a", "Walk", ["sun:afternoon"]), pulse("b", "Walk"), pulse("c", "Walk")];
    const availability = [free("b", ["sun:afternoon"]), free("c", ["sun:afternoon", "sat:evening"])];
    const [best] = matchFreeTime(pulses, availability, "c");
    expect(best).toEqual({ weekStart: W, slot: "sun:afternoon", interest: "Walk", interestKey: "walk", count: 3, includesMe: true });
  });

  it("finds plain free-time overlap and ranks interest matches first", () => {
    const availability = [free("a", ["sat:morning"]), free("b", ["sat:morning"]), free("c", ["sat:morning"]), free("d", ["sat:morning"])];
    const pulses = [pulse("a", "Coffee", ["sat:morning"]), pulse("b", "Coffee", ["sat:morning"]), pulse("c", "Coffee")];
    const out = matchFreeTime(pulses, availability, null);
    expect(out[0]).toMatchObject({ interest: "Coffee", slot: "sat:morning", count: 3, includesMe: false });
    expect(out[1]).toMatchObject({ interest: null, slot: "sat:morning", count: 4 });
  });

  it("keeps one best slot per interest and is deterministic", () => {
    const pulses = ["a", "b", "c"].map((id) => pulse(id, "Walk", ["sat:morning", "sun:morning"]));
    const first = matchFreeTime(pulses, [], null);
    expect(first).toHaveLength(1);
    expect(first[0].slot).toBe("sat:morning");
    expect(matchFreeTime([...pulses].reverse(), [], null)).toEqual(first);
  });
});

describe("plan stages", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  it("derives gathering / ready / expired for an idea", () => {
    expect(planStage({ status: "idea", interestCount: 1, targetSize: null, expiresAt: null, now })).toBe("gathering");
    expect(planStage({ status: "idea", interestCount: 3, targetSize: null, expiresAt: null, now })).toBe("ready");
    expect(planStage({ status: "idea", interestCount: 5, targetSize: 6, expiresAt: null, now })).toBe("gathering");
    expect(planStage({ status: "idea", interestCount: 9, targetSize: 6, expiresAt: "2026-10-28T00:00:00Z", now })).toBe("expired");
  });
  it("never overrides a stored decision", () => {
    for (const status of ["confirmed", "activity_created", "cancelled", "completed"]) {
      expect(planStage({ status, interestCount: 0, targetSize: 2, expiresAt: "2020-01-01T00:00:00Z", now })).toBe(status);
    }
  });
  it("expires an undated idea after three weeks and a dated one at the end of its day", () => {
    expect(planIdeaExpiry("", now).toISOString()).toBe("2026-11-19T12:00:00.000Z");
    expect(planIdeaExpiry("2026-11-07", now).toISOString()).toBe("2026-11-07T23:59:59.999Z");
  });
  it("validates the group size", () => {
    expect(cleanTargetSize(undefined)).toBeNull();
    expect(cleanTargetSize("6")).toBe(6);
    expect(cleanTargetSize(1)).toHaveProperty("error");
    expect(cleanTargetSize(2.5)).toHaveProperty("error");
    expect(cleanTargetSize(101)).toHaveProperty("error");
  });
});

describe("freeDays — who's free, totals only", () => {
  const today = "2026-10-28"; // a Wednesday; weeks start Mon 26 Oct and Mon 2 Nov
  const avail = (residentId: string, weekStart: string, slots: string[]) => ({ residentId, weekStart, slots });
  it("runs from today to the end of next week and hides counts below the minimum", () => {
    const days = freeDays([avail("a", "2026-10-26", ["sat:morning"]), avail("b", "2026-10-26", ["sat:evening"])], [], today);
    expect(days).toHaveLength(12);
    expect(days[0]).toMatchObject({ date: "2026-10-28", past: false });
    expect(days[11].date).toBe("2026-11-08");
    expect(days.find((d) => d.date === "2026-10-31")).toMatchObject({ free: null, best: false });
  });
  it("counts distinct people across shared free time and wishes, and picks the best day", () => {
    const pulse = (residentId: string, slots: string[]) => ({ residentId, interest: "Swim", interestKey: "swim", weekStart: "2026-10-26", slots });
    const days = freeDays(
      [avail("a", "2026-10-26", ["sat:morning", "sat:evening"]), avail("b", "2026-10-26", ["sat:morning"])],
      [pulse("a", ["sat:morning"]), pulse("c", ["sat:afternoon"]), pulse("d", ["sun:morning"])],
      today
    );
    const sat = days.find((d) => d.date === "2026-10-31")!;
    expect(sat).toMatchObject({ free: 3, best: true });
    expect(days.find((d) => d.date === "2026-11-01")).toMatchObject({ free: null, best: false });
  });
  it("leaves out days already gone, even with enough people", () => {
    const days = freeDays([avail("a", "2026-10-26", ["mon:morning"]), avail("b", "2026-10-26", ["mon:morning"]), avail("c", "2026-10-26", ["mon:morning"])], [], today);
    expect(days.some((d) => d.date === "2026-10-26")).toBe(false);
    expect(days.every((d) => !d.best)).toBe(true);
  });
});
