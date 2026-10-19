import { describe, expect, it } from "vitest";
import { buildReport, scrub, scrubRoute } from "./errorReporting.js";

describe("error reporting never carries personal data or credentials", () => {
  it("masks emails, keys, provider ids, long numbers and tokens", () => {
    const s = scrub("jo@example.ie paid with sk_test_abcDEF123 for cs_test_a1b2c3d4e5f6 card 4242424242424242 token 0123456789abcdef0123456789abcdef password=hunter2");
    expect(s).not.toMatch(/jo@example\.ie|sk_test_abc|cs_test_a1b2|4242424242424242|0123456789abcdef0123|hunter2/);
    expect(s).toContain("[email]");
  });
  it("drops query strings and fragments from routes", () => {
    expect(scrubRoute("/bookings?token=abc&ref=HB-1#x")).toBe("/bookings");
  });
  it("truncates long messages and stamps the release", () => {
    const r = buildReport({ source: "client", kind: "render", message: "x".repeat(2000) });
    expect(r.message.length).toBe(500);
    expect(r.release).toBeTruthy();
  });
});
