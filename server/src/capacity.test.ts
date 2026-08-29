import { describe, expect, it } from "vitest";
import { computeCapacity } from "./capacity.js";

// Pure-function unit tests, no DB — see capacity.ts's own comment for why
// this exists (games.ts/circles.ts/registrations.ts previously hand-rolled
// this same arithmetic three separate ways).

describe("computeCapacity", () => {
  it("treats null capacity as unlimited — never full, no spotsLeft figure", () => {
    const result = computeCapacity(null, 500);
    expect(result.isFull).toBe(false);
    expect(result.spotsLeft).toBeNull();
    expect(result.capacity).toBeNull();
    expect(result.occupied).toBe(500);
  });

  it("is not full below capacity", () => {
    const result = computeCapacity(10, 9);
    expect(result.isFull).toBe(false);
    expect(result.spotsLeft).toBe(1);
  });

  it("is full exactly at capacity (boundary)", () => {
    const result = computeCapacity(10, 10);
    expect(result.isFull).toBe(true);
    expect(result.spotsLeft).toBe(0);
  });

  it("is full over capacity, and spotsLeft never goes negative", () => {
    const result = computeCapacity(10, 13);
    expect(result.isFull).toBe(true);
    expect(result.spotsLeft).toBe(0);
  });

  it("reports full spotsLeft when nothing is occupied yet", () => {
    const result = computeCapacity(4, 0);
    expect(result.isFull).toBe(false);
    expect(result.spotsLeft).toBe(4);
  });

  it("treats zero capacity as immediately full", () => {
    const result = computeCapacity(0, 0);
    expect(result.isFull).toBe(true);
    expect(result.spotsLeft).toBe(0);
  });
});
