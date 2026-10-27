import { describe, expect, it } from "vitest";
import type { ScheduledActivity } from "./db/queries.js";
import { buildCollections, datesFor, formatMinutes, matchListings, partOfDay, pickSurprise } from "./discoveryMatch.js";

const base: ScheduledActivity = {
  kind: "game",
  id: "g1",
  title: "Walk",
  date: "2026-10-31",
  time: "10:00",
  centreName: null,
  clubName: null,
  area: null,
  county: "Dublin",
  priceCents: 0,
  href: "/games/g1",
  spotsLeft: 4,
  joined: 1,
  imageUrl: null,
  isLive: false,
  durationMinutes: 90,
  durationKnown: true,
  lat: null,
  lng: null,
  locationSource: null,
  listingType: "game",
  listingId: "g1",
};
const a = (over: Partial<ScheduledActivity>): ScheduledActivity => ({ ...base, ...over, listingId: over.id ?? base.id });
const noAttrs = () => [] as string[];

describe("dates and parts of day", () => {
  it("maps today / tomorrow / weekend / a date from Ireland's today", () => {
    expect(datesFor("today", "2026-10-29")).toEqual(["2026-10-29"]);
    expect(datesFor("tomorrow", "2026-10-31")).toEqual(["2026-11-01"]);
    expect(datesFor("weekend", "2026-10-29")).toEqual(["2026-10-31", "2026-11-01"]); // Thursday
    expect(datesFor("weekend", "2026-10-31")).toEqual(["2026-10-31", "2026-11-01"]); // Saturday
    expect(datesFor("weekend", "2026-11-01")).toEqual(["2026-11-01"]); // Sunday
    expect(datesFor("2026-11-05", "2026-10-29")).toEqual(["2026-11-05"]);
    expect(datesFor("2026-10-01", "2026-10-29")).toBeNull();
    expect(datesFor("whenever", "2026-10-29")).toBeNull();
  });
  it("uses the same morning/afternoon/evening boundaries as Free Time Match", () => {
    expect(partOfDay("11:59")).toBe("morning");
    expect(partOfDay("12:00")).toBe("afternoon");
    expect(partOfDay("17:00")).toBe("evening");
  });
  it("formats lengths", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hour");
    expect(formatMinutes(150)).toBe("2.5 hours");
  });
});

describe("matchListings", () => {
  const items = [
    a({ id: "sat-am", date: "2026-10-31", time: "10:00", priceCents: 0 }),
    a({ id: "sat-pm", date: "2026-10-31", time: "14:00", priceCents: 2500 }),
    a({ id: "sun-eve", date: "2026-11-01", time: "19:00", priceCents: 1500 }),
    a({ id: "no-length", date: "2026-10-31", time: "10:30", durationKnown: false, durationMinutes: 120 }),
  ];
  it("filters by day and part of day and says so", () => {
    const out = matchListings(items, { dates: ["2026-10-31"], partsOfDay: ["morning"] }, noAttrs);
    expect(out.map((o) => o.item.id)).toEqual(["sat-am", "no-length"]);
    expect(out[0].reasons).toContain("On Saturday morning");
  });
  it("never claims an unknown length fits a time window", () => {
    const out = matchListings(items, { maxMinutes: 120 }, noAttrs);
    expect(out.map((o) => o.item.id)).not.toContain("no-length");
    expect(out[0].reasons).toContain("Takes about 1.5 hours");
  });
  it("keeps to the budget and calls free things free", () => {
    const out = matchListings(items, { maxPriceCents: 2000 }, noAttrs);
    expect(out.map((o) => o.item.id)).toEqual(["sat-am", "sun-eve", "no-length"]);
    expect(out[0].reasons).toContain("Free");
    expect(out[1].reasons).toContain("Within your €20 budget");
  });
  it("going solo only keeps listings whose host said so", () => {
    const attrs = (i: ScheduledActivity) => (i.id === "sat-pm" ? ["come_alone"] : i.id === "sun-eve" ? ["first_timers_welcome"] : i.id === "sat-am" ? ["small_group"] : []);
    const out = matchListings(items, { solo: true }, attrs);
    expect(out.map((o) => o.item.id)).toEqual(["sat-pm", "sun-eve"]);
    expect(out[0].reasons).toContain("Host says people often come on their own");
  });
});

describe("pickSurprise", () => {
  const ranked = ["a", "b", "c", "d"].map((id) => ({ id }));
  it("never repeats one already shown and is bounded to the best pool", () => {
    expect(pickSurprise(ranked, new Set(["a", "b"]), () => 0)?.id).toBe("c");
    expect(pickSurprise(ranked, new Set(), () => 0.99, 2)?.id).toBe("b");
    expect(pickSurprise(ranked, new Set(["a", "b", "c", "d"]))).toBeNull();
  });
});

describe("buildCollections", () => {
  it("builds only from stated facts and drops empty collections", () => {
    const items = [
      a({ id: "free", priceCents: 0, date: "2026-11-05" }),
      a({ id: "cheap", priceCents: 1800, date: "2026-10-31" }),
      a({ id: "dear", priceCents: 5000, date: "2026-11-05", kind: "experience_session", experienceKind: "adventure" }),
    ];
    const attrs = (i: ScheduledActivity) => (i.id === "cheap" ? ["beginner_friendly"] : []);
    const out = buildCollections(items, attrs, "2026-10-29");
    const keys = Object.fromEntries(out.map((c) => [c.key, c.items.map((i) => i.id)]));
    expect(keys).toEqual({ this_weekend: ["cheap"], free: ["free"], under_20: ["cheap"], beginner: ["cheap"], outdoors: ["dear"] });
    expect(keys).not.toHaveProperty("family_day");
  });
});
