import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "dotenv";
import { authIntegrationPreflight } from "./integration-safety";

const root = fileURLToPath(new URL("../../", import.meta.url));
const filename = path.join(root, ".env.test");
try {
  // Explicit shell values take precedence, so production inherited values cannot be hidden by the file.
  let fromFile = existsSync(filename) ? parse(readFileSync(filename)) : {};
  if (process.argv.includes("--current")) {
    // Offline only: read generated inputs; do NOT import the connected/database guard.
    const manifest = JSON.parse(readFileSync(path.join(root, ".qa-data", "current.json"), "utf8"));
    fromFile = JSON.parse(readFileSync(path.join(manifest.secretsDir, "environment.json"), "utf8"));
  }
  const result = authIntegrationPreflight({ ...fromFile, ...process.env }, root);
  console.log(result.message);
  process.exitCode = result.exitCode;
} catch {
  console.error("QA ABORTED — could not read QA configuration. No services contacted.");
  process.exitCode = 1;
}
