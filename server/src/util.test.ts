import { describe, expect, it } from "vitest";
import { invalidCoordinateReason } from "./util.js";

// Pure-function unit tests for the server-side coordinate validation added
// in the Maps cost-control follow-up pass — every vendor centre/club/
// experience create/update route runs client-supplied lat/lng through this
// before it ever reaches a query (client-side validation alone isn't
// trustworthy, per that pass's audit finding that no such check existed
// anywhere before this).

describe("invalidCoordinateReason", () => {
  it("accepts both omitted (not touching the location)", () => {
    expect(invalidCoordinateReason(undefined, undefined)).toBeNull();
  });

  it("accepts both null (explicitly clearing the location)", () => {
    expect(invalidCoordinateReason(null, null)).toBeNull();
  });

  it("accepts a valid Ireland-ish pair", () => {
    expect(invalidCoordinateReason(53.35, -6.26)).toBeNull();
  });

  it("accepts (0, 0) — a legal coordinate, not a missing-value sentinel", () => {
    expect(invalidCoordinateReason(0, 0)).toBeNull();
  });

  it("rejects lat out of range", () => {
    expect(invalidCoordinateReason(999, -6.26)).toMatch(/lat must be between -90 and 90/);
    expect(invalidCoordinateReason(-91, -6.26)).toMatch(/lat/);
  });

  it("rejects lng out of range", () => {
    expect(invalidCoordinateReason(53.35, 181)).toMatch(/lng must be between -180 and 180/);
    expect(invalidCoordinateReason(53.35, -181)).toMatch(/lng/);
  });

  it("rejects a lone lat with no lng", () => {
    expect(invalidCoordinateReason(53.35, undefined)).toMatch(/must both be numbers/);
  });

  it("rejects a lone lng with no lat", () => {
    expect(invalidCoordinateReason(undefined, -6.26)).toMatch(/must both be numbers/);
  });

  it("rejects non-numeric values", () => {
    expect(invalidCoordinateReason("53.35", -6.26)).toMatch(/must both be numbers/);
    expect(invalidCoordinateReason(53.35, "not a number")).toMatch(/must both be numbers/);
  });

  it("rejects NaN/Infinity", () => {
    expect(invalidCoordinateReason(NaN, -6.26)).toMatch(/must both be numbers/);
    expect(invalidCoordinateReason(53.35, Infinity)).toMatch(/must both be numbers/);
  });

  it("boundary values are valid, not rejected", () => {
    expect(invalidCoordinateReason(90, 180)).toBeNull();
    expect(invalidCoordinateReason(-90, -180)).toBeNull();
  });
});
