import { describe, expect, it } from "vitest";
import { parseNewcomerWelcome } from "./newcomerWelcome.js";

describe("parseNewcomerWelcome", () => {
  it("keeps a role or first name with arrival directions", () => {
    expect(parseNewcomerWelcome("  Aoife (coach)  meets newcomers at the main door ")).toEqual({ ok: true, value: "Aoife (coach) meets newcomers at the main door" });
  });
  it("treats blank as cleared and undefined as unchanged", () => {
    expect(parseNewcomerWelcome("   ")).toEqual({ ok: true, value: null });
    expect(parseNewcomerWelcome(undefined)).toEqual({ ok: true, value: undefined });
  });
  it("refuses phone numbers and email addresses", () => {
    expect(parseNewcomerWelcome("Call Aoife on 087 123 4567").ok).toBe(false);
    expect(parseNewcomerWelcome("Text +353 87 1234567").ok).toBe(false);
    expect(parseNewcomerWelcome("Email aoife@example.com").ok).toBe(false);
    expect(parseNewcomerWelcome("Meet at gate 2 at 10:30").ok).toBe(true);
  });
  it("caps the length", () => {
    expect(parseNewcomerWelcome("x".repeat(301)).ok).toBe(false);
  });
});
