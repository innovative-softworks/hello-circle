import { describe, expect, it } from "vitest";
import { matchesWhen, priceState } from "./exploreFilters";

// 2026-10-28 is a Wednesday.
const today = "2026-10-28";
const at = (date: string, time = "10:00") => ({ date, time });

describe("matchesWhen", () => {
  it("today and tonight", () => {
    expect(matchesWhen(at(today), "today", today)).toBe(true);
    expect(matchesWhen(at("2026-10-29"), "today", today)).toBe(false);
    expect(matchesWhen(at(today, "16:59"), "tonight", today)).toBe(false);
    expect(matchesWhen(at(today, "19:30"), "tonight", today)).toBe(true);
  });
  it("tomorrow crosses a month end", () => {
    expect(matchesWhen(at("2026-10-29"), "tomorrow", today)).toBe(true);
    expect(matchesWhen(at("2026-11-01"), "tomorrow", "2026-10-31")).toBe(true);
    expect(matchesWhen(at(today), "tomorrow", today)).toBe(false);
  });
  it("this weekend is the coming Saturday and Sunday only", () => {
    expect(matchesWhen(at("2026-10-31"), "weekend", today)).toBe(true);
    expect(matchesWhen(at("2026-11-01"), "weekend", today)).toBe(true);
    expect(matchesWhen(at("2026-10-30"), "weekend", today)).toBe(false);
    expect(matchesWhen(at("2026-11-07"), "weekend", today)).toBe(false);
  });
  it("this week is today plus six days", () => {
    expect(matchesWhen(at("2026-11-03"), "week", today)).toBe(true);
    expect(matchesWhen(at("2026-11-04"), "week", today)).toBe(false);
    expect(matchesWhen(at("2026-10-27"), "week", today)).toBe(false);
  });
  it("anytime and unknown values match everything", () => {
    expect(matchesWhen(at("2027-01-01"), "", today)).toBe(true);
    expect(matchesWhen(at("2027-01-01"), "someday", today)).toBe(true);
  });
});

describe("priceState", () => {
  it("a set price is paid", () => expect(priceState({ kind: "club_session", priceCents: 1200 })).toBe("paid"));
  it("a game with no price is unknown, not free", () => expect(priceState({ kind: "game", priceCents: null })).toBe("unknown"));
  it("an undefined price is unknown", () => expect(priceState({ priceCents: undefined })).toBe("unknown"));
  it("a stated 0 is free", () => expect(priceState({ kind: "program_session", priceCents: 0 })).toBe("free"));
  it("a club session with no price is unknown", () => expect(priceState({ kind: "club_session", priceCents: null })).toBe("unknown"));
});
