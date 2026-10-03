import { defineConfig } from "@playwright/test";
import { loadRun } from "./runtime";
const { env } = loadRun();
export default defineConfig({
  // Firefox/WebKit (Phase 10A cross-browser runs) compile the cold dev
  // server more slowly on each batch's first page load — longer time
  // budgets only; assertions and retries (0) are unchanged.
  testDir: "./specs", fullyParallel: false, workers: 1, retries: 0, timeout: ["firefox", "webkit"].includes(process.env.QA_BROWSER ?? "") ? 90_000 : 30_000,
  expect: { timeout: ["firefox", "webkit"].includes(process.env.QA_BROWSER ?? "") ? 10_000 : 5_000 },
  forbidOnly: true, reporter: "./reporter.ts", maxFailures: 1,
  outputDir: "../../test-results/real-auth",
  // Deliberately no credential/session-bearing recordings or persisted storageState.
  // Phase 10A cross-browser runs: QA_BROWSER is allowlisted by run.ts.
  use: { baseURL: env.E2E_BASE_URL, browserName: (["firefox", "webkit"].includes(process.env.QA_BROWSER ?? "") ? process.env.QA_BROWSER : "chromium") as "chromium" | "firefox" | "webkit", viewport: { width: 1440, height: 900 },
    trace: "off", screenshot: "off", video: "off", serviceWorkers: "block" },
  webServer: [
    { command: "node --import tsx tests/integration/backend.ts", cwd: "../..", url: `${env.E2E_API_URL}/api/__qa/identity`, reuseExistingServer: false, timeout: 60_000 },
    // Phase 11 — QA_PROD_BUILD=1 serves the production client bundle (built
    // once by run.ts with the same isolated config) via `vite preview`, with
    // the same /api proxy, instead of the on-demand dev server.
    process.env.QA_PROD_BUILD === "1"
      ? { command: "node node_modules/vite/bin/vite.js preview --config tests/integration/vite.config.ts --outDir ../.qa-data/prod-build --port 4178 --strictPort --host 127.0.0.1", cwd: "../..", url: env.E2E_BASE_URL, reuseExistingServer: false, timeout: 30_000 }
      : { command: "node node_modules/vite/bin/vite.js --config tests/integration/vite.config.ts", cwd: "../..", url: env.E2E_BASE_URL, reuseExistingServer: false, timeout: 30_000 },
  ],
});
