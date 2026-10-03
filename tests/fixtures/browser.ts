import { test as base, expect, type ConsoleMessage } from "@playwright/test";
import { resolveEnvironment } from "../support/environment";

type ExpectedResponse = { method: string; path: string; status: number; reason: string };
type BrowserFixtures = { expectedResponses: ExpectedResponse[]; diagnostics: void };
const guestResponses: Record<string, unknown> = {
  "/api/auth/me": { user: null },
  "/api/guest/me": { email: null },
  "/api/residents/me/participation": [],
  "/api/config": { mapsEnabled: false },
};

export const test = base.extend<BrowserFixtures>({
  expectedResponses: [[], { option: true }],
  diagnostics: [async ({ context, page, expectedResponses }, use, testInfo) => {
    const qa = resolveEnvironment(process.env);
    if (qa.mode !== "mock") throw new Error("Browser fixture is mock-only; real API browser journeys are not enabled.");
    const failures: string[] = [];
    const events: object[] = [];
    const consoleErrors: ConsoleMessage[] = [];
    const expectedStatuses = new Set<number>();
    // Paths only in diagnostic output: query strings can contain credentials/tokens.
    const pathOf = (url: string) => new URL(url).pathname;
    page.on("pageerror", (error) => failures.push(`Uncaught exception: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message);
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin !== qa.baseURL || response.status() < 400) return;
      const entry = { method: response.request().method(), path: url.pathname, status: response.status() };
      const expected = expectedResponses.find((item) => item.method === entry.method && item.path === entry.path && item.status === entry.status);
      events.push({ ...entry, expected: !!expected, reason: expected?.reason });
      if (expected) expectedStatuses.add(entry.status);
      else failures.push(`Unexpected HTTP ${entry.status}: ${entry.method} ${entry.path}`);
    });
    page.on("requestfailed", (request) => {
      if (new URL(request.url()).origin === qa.baseURL) {
        failures.push(`Failed request: ${request.method()} ${pathOf(request.url())} (${request.failure()?.errorText})`);
      }
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== qa.baseURL) {
        // Test assets replace third-party delivery. No outgoing provider requests.
        events.push({ kind: "external-resource-stub", host: url.hostname, type: request.resourceType() });
        if (request.resourceType() === "image") {
          await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ddd"/></svg>' });
        } else if (request.resourceType() === "stylesheet") {
          await route.fulfill({ contentType: "text/css", body: "/* External fonts omitted in mock smoke. */" });
        } else {
          failures.push(`Unconfigured external ${request.resourceType()} request to ${url.hostname}`);
          await route.abort("blockedbyclient");
        }
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const body = guestResponses[url.pathname];
        if (request.method() === "GET" && body !== undefined) await route.fulfill({ json: body });
        else {
          failures.push(`Unmocked API: ${request.method()} ${url.pathname}`);
          await route.fulfill({ status: 501, json: { error: "QA fixture missing; no backend request was sent" } });
        }
        return;
      }
      if (!["GET", "HEAD"].includes(request.method())) {
        failures.push(`Blocked unexpected ${request.method()} ${url.pathname}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    try {
      await use();
    } finally {
      for (const message of consoleErrors) {
        const text = message.text();
        const httpError = /^Failed to load resource: the server responded with a status of (\d+) \(/.exec(text);
        const location = message.location().url;
        const expected = httpError && expectedStatuses.has(Number(httpError[1])) && location && expectedResponses.some((item) => item.path === pathOf(location) && item.status === Number(httpError[1]));
        events.push({ kind: "console-error", text, expected: !!expected });
        if (!expected) failures.push(`Console: ${text}`);
      }
      await testInfo.attach("browser-diagnostics", { body: JSON.stringify({ mode: qa.mode, failures, events }, null, 2), contentType: "application/json" });
      expect(failures, "Unexpected browser errors (see browser-diagnostics attachment)").toEqual([]);
    }
  }, { auto: true }],
});

export { expect };
