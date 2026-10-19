import { describe, expect, it } from "vitest";
import { RULE_KEYS } from "./catalog.js";

// Validation 2026-10-14 — the admin Commercial rules screen must say where
// each rule actually takes effect. Most checkouts still use fixed pricing in
// code, and three published keys aren't read by any code yet; an admin must
// never be told an edit there changes behaviour.
describe("commerce rule catalogue: where each rule applies", () => {
  it("every rule key states where it takes effect", () => {
    for (const spec of Object.values(RULE_KEYS)) {
      expect(spec.appliesTo, spec.key).toBeTruthy();
      expect(spec.appliesTo.length, spec.key).toBeGreaterThan(20);
    }
  });

  it("keys no code reads are labelled as not applied", () => {
    for (const key of ["checkout", "cancellation", "plan_rules"]) {
      expect(RULE_KEYS[key].appliesTo, key).toMatch(/^Not applied yet/);
    }
  });

  it("pricing says it only reaches engine-priced experience checkout", () => {
    expect(RULE_KEYS.pricing.appliesTo).toMatch(/Experience checkout only/);
    expect(RULE_KEYS.pricing.appliesTo).toMatch(/23% VAT/);
  });
});
