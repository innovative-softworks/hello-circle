import { describe, expect, it } from "vitest";
import type { ScheduledActivity } from "./db/queries.js";
import { BUFFER_MINUTES, fromMinutes, planDay, toMinutes, travelEstimate } from "./dayPlanner.js";

const HOWTH = { lat: 53.3786, lng: -6.0583 };
const SUTTON = { lat: 53.3907, lng: -6.1118 }; // ~4 km from Howth
const CORK = { lat: 51.8985, lng: -8.4756 };

const mk = (id: string, time: string, durationMinutes: number, place: { lat: number; lng: number } | null, over: Partial<ScheduledActivity> = {}): ScheduledActivity => ({
  kind: "game", id, title: id, date: "2026-10-31", time, centreName: null, clubName: null, area: null, county: "Dublin", priceCents: 0, href: `/games/${id}`,
  spotsLeft: 5, joined: 1, imageUrl: null, isLive: false, durationMinutes, durationKnown: true,
  lat: place?.lat ?? null, lng: place?.lng ?? null, locationSource: place ? "confirmed" : null, listingType: "game", listingId: id, ...over,
});
const flat = () => 1;
const day = { startTime: "09:00", endTime: "18:00", maxPriceCents: null, origin: null };

describe("time helpers", () => {
  it("round-trips HH:MM", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(fromMinutes(570)).toBe("09:30");
  });
});

describe("travelEstimate", () => {
  it("is a rough straight-line estimate plus buffer, only for confirmed places", () => {
    const t = travelEstimate(HOWTH, mk("x", "10:00", 60, SUTTON))!;
    expect(t).toBeGreaterThan(BUFFER_MINUTES);
    expect(t).toBeLessThan(45);
    expect(travelEstimate(HOWTH, mk("y", "10:00", 60, null))).toBeNull();
    expect(travelEstimate(null, mk("z", "10:00", 60, SUTTON))).toBeNull();
  });
});

describe("planDay", () => {
  it("chains real stops with room to travel between them", () => {
    const plan = planDay([mk("walk", "10:00", 90, HOWTH), mk("swim", "12:00", 60, SUTTON), mk("tight", "11:35", 60, SUTTON)], day, flat);
    expect(plan.stops.map((s) => s.item.id)).toEqual(["walk", "swim"]);
    expect(plan.stops[1].travelMinutes).toBeGreaterThan(0);
    expect(plan.stops[0]).toMatchObject({ start: "10:00", end: "11:30" });
  });
  it("won't chain a far-away stop it can't reach in time", () => {
    const plan = planDay([mk("walk", "10:00", 90, HOWTH), mk("cork", "12:00", 60, CORK)], day, flat);
    expect(plan.stops).toHaveLength(1);
  });
  it("leaves out unknown lengths, full listings and anything outside the window", () => {
    const plan = planDay(
      [mk("unknown", "10:00", 120, HOWTH, { durationKnown: false }), mk("full", "10:00", 60, HOWTH, { spotsLeft: 0 }), mk("late", "17:30", 60, HOWTH), mk("ok", "13:00", 60, HOWTH)],
      day,
      flat
    );
    expect(plan.stops.map((s) => s.item.id)).toEqual(["ok"]);
  });
  it("never chains after a stop without a confirmed place", () => {
    const plan = planDay([mk("nowhere", "10:00", 60, null), mk("later", "14:00", 60, HOWTH)], day, flat);
    expect(plan.stops).toHaveLength(1);
  });
  it("respects the day's budget and never repeats a listing", () => {
    const plan = planDay(
      [mk("a", "09:00", 60, HOWTH, { priceCents: 1500 }), mk("b", "11:00", 60, HOWTH, { priceCents: 1500 }), mk("c", "13:00", 60, HOWTH, { priceCents: 0 }), mk("a2", "15:00", 60, HOWTH, { listingId: "a" })],
      { ...day, maxPriceCents: 2000 },
      flat
    );
    expect(plan.totalPriceCents).toBeLessThanOrEqual(2000);
    const ids = plan.stops.map((s) => s.item.listingId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.stops).toHaveLength(2);
  });
  it("needs time to reach the first stop from a start point", () => {
    const plan = planDay([mk("early", "09:05", 60, SUTTON), mk("later", "10:30", 60, SUTTON)], { ...day, origin: HOWTH }, flat);
    expect(plan.stops[0].item.id).toBe("later");
    expect(plan.stops[0].travelMinutes).not.toBeNull();
  });
  it("is deterministic", () => {
    const items = [mk("a", "10:00", 60, HOWTH), mk("b", "10:00", 60, HOWTH), mk("c", "12:00", 60, HOWTH)];
    expect(planDay(items, day, flat)).toEqual(planDay([...items].reverse(), day, flat));
  });
});
