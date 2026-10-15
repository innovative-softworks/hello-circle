import { describe, expect, it } from "vitest";
import { scrubClient } from "./errorReporting";

describe("client error reports carry no personal data", () => {
  it("masks emails, keys, long numbers and tokens and truncates", () => {
    const out = scrubClient("jo@example.ie sk_live_abc123 4242424242424242 0123456789abcdef0123456789abcdef " + "x".repeat(900));
    expect(out).not.toMatch(/jo@example|sk_live_abc|4242424242424242|0123456789abcdef0123/);
    expect(out.length).toBe(500);
  });
});
