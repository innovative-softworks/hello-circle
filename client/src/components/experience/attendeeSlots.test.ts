import { describe, expect, it } from "vitest";
import { fitPeople, missingAnswers, personSlots, toAttendeeInput } from "./attendeeSlots";
import type { RegistrationOption, RegistrationQuestion } from "../../types";

const opt = (id: string, kind: RegistrationOption["kind"], headsPerUnit: number, ageBand: RegistrationOption["ageBand"], label = id): RegistrationOption =>
  ({ id, kind, label, description: "", priceMinor: 100, priceBasis: "per_person", headsPerUnit, ageBand, maxPerOrder: null, onSale: true, saleEndsAt: null }) as RegistrationOption;

const q = (key: string, extra: Partial<RegistrationQuestion> = {}): RegistrationQuestion => ({
  key, scope: "attendee", inputType: "text", label: key, help: "", purpose: "why", required: true, choices: [], min: null, max: null, appliesTo: "all", doorVisible: false, ...extra,
});

describe("attendee slots", () => {
  const options = [opt("family", "option", 2, null, "Family"), opt("child", "option", 1, "child", "Child"), opt("flowers", "addon", 0, null)];
  it("orders people by option, one per head, and skips add-ons", () => {
    expect(personSlots(options, { child: 1, family: 1, flowers: 1 }, 0)).toEqual([
      { lineLabel: "Family", fixedType: null },
      { lineLabel: "Family", fixedType: null },
      { lineLabel: "Child", fixedType: "child" },
    ]);
    expect(personSlots(null, {}, 2)).toHaveLength(2);
  });
  it("keeps typed names when the party changes and prefills the booker as person 1", () => {
    const slots = personSlots(options, { family: 1, child: 1 }, 0);
    const first = fitPeople([], slots, "Asha");
    expect(first.map((p) => [p.name, p.personType, p.guardian])).toEqual([["Asha", "adult", ""], ["", "adult", ""], ["", "child", ""]]);
    const more = fitPeople([{ ...first[0] }, { name: "Ravi", personType: "adult", guardian: "" }], slots, "Asha");
    expect(more[1].name).toBe("Ravi");
    expect(toAttendeeInput([{ name: " Mira ", personType: "child", guardian: 1 }])).toEqual([{ name: "Mira", personType: "child", guardian: 1 }]);
  });
  it("lists missing required answers only for the people they apply to", () => {
    const people = [{ name: "A", personType: "adult" as const, guardian: "" as const }, { name: "C", personType: "child" as const, guardian: 1 as const }];
    const qs = [q("age", { appliesTo: "child" }), q("heard", { scope: "booking" }), q("tshirt", { required: false })];
    expect(missingAnswers(qs, people, { booking: {}, attendees: [{}, {}] }).map((m) => m.message)).toEqual(['C: answer "age"', 'Answer "heard"']);
    expect(missingAnswers(qs, people, { booking: { heard: "x" }, attendees: [{}, { age: 7 }] })).toEqual([]);
  });
});

