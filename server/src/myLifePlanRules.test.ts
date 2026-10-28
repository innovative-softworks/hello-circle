import { describe, expect, it } from "vitest";
import { arrangePlans, irelandDateOf, planPhase, planTiming, type PlanStatus } from "./myLifePlanRules.js";

// Trust & Retention — "Your next plan" ordering, lifecycle phases and Ireland
// day boundaries (pure; no database).

const plan = (status: PlanStatus, date: string, time: string, duration: number | null = 60) => ({ status, date, timing: planTiming(date, time, duration) });

describe("planTiming", () => {
  it("uses Ireland wall-clock time across the DST change", () => {
    // Winter (GMT): 10:00 Dublin = 10:00 UTC. Summer (IST): 10:00 Dublin = 09:00 UTC.
    expect(planTiming("2026-01-15", "10:00", 60).start.toISOString()).toBe("2026-01-15T10:00:00.000Z");
    expect(planTiming("2026-07-15", "10:00", 60).start.toISOString()).toBe("2026-07-15T09:00:00.000Z");
    // The day the clocks go forward (29 Mar 2026): afternoon is already IST.
    expect(planTiming("2026-03-29", "14:00", 30).start.toISOString()).toBe("2026-03-29T13:00:00.000Z");
  });

  it("an unknown duration ends at the end of that Ireland day, and says so", () => {
    const t = planTiming("2026-07-15", "10:00", null);
    expect(t.durationKnown).toBe(false);
    expect(t.end.toISOString()).toBe("2026-07-15T22:59:59.999Z");
  });
});

describe("planPhase", () => {
  const t = planTiming("2026-07-15", "19:00", 90);
  it("before → today → after on Ireland dates, not UTC dates", () => {
    // 23:30 UTC on the 14th is 00:30 on the 15th in Dublin: already "today".
    expect(irelandDateOf(new Date("2026-07-14T23:30:00Z"))).toBe("2026-07-15");
    expect(planPhase("2026-07-15", t, new Date("2026-07-14T22:30:00Z"))).toBe("before");
    expect(planPhase("2026-07-15", t, new Date("2026-07-14T23:30:00Z"))).toBe("today");
    expect(planPhase("2026-07-15", t, new Date("2026-07-15T18:59:00Z"))).toBe("today"); // during the session (started 18:00 UTC)
    expect(planPhase("2026-07-15", t, new Date("2026-07-15T19:30:00Z"))).toBe("after"); // ended 19:30 UTC
  });
});

describe("arrangePlans", () => {
  const now = new Date("2026-07-15T08:00:00Z");
  it("picks the nearest commitment; a waitlist or interest is never the next plan", () => {
    const waitlist = plan("waitlist", "2026-07-15", "10:00");
    const interest = plan("interest", "2026-07-15", "11:00");
    const booked = plan("confirmed", "2026-07-16", "10:00");
    const pending = plan("pending_approval", "2026-07-17", "10:00");
    const { next, upcoming } = arrangePlans([pending, interest, booked, waitlist], now);
    expect(next).toBe(booked);
    expect(upcoming).toEqual([waitlist, interest, pending]);
  });

  it("an RSVP or a payment hold can be the next plan; cancelled stays listed with its status", () => {
    const rsvp = plan("rsvp", "2026-07-15", "12:00");
    const cancelled = plan("cancelled", "2026-07-15", "11:00");
    const { next, upcoming } = arrangePlans([cancelled, rsvp], now);
    expect(next).toBe(rsvp);
    expect(upcoming).toEqual([cancelled]);
  });

  it("a finished visit moves to recent (not lost) and drops out after the window; the next plan isn't displaced", () => {
    const done = plan("confirmed", "2026-07-14", "10:00");
    const old = plan("confirmed", "2026-06-20", "10:00");
    const later = plan("confirmed", "2026-07-20", "10:00");
    const missedRsvp = plan("rsvp", "2026-07-13", "10:00");
    const cancelledPast = plan("cancelled", "2026-07-14", "09:00");
    const { next, recent } = arrangePlans([done, old, later, missedRsvp, cancelledPast], now);
    expect(next).toBe(later);
    expect(recent).toEqual([done, missedRsvp]);
  });

  it("a plan in progress is still the next plan until it ends", () => {
    const now2 = new Date("2026-07-15T09:30:00Z"); // 10:30 Dublin
    const inProgress = plan("confirmed", "2026-07-15", "10:00", 60);
    const { next, recent } = arrangePlans([inProgress], now2);
    expect(next).toBe(inProgress);
    expect(recent).toEqual([]);
  });
});
