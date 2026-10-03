import { test, expect } from "@playwright/test";
import { allowedReadRequest, resolveEnvironment } from "../support/environment";

test("QA-SMK-001: real API health and unauthenticated boundaries @live-readonly", async ({ request }) => {
  const qa = resolveEnvironment(process.env);
  if (qa.mode !== "live-readonly") throw new Error("This suite requires live-readonly mode.");
  // Redirect following is disabled: a staging redirect must not reach production.
  async function read(path: string) {
    const url = new URL(path, qa.baseURL).href;
    if (!allowedReadRequest("GET", url, qa.baseURL)) throw new Error("API read is not allowlisted.");
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.headers()["content-type"]).toContain("application/json");
    return response;
  }
  const health = await read("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });
  for (const [path, body] of [["/api/auth/me", { user: null }], ["/api/guest/me", { email: null }]] as const) {
    const response = await read(path);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(body);
  }
  for (const [path, error] of [["/api/vendor/listings", "Vendor login required"], ["/api/admin/stats", "Admin login required"]]) {
    const response = await read(path);
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error });
  }
});
