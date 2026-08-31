import { describe, expect, it } from "vitest";
import { euro } from "./euro";

describe("euro", () => {
  it("shows whole-euro amounts with no decimals", () => {
    expect(euro(50)).toBe("€50");
    expect(euro(0)).toBe("€0");
  });

  it("shows cents for non-whole-euro amounts", () => {
    // Regression case: euro() used to Math.round() away the cents entirely,
    // so a VAT/platform-fee-inclusive total (almost never a whole euro)
    // displayed a figure that didn't match what Stripe actually charged.
    expect(euro(18.4)).toBe("€18.40");
    expect(euro(12.05)).toBe("€12.05");
  });
});
