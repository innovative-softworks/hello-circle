import { describe, expect, it } from "vitest";
import { splitDemandQuery } from "./demandQuery";
import { fitLabel } from "./recommendationFit";

describe("splitDemandQuery", () => {
  it("pulls the day and time out so demand clusters on the activity", () => {
    expect(splitDemandQuery("badminton sunday morning")).toEqual({ activityLabel: "Badminton", timeWindow: "Sunday morning", days: ["sun"], time: "morning" });
    expect(splitDemandQuery("Sunday badminton")).toMatchObject({ activityLabel: "Badminton", timeWindow: "Sunday" });
    expect(splitDemandQuery("badminton")).toMatchObject({ activityLabel: "Badminton", timeWindow: "" });
  });

  it("uses the parser's time of day when the words were already stripped", () => {
    expect(splitDemandQuery("yoga", "evening")).toMatchObject({ activityLabel: "Yoga", timeWindow: "evening" });
    expect(splitDemandQuery("yoga saturday", "morning")).toMatchObject({ activityLabel: "Yoga", timeWindow: "Saturday morning" });
  });

  it("trims dangling connectors from the ends only", () => {
    expect(splitDemandQuery("yoga on sundays")).toMatchObject({ activityLabel: "Yoga", timeWindow: "Sunday" });
    expect(splitDemandQuery("walk in the park at the weekend").activityLabel).toBe("Walk in the park");
  });

  it("joins several days and leaves nothing when only timing was typed", () => {
    expect(splitDemandQuery("tennis saturday sunday")).toMatchObject({ activityLabel: "Tennis", timeWindow: "Saturday or Sunday" });
    expect(splitDemandQuery("this weekend")).toMatchObject({ activityLabel: "", timeWindow: "Weekend" });
    expect(splitDemandQuery("today")).toMatchObject({ activityLabel: "", timeWindow: "" });
    expect(splitDemandQuery("swimming tomorrow evening")).toMatchObject({ activityLabel: "Swimming", timeWindow: "evening" });
  });
});

describe("fitLabel", () => {
  it("never labels a result with no real reason", () => {
    expect(fitLabel(undefined)).toBeNull();
    expect(fitLabel([])).toBeNull();
  });
  it("scales with the number of reasons", () => {
    expect(fitLabel(["Matches your interest in Yoga"])).toBe("Good fit");
    expect(fitLabel(["Matches your interest in Yoga", "In your home county"])).toBe("Great fit");
  });
});

describe("icebreakers", async () => {
  const { ICEBREAKERS, initialIcebreakerIndex, nextIcebreakerIndex } = await import("./icebreakers");
  it("is stable per game and never repeats the current prompt", () => {
    expect(initialIcebreakerIndex("game-1")).toBe(initialIcebreakerIndex("game-1"));
    for (const r of [0, 0.5, 0.999]) {
      const next = nextIcebreakerIndex(3, () => r);
      expect(next).not.toBe(3);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(ICEBREAKERS.length);
    }
  });
});
