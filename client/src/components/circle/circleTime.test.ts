import { describe, expect, it } from "vitest";
import { dateInWeek, orderSlots, people, remainingDays, slotLabel, weekName, weekRange } from "./circleTime";

describe("circleTime", () => {
  const weeks = ["2026-10-26", "2026-11-02"];
  it("names and ranges weeks from the server's pair", () => {
    expect(weekName("2026-10-26", weeks)).toBe("This week");
    expect(weekName("2026-11-02", weeks)).toBe("Next week");
    expect(weekRange("2026-10-26")).toBe("26 Oct – 1 Nov");
    expect(weekRange("2026-12-28")).toBe("28 Dec – 3 Jan");
  });
  it("labels slots and finds dates inside a week", () => {
    expect(slotLabel("sun:afternoon")).toBe("Sunday afternoon");
    expect(slotLabel("nope")).toBe("nope");
    expect(dateInWeek("2026-10-26", "sat")).toBe("2026-10-31");
  });
  it("only offers days that haven't ended", () => {
    expect(remainingDays("2026-10-26", "2026-10-29")).toEqual(["thu", "fri", "sat", "sun"]);
    expect(remainingDays("2026-10-26", "2026-11-02")).toEqual([]);
  });
  it("keeps tokens in calendar order and pluralises", () => {
    expect(orderSlots(["sun:morning", "mon:evening", "sat:morning", "mon:morning"])).toEqual(["mon:morning", "mon:evening", "sat:morning", "sun:morning"]);
    expect(people(1)).toBe("1 member");
    expect(people(4)).toBe("4 members");
  });
});
