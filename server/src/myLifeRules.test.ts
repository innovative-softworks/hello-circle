import { describe, expect, it } from "vitest";
import { dayOfWeekOf, routineMatches, sameActivity, unseen, validDismissKey } from "./myLifeRules.js";

describe("My Life rules", () => {
  it("numbers weekdays the routines way (1 = Sunday)", () => {
    expect(dayOfWeekOf("2026-10-25")).toBe(1); // Sunday
    expect(dayOfWeekOf("2026-10-30")).toBe(6); // Friday
  });

  it("matches activities in either direction, ignoring tiny labels", () => {
    expect(sameActivity("Badminton", "Badminton Doubles")).toBe(true);
    expect(sameActivity("Saturday Parkrun", "parkrun")).toBe(true);
    expect(sameActivity("Yo", "Yoga in the Park")).toBe(false);
    expect(sameActivity("Chess", "Five-a-side Football")).toBe(false);
  });

  it("finds same-weekday sessions near the routine's time", () => {
    const sessions = [
      { id: "a", title: "Badminton Doubles", date: "2026-10-30", time: "19:00", href: "/games/a" },
      { id: "b", title: "Badminton Doubles", date: "2026-10-30", time: "09:00", href: "/games/b" }, // too far from 19:00
      { id: "c", title: "Badminton Doubles", date: "2026-10-31", time: "19:00", href: "/games/c" }, // Saturday
      { id: "d", title: "Badminton Doubles", date: "2026-11-06", time: "18:30", href: "/games/d" },
    ];
    const got = routineMatches({ id: "r", activityLabel: "Badminton", dayOfWeek: 6, time: "19:00" }, sessions, "2026-10-26", "2026-11-08");
    expect(got.map((s) => s.id)).toEqual(["a", "d"]);
  });

  it("ignores time when the routine has none, and respects the window", () => {
    const sessions = [
      { id: "a", title: "Sea swim", date: "2026-11-01", time: "07:00", href: "/x" },
      { id: "b", title: "Sea swim", date: "2026-11-29", time: "07:00", href: "/y" },
    ];
    expect(routineMatches({ id: "r", activityLabel: "sea swim", dayOfWeek: 1, time: "" }, sessions, "2026-10-26", "2026-11-08").map((s) => s.id)).toEqual(["a"]);
  });

  it("accepts plain dismissal keys only", () => {
    expect(validDismissKey("pulse:follow:game:abc-123")).toBe(true);
    expect(validDismissKey("x".repeat(181))).toBe(false);
    expect(validDismissKey("drop table;")).toBe(false);
    expect(validDismissKey(42)).toBe(false);
  });

  it("returns only alert keys not seen before", () => {
    expect(unseen(["a", "b", "b", "c"], new Set(["a"]))).toEqual(["b", "c"]);
  });
});
