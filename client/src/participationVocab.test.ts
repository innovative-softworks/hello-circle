import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_PRESETS,
  describeAvailability,
  presetSelected,
  splitAttributes,
  toggleGoal,
  togglePreset,
  toggleToken,
} from "./participationVocab";

const preset = (label: string) => AVAILABILITY_PRESETS.find((p) => p.label === label)!;

describe("toggleGoal", () => {
  it("caps at three and allows removing", () => {
    const three = ["Meet people", "Get active", "Volunteer"];
    expect(toggleGoal(three, "Learn something")).toEqual(three);
    expect(toggleGoal(three, "Get active")).toEqual(["Meet people", "Volunteer"]);
    expect(toggleGoal(["Meet people"], "Get active")).toEqual(["Meet people", "Get active"]);
  });
});

describe("availability presets and grid", () => {
  it("presets add and remove their tokens, in calendar order", () => {
    const withSat = togglePreset(["sun:morning"], preset("Saturday mornings"));
    expect(withSat).toEqual(["sat:morning", "sun:morning"]);
    expect(presetSelected(withSat, preset("Saturday mornings"))).toBe(true);
    expect(togglePreset(withSat, preset("Saturday mornings"))).toEqual(["sun:morning"]);
  });

  it("a partially covered preset isn't shown as selected, and tapping it fills it in", () => {
    const partial = ["mon:evening", "tue:evening"];
    expect(presetSelected(partial, preset("Weekday evenings"))).toBe(false);
    expect(togglePreset(partial, preset("Weekday evenings"))).toHaveLength(5);
  });

  it("single cells toggle", () => {
    expect(toggleToken([], "wed:afternoon")).toEqual(["wed:afternoon"]);
    expect(toggleToken(["wed:afternoon"], "wed:afternoon")).toEqual([]);
  });
});

describe("describeAvailability", () => {
  it("groups weekdays, whole weekend days and Friday nights", () => {
    const tokens = [
      ...preset("Weekday evenings").tokens,
      "sat:morning", "sat:afternoon", "sat:evening",
      "sun:morning",
    ];
    expect(describeAvailability(tokens)).toEqual(["Weekday evenings", "Saturday", "Sunday mornings"]);
    expect(describeAvailability(["fri:evening"])).toEqual(["Friday nights"]);
    expect(describeAvailability(["tue:morning", "thu:morning"])).toEqual(["Tuesday mornings", "Thursday mornings"]);
    expect(describeAvailability([])).toEqual([]);
  });
});

describe("splitAttributes", () => {
  it("shows at most three, in priority order, ignoring unknown keys", () => {
    expect(splitAttributes(["accessible", "come_alone", "small_group", "first_timers_welcome", "made_up"])).toEqual({
      primary: ["first_timers_welcome", "come_alone", "small_group"],
      rest: ["accessible"],
    });
    expect(splitAttributes(undefined)).toEqual({ primary: [], rest: [] });
  });
});
