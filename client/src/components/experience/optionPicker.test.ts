import { describe, expect, it } from "vitest";
import { headsOf, selectedLines } from "./OptionPicker";
import type { RegistrationOption } from "../../types";

// Participation Phase 1 — the booking box only collects quantities; the head
// count shown before the quote arrives must match the server's rule
// (options count headsPerUnit per unit, add-ons count no one).

const opt = (id: string, kind: RegistrationOption["kind"], headsPerUnit: number): RegistrationOption => ({
  id, kind, label: id, description: "", priceMinor: 1000, priceBasis: kind === "addon" ? "per_booking" : headsPerUnit > 1 ? "per_booking" : "per_person",
  headsPerUnit, ageBand: null, maxPerOrder: null, onSale: true, saleEndsAt: null,
});

describe("option picker helpers", () => {
  const options = [opt("pooja", "option", 5), opt("darshan", "option", 1), opt("flowers", "addon", 0)];
  it("counts people the way the server does", () => {
    expect(headsOf(options, { pooja: 1, darshan: 2, flowers: 1 })).toBe(7);
    expect(headsOf(options, { flowers: 3 })).toBe(0);
    expect(headsOf(options, {})).toBe(0);
  });
  it("sends only chosen options, never prices", () => {
    expect(selectedLines({ pooja: 1, darshan: 0, flowers: 2 })).toEqual([{ optionId: "pooja", quantity: 1 }, { optionId: "flowers", quantity: 2 }]);
  });
});
