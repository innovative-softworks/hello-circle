import { describe, expect, it } from "vitest";
import { resolveUrlTab } from "./useUrlTab";

describe("resolveUrlTab", () => {
  const keys = ["overview", "bookings", "earnings"] as const;
  it("uses a known ?tab= value", () => expect(resolveUrlTab("bookings", keys, "overview")).toBe("bookings"));
  it("falls back for a missing value", () => expect(resolveUrlTab(null, keys, "overview")).toBe("overview"));
  it("falls back for an unknown or hostile value", () => {
    expect(resolveUrlTab("admin", keys, "overview")).toBe("overview");
    expect(resolveUrlTab("", keys, "overview")).toBe("overview");
    expect(resolveUrlTab("Bookings", keys, "overview")).toBe("overview");
  });
});
