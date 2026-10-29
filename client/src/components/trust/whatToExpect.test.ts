import { describe, expect, it } from "vitest";
import { centreExpectFacts, clubExpectFacts, experienceExpectFacts, gameExpectFacts, programExpectFacts, type Fact } from "./WhatToExpect";
import type { Centre, Club, Experience, Game, Program } from "../../types";

// Trust & Retention — missing fields stay "not provided", irrelevant ones are
// "not applicable", and suitability only comes from what the organiser ticked.

const find = (facts: Fact[], label: string) => facts.find((f) => f.label === label)!;
const shown = (f: Fact) => f.value || (f.na ? "Not applicable" : f.missing || "Not provided by the host");

const game = {
  hostName: "Aoife",
  date: "2026-11-07",
  time: "10:00",
  centreName: null,
  locationText: "",
  area: "",
  skillLevel: "",
  minAge: null,
  soloFriendly: 0,
  durationMinutes: null,
  equipmentNeeded: "",
  accessibilityInfo: null,
  experienceRequired: null,
  meetingInstructions: null,
  priceCents: null,
  cancellationPolicy: "",
  participationAttributes: [],
  newcomerWelcome: null,
} as unknown as Game;

describe("gameExpectFacts", () => {
  it("leaves every unset field unclaimed, including an unset price", () => {
    const f = gameExpectFacts(game);
    for (const label of ["Where to meet", "Level", "Age", "Beginners", "First time here", "Coming on your own", "Who welcomes newcomers", "What to bring", "Accessibility", "Price"]) {
      expect(find(f, label).value, label).toBeFalsy();
    }
    expect(find(f, "When").value).toMatch(/length not given/);
    expect(find(f, "Price").value).toBeFalsy();
    expect(find(gameExpectFacts({ ...game, priceCents: 0 } as Game), "Price").value).toBe("Free");
  });

  it("uses ticked attributes and the newcomer line, and never invents details", () => {
    const g = { ...game, participationAttributes: ["beginner_friendly", "come_alone", "accessible", "host_introduces"] } as unknown as Game;
    const f = gameExpectFacts(g);
    expect(find(f, "Beginners").value).toMatch(/^Yes/);
    expect(find(f, "Coming on your own").value).toMatch(/on their own/);
    expect(find(f, "Accessibility").value).toMatch(/gave no details/);
    expect(find(f, "Who welcomes newcomers").value).toMatch(/no name given/);
    expect(find(gameExpectFacts({ ...g, newcomerWelcome: "Aoife at the gate" } as Game), "Who welcomes newcomers").value).toBe("Aoife at the gate");
    expect(find(gameExpectFacts({ ...game, skillLevel: "Advanced" } as Game), "Beginners").value).toBe("The level is “Advanced”");
  });

  it("shows a per-place price and says the total comes at checkout", () => {
    expect(find(gameExpectFacts({ ...game, priceCents: 1250 } as Game), "Price").value).toMatch(/€12\.50 per place.*before you pay/);
  });
});

describe("other listing types", () => {
  it("experiences: volunteer price and skills are not applicable vs not provided", () => {
    const base = { kind: "experience", vendorName: "Sea Co", priceCents: 4000, participationAttributes: [], equipment: [] } as unknown as Experience;
    expect(shown(find(experienceExpectFacts(base), "Skills needed"))).toBe("Not applicable");
    expect(shown(find(experienceExpectFacts(base), "Getting there"))).toBe("Not provided by the organiser");
    const vol = { ...base, kind: "volunteer" } as Experience;
    expect(shown(find(experienceExpectFacts(vol), "Price"))).toBe("Not applicable");
    expect(shown(find(experienceExpectFacts(vol), "Skills needed"))).toBe("Not provided by the organiser");
  });

  it("programmes: arrival instructions and newcomer line come from the organiser", () => {
    const p = { vendorName: "Hub", instructorName: "Ciara", equipment: [], priceCents: 0, arrivalInstructions: "Front desk", newcomerWelcome: "Ciara at reception", participationAttributes: [] } as unknown as Program;
    const f = programExpectFacts(p);
    expect(find(f, "On arrival").value).toBe("Front desk");
    expect(find(f, "Who welcomes newcomers").value).toBe("Ciara at reception");
    expect(find(f, "Who runs it").value).toBe("Hub · instructor Ciara");
  });

  it("venues: beginner/solo questions don't apply; empty accessibility is not provided", () => {
    const c = { managedBy: "", opensAt: "09:00", closesAt: "21:00", amenities: [], accessibility: [], newcomerWelcome: null } as unknown as Centre;
    const f = centreExpectFacts(c);
    expect(shown(find(f, "Beginners / coming on your own"))).toBe("Not applicable");
    expect(shown(find(f, "Accessibility"))).toBe("Not provided by the venue");
  });

  it("clubs: an unticked trial or attribute isn't a 'no'", () => {
    const c = { audience: "kids", ages: "8-12", trial: false, includes: [], accessibility: [], price: 0, unit: "year", participationAttributes: [] } as unknown as Club;
    const f = clubExpectFacts(c);
    expect(shown(find(f, "Trial"))).toBe("Not provided by the club");
    expect(find(f, "Who it's for").value).toBe("Children · ages 8-12");
  });
});
