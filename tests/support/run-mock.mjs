import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    E2E_MODE: "mock",
    E2E_ENVIRONMENT: "local",
    E2E_BASE_URL: "http://127.0.0.1:4177",
  },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
