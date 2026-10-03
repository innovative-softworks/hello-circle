import { describe, expect, it } from "vitest";
import { resolveGtmContainerId } from "./analytics";

// HC-QA-093 — staging/test builds can opt out of (or redirect) the production
// GTM container; an unset value keeps production behaviour unchanged.
describe("resolveGtmContainerId", () => {
  it("keeps the production default when unset", () => {
    expect(resolveGtmContainerId(undefined)).toMatch(/^GTM-[A-Z0-9]+$/);
    expect(resolveGtmContainerId("")).toMatch(/^GTM-[A-Z0-9]+$/);
  });
  it("disables GTM with 'off'", () => { expect(resolveGtmContainerId("off")).toBeNull(); });
  it("uses an explicit staging container", () => { expect(resolveGtmContainerId("GTM-STAGE01")).toBe("GTM-STAGE01"); });
  it("refuses a malformed value rather than loading something unexpected", () => { expect(resolveGtmContainerId("https://evil.example/gtm.js")).toBeNull(); });
});
