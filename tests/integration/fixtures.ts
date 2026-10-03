import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { connectedPreflight, loadRun } from "./runtime";

export const { env, manifest } = loadRun();
export const personas = JSON.parse(readFileSync(path.join(manifest.secretsDir, "personas.json"), "utf8")) as Record<string, { id: string; role: string }>;
export const test = base.extend<{ isolated: void }>({
  isolated: [async ({ request, context }, use) => {
    const checked = await connectedPreflight();
    await checked.connection.end();
    const response = await request.get("/api/__qa/identity");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ databaseName: manifest.databaseName, account: "hello_circle_qa@%", serverUuid: manifest.serverUuid, runId: manifest.runId });
    // Never fulfill/mock HelloCircle API calls. Only prohibit external providers.
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === env.E2E_BASE_URL) await route.continue();
      else await route.abort("blockedbyclient");
    });
    await use();
  }, { auto: true }],
});
export { expect };
