import { describe, expect, it } from "vitest";
import { describeWhen, experienceHref, gameHref, programHref, suggestedDate, suggestedTime } from "./opportunityPrefill";
import type { HostOpportunity } from "./types";

const opp: HostOpportunity = {
  clusterKey: "badminton",
  label: "Badminton",
  category: "Badminton",
  county: "Galway",
  interested: "30+",
  preferredDays: ["sun"],
  preferredTime: "morning",
  budget: { minCents: 800, maxCents: 1500 },
  radiusKm: 8,
};

describe("create-from-demand prefill", () => {
  // 2026-09-27 is a Sunday — the suggestion must be the *next* Sunday, never today.
  const today = new Date("2026-09-27T09:00:00Z");

  it("suggests the next matching day and a sensible time", () => {
    expect(suggestedDate(opp, today)).toBe("2026-10-04");
    expect(suggestedTime(opp)).toBe("10:00");
    expect(suggestedDate({ preferredDays: [] }, today)).toBe("");
    expect(describeWhen(opp)).toBe("Sunday mornings");
  });

  it("builds each editor's prefill link, carrying the cluster for analytics", () => {
    expect(gameHref(opp, today)).toBe("/games/host?activity=Badminton&fromDemand=badminton&date=2026-10-04&time=10%3A00");
    expect(programHref(opp)).toBe("/vendor/programs/new?title=Badminton&fromDemand=badminton&category=Badminton");
    expect(experienceHref(opp)).toBe("/vendor/experiences/new?title=Badminton&county=Galway&fromDemand=badminton");
  });
});
