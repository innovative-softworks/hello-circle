import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
import { resolveEnvironment } from "./tests/support/environment";

config({ path: ".env.test", quiet: true });
const qa = resolveEnvironment(process.env);
export default defineConfig({
  testDir: "./tests",
  testMatch: qa.mode === "mock" ? "**/smoke/**/*.spec.ts" : "**/api/**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  metadata: { qaMode: qa.mode, environment: qa.environment, target: qa.baseURL },
  use: {
    baseURL: qa.baseURL,
    browserName: "chromium",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Local failures also retain evidence with zero retries.
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    serviceWorkers: "block",
  },
  projects: qa.mode === "mock" ? [
    { name: "chromium-desktop-mock", use: { viewport: { width: 1440, height: 900 } } },
    { name: "chromium-mobile-mock", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ] : [{ name: "api-live-readonly" }],
  webServer: qa.mode === "mock" ? {
    command: "npm run qa:serve",
    url: qa.baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  } : undefined,
});
