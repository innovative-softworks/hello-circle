import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, addMonths, daysBetween, irelandDateKey, irelandDaysFromToday, irelandMonthStart, irelandToday, occurrenceDates, weekdayOf } from "./irelandDate";

// HC-QA-077 / HC-QA-100 — "today" is the Ireland date and calendar
// arithmetic never depends on the device's timezone.

afterEach(() => { vi.useRealTimers(); });
const at = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };

describe("irelandToday", () => {
  it("winter (GMT, UTC+0): the Ireland date equals the UTC date either side of midnight", () => {
    at("2027-01-14T23:59:59Z"); expect(irelandToday()).toBe("2027-01-14");
    at("2027-01-15T00:00:00Z"); expect(irelandToday()).toBe("2027-01-15");
  });

  it("summer (IST, UTC+1): the Ireland day starts at 23:00 UTC the evening before", () => {
    at("2027-07-14T22:59:59Z"); expect(irelandToday()).toBe("2027-07-14");
    at("2027-07-14T23:00:00Z"); expect(irelandToday()).toBe("2027-07-15");
    at("2027-07-14T23:30:00Z"); expect(irelandToday()).toBe("2027-07-15"); // 00:30 IST — UTC still says the 14th
  });

  it("follows the DST changeovers (last Sunday of March / October)", () => {
    expect(irelandDateKey(new Date("2027-03-27T23:30:00Z"))).toBe("2027-03-27"); // still GMT
    expect(irelandDateKey(new Date("2027-03-28T23:30:00Z"))).toBe("2027-03-29"); // IST from 01:00 UTC on the 28th
    expect(irelandDateKey(new Date("2027-10-30T23:30:00Z"))).toBe("2027-10-31"); // IST until 01:00 UTC on the 31st
    expect(irelandDateKey(new Date("2027-10-31T23:30:00Z"))).toBe("2027-10-31"); // GMT again
  });

  it("relative helpers build on the Ireland date", () => {
    at("2027-07-31T23:30:00Z"); // 00:30 IST on 1 August
    expect(irelandDaysFromToday(0)).toBe("2027-08-01");
    expect(irelandDaysFromToday(7)).toBe("2027-08-08");
    expect(irelandMonthStart()).toBe("2027-08-01");
  });
});

describe("calendar arithmetic", () => {
  it("addDays crosses month, year and DST boundaries by whole calendar days", () => {
    expect(addDays("2027-01-31", 1)).toBe("2027-02-01");
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(addDays("2027-03-27", 1)).toBe("2027-03-28");
    expect(addDays("2027-10-30", 1)).toBe("2027-10-31");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("addMonths keeps JS Date's overflow rule; weekdayOf and daysBetween are calendar-only", () => {
    expect(addMonths("2027-01-15", 1)).toBe("2027-02-15");
    expect(addMonths("2027-01-31", 1)).toBe("2027-03-03");
    expect(weekdayOf("2027-07-15")).toBe(4); // Thursday
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
    expect(daysBetween("2027-07-15", "2027-07-14")).toBe(-1);
  });

  it("occurrenceDates: the picked date is always first, and repeats keep the weekday (HC-QA-100)", () => {
    expect(occurrenceDates("2027-07-15", "none", 5)).toEqual(["2027-07-15"]);
    expect(occurrenceDates("2027-08-05", "weekly", 3)).toEqual(["2027-08-05", "2027-08-12", "2027-08-19"]);
    expect(occurrenceDates("2027-03-18", "biweekly", 3)).toEqual(["2027-03-18", "2027-04-01", "2027-04-15"]); // across the March DST change
    expect(occurrenceDates("2027-01-15", "monthly", 3)).toEqual(["2027-01-15", "2027-02-15", "2027-03-15"]);
    for (const d of occurrenceDates("2027-08-05", "weekly", 10)) expect(weekdayOf(d)).toBe(4);
  });
});
