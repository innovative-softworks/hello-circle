import { describe, expect, it } from "vitest";
import { allowedReadRequest, resolveEnvironment } from "./environment";

const local = { E2E_MODE: "mock", E2E_ENVIRONMENT: "local", E2E_BASE_URL: "http://127.0.0.1:4177" };
describe("QA environment safety", () => {
  it("accepts isolated mock mode", () => expect(resolveEnvironment(local).mode).toBe("mock"));
  it.each([
    { E2E_BASE_URL: undefined }, { E2E_MODE: "write" }, { E2E_ENVIRONMENT: "production" },
    { E2E_BASE_URL: "https://hellocircle.ie" }, { E2E_BASE_URL: "https://www.hellocircle.ie" },
    { E2E_BASE_URL: "https://localhost.evil.example" }, { E2E_BASE_URL: "http://127.0.0.1:5173" },
    { E2E_BASE_URL: "http://user:password@127.0.0.1:4177" },
    { E2E_BASE_URL: "http://127.0.0.1:4177/path" }, { E2E_BASE_URL: "http://127.0.0.1:4177/?token=secret" },
    { E2E_BASE_URL: "file:///tmp/test" }, { E2E_BASE_URL: "invalid" },
  ])("rejects unsafe or ambiguous configuration %j", (patch) => {
    expect(() => resolveEnvironment({ ...local, ...patch })).toThrow();
  });
  it("requires exact staging origin confirmation and HTTPS", () => {
    const staging = { E2E_MODE: "live-readonly", E2E_ENVIRONMENT: "staging", E2E_BASE_URL: "https://qa.example.test" };
    expect(() => resolveEnvironment(staging)).toThrow();
    expect(() => resolveEnvironment({ ...staging, E2E_STAGING_ORIGIN: "https://other.example.test" })).toThrow();
    expect(resolveEnvironment({ ...staging, E2E_STAGING_ORIGIN: staging.E2E_BASE_URL }).environment).toBe("staging");
    expect(() => resolveEnvironment({ ...staging, E2E_BASE_URL: "http://qa.example.test", E2E_STAGING_ORIGIN: "http://qa.example.test" })).toThrow();
  });
  it("permits only explicit API reads and blocks writes or redirects to other origins", () => {
    const origin = local.E2E_BASE_URL;
    expect(allowedReadRequest("GET", `${origin}/api/health`, origin)).toBe(true);
    expect(allowedReadRequest("POST", `${origin}/api/health`, origin)).toBe(false);
    expect(allowedReadRequest("GET", `${origin}/api/auth/verify?token=x`, origin)).toBe(false);
    expect(allowedReadRequest("GET", "https://hellocircle.ie/api/health", origin)).toBe(false);
    expect(allowedReadRequest("GET", `${origin}/login`, origin)).toBe(true);
  });
  it("refuses a production process even with loopback QA flags", () => {
    expect(() => resolveEnvironment({ ...local, NODE_ENV: "production" })).toThrow("QA ABORTED");
  });
  it.each(["https://hellocircle.ie.", "https://www.hellocircle.ie."])("rejects production DNS trailing-dot alias %s", (origin) => {
    expect(() => resolveEnvironment({ E2E_MODE: "live-readonly", E2E_ENVIRONMENT: "staging", E2E_BASE_URL: origin, E2E_STAGING_ORIGIN: origin })).toThrow("production");
  });
  it.each([
    "not a URL", "http://user:secret@127.0.0.1:4177/api/health",
    "http://127.0.0.1:4177/%61pi/auth/verify", "http://127.0.0.1:4177/API/auth/verify",
    "http://127.0.0.1:4177//api/auth/verify", "http://127.0.0.1:4177/api",
    "http://127.0.0.1:4177/api/health?token=secret", "http://127.0.0.1:4177/api/health#fragment",
  ])("read allowlist rejects ambiguous/credential-bearing URL %s", (url) => {
    expect(allowedReadRequest("GET", url, local.E2E_BASE_URL)).toBe(false);
  });
});
